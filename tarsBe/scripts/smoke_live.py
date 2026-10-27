"""Opt-in live Gemini smoke test. Uses real calls and an isolated temporary DB."""
import json
import logging
import re
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.provider import GeminiProvider


def main():
    settings = Settings()
    if not settings.gemini_api_key.get_secret_value():
        print("FAIL: GEMINI_API_KEY is missing.")
        return 1
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("google_genai").setLevel(logging.ERROR)
    calls = []
    secret = settings.gemini_api_key.get_secret_value()

    class ObservedProvider:
        def __init__(self):
            self.inner = GeminiProvider(settings)

        async def generate(self, schema, instruction, context):
            started = time.monotonic()
            try:
                result = await self.inner.generate(schema, instruction, context)
            except Exception as exc:
                detail = re.sub(r"AIza[\w-]+", "[redacted]", str(exc).replace(secret, "[redacted]"))[:1200]
                print(json.dumps({"stage": schema.__name__, "error_type": type(exc).__name__, "detail": detail}), flush=True)
                raise
            calls.append(schema.__name__)
            print(json.dumps({"stage": schema.__name__, "seconds": round(time.monotonic() - started, 2)}), flush=True)
            return result

    with tempfile.TemporaryDirectory(prefix="tars-live-") as folder:
        test_settings = settings.model_copy(update={"database_path": str(Path(folder) / "smoke.sqlite3")})
        with TestClient(create_app(test_settings, ObservedProvider())) as client:
            headers = {"X-API-Key": settings.backend_api_token.get_secret_value()}
            assert client.get("/health").status_code == 200
            assert client.get("/ready").status_code == 200
            created = client.post("/api/tutor/sessions", headers=headers)
            assert created.status_code == 201, created.text
            sid = created.json()["session_id"]
            url = f"/api/tutor/sessions/{sid}/turns"

            def turn(tid, message, **extra):
                started = time.monotonic()
                body = {"turn_id": tid, "message": message, **extra}
                response = client.post(url, json=body, headers=headers)
                data = response.json()
                print(json.dumps({"turn": tid, "http": response.status_code, "seconds": round(time.monotonic() - started, 2), "result": data}, ensure_ascii=True), flush=True)
                assert response.status_code == 200, response.text
                assert data["status"] == "completed", data["status"]
                assert "expected_number" not in response.text and "correct_index" not in response.text
                return body, data

            body, lesson = turn("live-lesson", "Explain why logistic regression uses a sigmoid. Use the calculator to compute sigmoid(2) and show the result on the board. Do not add a practice question yet.")
            assert lesson["lesson"] is not None
            assert "tools" in lesson["trace"]
            count = len(calls)
            replay = client.post(url, json=body, headers=headers)
            assert replay.json() == lesson and len(calls) == count
            turn("live-followup", "Does that probability guarantee the outcome for this one prediction? Please explain briefly without a practice question.")
            _, question = turn("live-question", "Ask me exactly this numeric practice question: What is 3 + 4? Put it in the question field, with a private answer key. Do not reveal the answer in reply or lesson.")
            assert question["question"] is not None
            assert question["intent"] in ("new_topic", "follow_up")
            _, answer = turn("live-answer", "7", answer_to_question_id=question["question"]["id"])
            assert answer["feedback"]["correct"] is True
            saved = client.get(f"/api/tutor/sessions/{sid}", headers=headers)
            assert saved.json()["revision"] == 4
            assert "expected_number" not in saved.text and "correct_index" not in saved.text
            print(json.dumps({"status": "PASS", "model": settings.gemini_model, "model_calls": len(calls), "verified": ["lesson", "calculator", "cached_replay", "followup", "question", "answer_check", "private_keys"]}), flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as exc:
        print(f"FAIL: {exc}", flush=True)
        sys.exit(1)

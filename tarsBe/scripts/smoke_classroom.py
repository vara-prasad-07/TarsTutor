"""Opt-in live Gemini classroom check. Uses configured credentials and a temporary DB.

Run from tarsBe: python scripts/smoke_classroom.py
No credential values, raw upstream errors, or private quiz keys are printed.
"""
import json
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def main():
    config = Settings()
    if not config.gemini_api_key.get_secret_value():
        print("FAIL: GEMINI_API_KEY is not configured.")
        return 1
    with tempfile.TemporaryDirectory(prefix="tars-classroom-") as directory:
        config = config.model_copy(update={"database_path": str(Path(directory) / "classroom.sqlite3")})
        with TestClient(create_app(config)) as client:
            client.headers.update({"X-API-Key": config.backend_api_token.get_secret_value()})
            for sid, topic, visual in [
                ("regression-live", "Teach linear regression from scratch using a graph, y = 45 + 6x, a prediction at x=3, residuals, and a quiz.", "graph"),
                ("python-live", "Teach Python for loops to a beginner with practical code examples and short practice quizzes.", "code"),
            ]:
                started = time.monotonic()
                response = client.post("/api/tutor/lessons", json={"session_id": sid, "prompt": topic})
                assert response.status_code == 202, response.text
                last = None
                first_ready = None
                deadline = started + 600
                while time.monotonic() < deadline:
                    response = client.get(f"/api/tutor/lessons/{sid}")
                    assert response.status_code == 200
                    lesson = response.json()
                    if lesson["stage"] != last:
                        last = lesson["stage"]
                        print(json.dumps({"lesson": sid, "stage": last, "seconds": round(time.monotonic() - started, 1)}), flush=True)
                    if lesson["segments"] and first_ready is None:
                        first_ready = time.monotonic() - started
                    if not lesson["generating"]:
                        break
                    time.sleep(0.5)
                assert lesson["status"] == "completed", lesson.get("error") or "Generation did not finish."
                assert len(lesson["segments"]) >= 3
                assert any(element["type"] == visual for part in lesson["segments"] for element in part["elements"])
                assert all(part["narration"] and part["quiz"] for part in lesson["segments"])
                assert "correct_index" not in response.text and "expected_number" not in response.text
                first = lesson["segments"][0]
                answer = client.post(f"/api/tutor/lessons/{sid}/questions", json={"request_id": "follow-up", "segment_id": first["id"], "message": "Can you give me one simpler real-life example of this concept?"})
                assert answer.status_code == 200, answer.text
                assert answer.json()["reply"] and answer.json()["narration"]
                quiz = first["quiz"]
                submission = quiz["choices"][0] if quiz["kind"] == "choice" else "0" if quiz["kind"] == "numeric" else "test"
                grade = client.post(f"/api/tutor/lessons/{sid}/answers", json={"request_id": "quiz-answer", "question_id": quiz["id"], "answer": submission})
                assert grade.status_code == 200 and grade.json()["correct"] is not None
                print(json.dumps({"lesson": sid, "status": "PASS", "segments": len(lesson["segments"]), "first_segment_seconds": round(first_ready, 1), "total_seconds": round(time.monotonic() - started, 1), "visual": visual, "quiz_kind": quiz["kind"], "contextual_answer": True}), flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as exc:
        print(f"FAIL: {exc}", flush=True)
        sys.exit(1)

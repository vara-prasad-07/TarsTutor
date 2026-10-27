import asyncio
import math
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.models import Classification, Draft, Plan, QuestionDraft, Review
from app.provider import GeminiProvider
from app.tools import calculate, expression_value
from langchain_core.exceptions import OutputParserException
from pydantic import SecretStr
from google.genai.errors import ServerError


class FakeProvider:
    def __init__(self, *, tool_rounds=0, failures=0, question=False, clarify=False, error=False, delay=0):
        self.calls = []
        self.plans = 0
        self.tool_rounds = tool_rounds
        self.failures = failures
        self.question = question
        self.clarify = clarify
        self.error = error
        self.delay = delay

    async def generate(self, schema, instruction, context):
        self.calls.append((schema.__name__, context))
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error:
            raise RuntimeError("secret-api-key")
        if schema is Classification:
            return Classification(intent="follow_up" if context["session"]["recent_turns"] else "new_topic", needs_clarification=self.clarify, clarification="Which arrow do you mean?" if self.clarify else "")
        if schema is Plan:
            self.plans += 1
            return Plan(goal="Understand sigmoid", steps=["Calculate probability"], criteria=["Match tool value"], calculations=[{"operation": "sigmoid", "value": 2}] if self.plans <= self.tool_rounds else [])
        if schema is Draft:
            return Draft(reply="The probability is about 0.881.", lesson={"title": "Sigmoid", "reply": "The probability is about 0.881.", "steps": [{"title": "Convert the score", "explanation": "The sigmoid maps a score to 0–1.", "blocks": [{"type": "formula", "text": "p = 1 / (1 + e^-2)", "caption": "About 0.881"}]}]}, question=QuestionDraft(prompt="What is 2 + 2?", kind="numeric", expected_number=4) if self.question else None)
        if schema is Review:
            if self.failures:
                self.failures -= 1
                return Review(passed=False, issues=["Fix calculation"])
            return Review(passed=True)
        raise AssertionError(schema)


def configured(tmp_path, **overrides):
    values = {"database_path": str(tmp_path / "test.sqlite3"), "gemini_api_key": "", "backend_api_token": "", **overrides}
    return Settings(_env_file=None, **values)


def session(client):
    response = client.post("/api/tutor/sessions")
    assert response.status_code == 201
    return response.json()["session_id"]


def send(client, sid, **kwargs):
    return client.post(f"/api/tutor/sessions/{sid}/turns", json={"turn_id": "turn-1", "message": "Explain sigmoid at 2", **kwargs})


def test_tool_loop_memory_idempotency_and_restart(tmp_path):
    fake = FakeProvider(tool_rounds=1)
    settings = configured(tmp_path)
    with TestClient(create_app(settings, fake)) as client:
        sid = session(client)
        response = send(client, sid)
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["trace"] == ["classify", "plan", "tools", "plan", "draft", "validate"]
        assert data["lesson"]["steps"][0]["blocks"][0]["id"] == "block-1"
        evidence = next(ctx for name, ctx in fake.calls if name == "Draft")["tool_results"]
        assert evidence[0]["result"]["value"] == pytest.approx(0.8807970779)
        count = len(fake.calls)
        assert send(client, sid).json() == data
        assert len(fake.calls) == count
        assert send(client, sid, message="Different input").status_code == 409
        assert send(client, sid, turn_id="turn-2", message="Why?").json()["intent"] == "follow_up"
    with TestClient(create_app(settings, fake)) as client:
        assert client.get(f"/api/tutor/sessions/{sid}").json()["revision"] == 2
        assert send(client, sid).json() == data


@pytest.mark.parametrize("failures, status, draft_count", [(1, "completed", 2), (2, "fallback", 2)])
def test_semantic_repair_is_bounded(tmp_path, failures, status, draft_count):
    fake = FakeProvider(failures=failures)
    with TestClient(create_app(configured(tmp_path), fake)) as client:
        response = send(client, session(client)).json()
        assert response["status"] == status
        assert sum(name == "Draft" for name, _ in fake.calls) == draft_count
        if status == "fallback":
            assert response["lesson"] is None


def test_tool_round_limit(tmp_path):
    with TestClient(create_app(configured(tmp_path), FakeProvider(tool_rounds=100))) as client:
        data = send(client, session(client)).json()
        assert data["trace"].count("tools") == 2


def test_clarification_and_missing_work(tmp_path):
    with TestClient(create_app(configured(tmp_path), FakeProvider(clarify=True))) as client:
        sid = session(client)
        data = send(client, sid).json()
        assert data["status"] == "clarification"
        assert data["lesson"] is None
        assert data["trace"] == ["classify", "clarify"]
        data = send(client, sid, turn_id="turn-2", action="review_work").json()
        assert data["intent"] == "review_work"


def test_private_question_and_authoritative_grading(tmp_path):
    fake = FakeProvider(question=True)
    with TestClient(create_app(configured(tmp_path), fake)) as client:
        sid = session(client)
        response = send(client, sid)
        qid = response.json()["question"]["id"]
        assert "expected_number" not in response.text
        assert "correct_index" not in client.get(f"/api/tutor/sessions/{sid}").text
        fake.question = False
        data = send(client, sid, turn_id="answer-1", message="4", answer_to_question_id=qid).json()
        assert data["feedback"]["correct"] is True
        assert data["intent"] == "answer_submission"
        assert "check_answer" in data["trace"]
        assert send(client, sid, turn_id="answer-2", message="5", answer_to_question_id=qid).json()["feedback"]["correct"] is False
        assert send(client, sid, turn_id="answer-3", answer_to_question_id="other").status_code == 422


def test_input_errors_and_auth(tmp_path):
    with TestClient(create_app(configured(tmp_path, backend_api_token="test-token"), FakeProvider())) as client:
        assert client.post("/api/tutor/sessions").status_code == 401
        assert client.post("/api/tutor/sessions", headers={"X-API-Key": "test-token"}).status_code == 201
    with TestClient(create_app(configured(tmp_path), FakeProvider())) as client:
        sid = session(client)
        assert send(client, sid, message=" ").status_code == 422
        assert send(client, sid, message="a" * 4001).status_code == 422
        assert send(client, sid, turn_id="../bad").status_code == 422
        assert send(client, "unknown").status_code == 404
        assert client.post(f"/api/tutor/sessions/{sid}/turns", content=b"x" * 24001).status_code == 413
        assert send(client, sid, board_context={"image": "not-supported"}).status_code == 422


def test_missing_key_and_provider_error(tmp_path):
    with TestClient(create_app(configured(tmp_path))) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/ready").status_code == 503
        assert send(client, session(client)).status_code == 503
    with TestClient(create_app(configured(tmp_path), FakeProvider(error=True))) as client:
        sid = session(client)
        response = send(client, sid)
        assert response.status_code == 502
        assert "secret-api-key" not in response.text
        assert client.get(f"/api/tutor/sessions/{sid}").json()["revision"] == 0


def test_turn_timeout(tmp_path):
    with TestClient(create_app(configured(tmp_path, turn_timeout_seconds=1), FakeProvider(delay=2))) as client:
        sid = session(client)
        assert send(client, sid).status_code == 504
        assert client.get(f"/api/tutor/sessions/{sid}").json()["revision"] == 0


@pytest.mark.parametrize("expression", ["__import__('os')", "2**1000", "1/0", "1e309", "(-1)**0.5", "[1,2]", "True", "2**(2**100)"])
def test_calculator_rejects_unsafe_or_unbounded_input(expression):
    assert calculate.invoke({"operation": "expression", "expression": expression})["ok"] is False


def test_calculator_values():
    assert expression_value("(2 + 3) * 4 / 2") == 10
    assert math.isclose(calculate.invoke({"operation": "sigmoid", "value": -2})["value"], 0.119202922)
    assert calculate.invoke({"operation": "sigmoid", "value": -1000000})["value"] == 0


def test_provider_structured_schema_construction(tmp_path):
    # Verify installed LangChain/Gemini API compatibility without calling a paid model.
    provider = GeminiProvider(configured(tmp_path).model_copy(update={"gemini_api_key": SecretStr("test-key")}))
    for schema in (Classification, Plan, Draft, Review):
        provider.model.with_structured_output(schema, method="json_schema")


def test_invalid_structured_draft_is_repaired(tmp_path):
    class InvalidFirstDraft(FakeProvider):
        broken = False

        async def generate(self, schema, instruction, context):
            if schema is Draft and not self.broken:
                self.broken = True
                raise OutputParserException("Malformed structured output")
            return await super().generate(schema, instruction, context)

    with TestClient(create_app(configured(tmp_path), InvalidFirstDraft())) as client:
        data = send(client, session(client)).json()
        assert data["status"] == "completed"
        assert "draft_invalid" in data["trace"]
        assert data["trace"].count("repair") == 1


def test_simultaneous_turns_do_not_overwrite_history(tmp_path):
    with TestClient(create_app(configured(tmp_path), FakeProvider(delay=0.05))) as client:
        sid = session(client)
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(send, client, sid, turn_id="parallel-1")
            second = pool.submit(send, client, sid, turn_id="parallel-2")
            results = [first.result(), second.result()]
        assert sorted(result.status_code for result in results) == [200, 409]
        saved = client.get(f"/api/tutor/sessions/{sid}").json()
        assert saved["revision"] == 1
        assert len(saved["recent_turns"]) == 1


def test_provider_deadline_becomes_http_timeout(tmp_path):
    class DeadlineModel:
        def with_structured_output(self, *args, **kwargs):
            return self

        async def ainvoke(self, messages):
            raise ServerError(504, {"error": {"code": 504, "message": "Deadline expired"}})

    provider = GeminiProvider.__new__(GeminiProvider)
    provider.model = DeadlineModel()
    with TestClient(create_app(configured(tmp_path), provider)) as client:
        sid = session(client)
        assert send(client, sid).status_code == 504
        assert client.get(f"/api/tutor/sessions/{sid}").json()["revision"] == 0


@pytest.mark.parametrize("recover", [True, False])
def test_temporary_provider_retry_is_bounded(tmp_path, recover):
    class BusyModel:
        calls = 0

        def with_structured_output(self, *args, **kwargs):
            return self

        async def ainvoke(self, messages):
            self.calls += 1
            if not recover or self.calls == 1:
                raise ServerError(503, {"error": {"code": 503, "message": "High demand"}})
            return Classification(intent="clarification", needs_clarification=True, clarification="Which part?")

    provider = GeminiProvider.__new__(GeminiProvider)
    provider.model = BusyModel()
    with TestClient(create_app(configured(tmp_path), provider)) as client:
        response = send(client, session(client))
        assert response.status_code == (200 if recover else 503)
        assert provider.model.calls == 2


def test_same_inflight_request_joins_one_generation(tmp_path):
    fake = FakeProvider(delay=0.05)
    with TestClient(create_app(configured(tmp_path), fake)) as client:
        sid = session(client)
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(send, client, sid)
            second = pool.submit(send, client, sid)
            results = [first.result(), second.result()]
        assert all(result.status_code == 200 for result in results)
        assert results[0].json() == results[1].json()
        assert sum(name == "Classification" for name, _ in fake.calls) == 1


def test_legacy_frontend_endpoint_and_session_cookie(tmp_path):
    with TestClient(create_app(configured(tmp_path), FakeProvider())) as client:
        first = client.post("/api/tutor/gemini", json={"prompt": "Explain sigmoid"})
        assert first.status_code == 200
        assert first.json()["lesson"]["steps"]
        sid = client.cookies.get("tars_legacy_session")
        assert sid
        second = client.post("/api/tutor/gemini", json={"prompt": "Why?"})
        assert second.status_code == 200
        assert client.cookies.get("tars_legacy_session") == sid
        assert client.post("/api/tutor/gemini", json={"prompt": " "}).status_code == 422

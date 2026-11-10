"""Behavioral coverage of generation, recovery, sources and private quiz grading."""
import asyncio
import base64
import io
import time
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.lesson_models import Outline, SegmentDraft, TutorAnswer
from app.main import create_app


class TeachingProvider:
    def __init__(self, slow=False, fail_part=None):
        self.calls = []
        self.slow = slow
        self.fail_part = fail_part

    async def generate(self, schema, instruction, context):
        self.calls.append((schema.__name__, context))
        if schema is Outline:
            return Outline(title=context["student_request"], subject="Education", objectives=["Understand and apply"], parts=[
                {"title": "Concept", "objective": "Understand the concept"},
                {"title": "Worked example", "objective": "Apply the concept"},
                {"title": "Practice", "objective": "Recall the concept"},
            ])
        if schema is SegmentDraft:
            index = context["segment_index"]
            if self.slow and index > 0:
                await asyncio.sleep(0.2)
            if self.fail_part == index:
                raise RuntimeError("provider-secret-should-not-leak")
            python = "python" in context["student_request"].lower()
            visual = {"type": "code", "text": "for n in range(3):\n    print(n)", "language": "python"} if python else {
                "type": "graph", "x_label": "Hours", "y_label": "Score", "x_min": 0, "x_max": 5, "y_min": 0, "y_max": 100,
                "series": [{"kind": "points", "points": [{"x": 1, "y": 51}, {"x": 3, "y": 63}]}, {"kind": "line", "points": [{"x": 0, "y": 45}, {"x": 5, "y": 75}]}],
            }
            quizzes = [
                {"kind": "choice", "prompt": "Which describes a slope?", "choices": ["Change per unit input", "Fixed baseline"], "correct_index": 0, "explanation": "Slope is the change in output when input rises by one."},
                {"kind": "numeric", "prompt": "For y = 45 + 6x, find y at x=3.", "expected_number": 63, "explanation": "45 + 6 × 3 = 63."},
                {"kind": "text", "prompt": "What names the fixed baseline?", "accepted_answers": ["intercept", "the intercept"], "explanation": "The intercept is the predicted output at x=0."},
            ]
            return SegmentDraft(title=context["current_part"]["title"], objective=context["current_part"]["objective"],
                narration="We connect the input to the output. Start with a concrete example and work through each change together.",
                elements=[{"type": "text", "text": "Understand one step at a time", "x": 60, "y": 150, "reveal_at": 0}, {**visual, "x": 60, "y": 250, "height": 320, "reveal_at": 0.4}], quiz=quizzes[index])
        if schema is TutorAnswer:
            return TutorAnswer(reply="Think of earning money per hour: the hourly rate is the slope.", narration="Your earnings increase by the hourly rate each additional hour.", elements=[{"type": "equation", "text": "earnings = hourly rate × hours", "x": 60, "y": 180}])
        raise AssertionError(schema)


def settings(tmp_path):
    return Settings(_env_file=None, database_path=str(tmp_path / "lessons.sqlite3"), gemini_api_key="", backend_api_token="")


def wait_for(client, sid, predicate=lambda item: not item["generating"]):
    for _ in range(300):
        response = client.get(f"/api/tutor/lessons/{sid}")
        assert response.status_code == 200
        item = response.json()
        if predicate(item):
            return item
        time.sleep(0.01)
    raise AssertionError("Lesson did not reach expected state")


def start(client, sid="lesson-1", prompt="Teach linear regression", **extra):
    result = client.post("/api/tutor/lessons", json={"session_id": sid, "prompt": prompt, **extra})
    assert result.status_code == 202, result.text
    return result.json()


def test_incremental_generation_private_keys_idempotency_and_restart(tmp_path):
    config = settings(tmp_path)
    provider = TeachingProvider(slow=True)
    with TestClient(create_app(config, provider)) as client:
        first = start(client)
        assert first["segments"] == []
        playable = wait_for(client, "lesson-1", lambda item: len(item["segments"]) == 1)
        assert playable["generating"] and playable["status"] == "ready"
        assert playable["segments"][0]["elements"][1]["type"] == "graph"
        complete = wait_for(client, "lesson-1")
        assert complete["status"] == "completed" and len(complete["segments"]) == 3
        assert all(stage["status"] == "completed" for stage in complete["stages"])
        encoded = str(complete)
        assert "correct_index" not in encoded and "expected_number" not in encoded and "accepted_answers" not in encoded
        calls = len(provider.calls)
        assert start(client)["segments"] == complete["segments"]
        assert len(provider.calls) == calls
        assert client.post("/api/tutor/lessons", json={"session_id": "lesson-1", "prompt": "different"}).status_code == 409
    with TestClient(create_app(config, TeachingProvider())) as client:
        saved = client.get("/api/tutor/lessons/lesson-1").json()
        assert saved["segments"] == complete["segments"]


def test_different_subject_generates_different_visual_and_contextual_question(tmp_path):
    provider = TeachingProvider()
    with TestClient(create_app(settings(tmp_path), provider)) as client:
        start(client, prompt="Teach Python loops")
        lesson = wait_for(client, "lesson-1")
        assert lesson["segments"][0]["elements"][1]["type"] == "code"
        body = {"request_id": "ask-1", "message": "Can you give another example?", "segment_id": "segment-2"}
        response = client.post("/api/tutor/lessons/lesson-1/questions", json=body)
        assert response.status_code == 200
        assert response.json()["elements"][0]["id"] == "answer-ask-1-1"
        context = next(ctx for name, ctx in provider.calls if name == "TutorAnswer")
        assert context["current_segment"]["id"] == "segment-2"
        assert context["student_request"] == "Teach Python loops"
        count = len(provider.calls)
        assert client.post("/api/tutor/lessons/lesson-1/questions", json=body).json() == response.json()
        assert len(provider.calls) == count
        assert client.get("/api/tutor/lessons/lesson-1").json()["conversation"][-1]["role"] == "tutor"


@pytest.mark.parametrize("question,answer,correct", [(1, "0", True), (1, "Fixed baseline", False), (2, "63", True), (2, "nan", None), (3, "  The INTERCEPT. ", True), (3, "slope", False)])
def test_server_side_quiz_grading(tmp_path, question, answer, correct):
    with TestClient(create_app(settings(tmp_path), TeachingProvider())) as client:
        start(client)
        wait_for(client, "lesson-1")
        body = {"request_id": "answer-1", "question_id": f"segment-{question}-quiz", "answer": answer}
        result = client.post("/api/tutor/lessons/lesson-1/answers", json=body)
        assert result.status_code == 200
        assert result.json()["correct"] is correct
        assert result.json()["explanation"]
        assert client.post("/api/tutor/lessons/lesson-1/answers", json=body).json() == result.json()


def test_retry_preserves_finished_segments_and_redacts_failure(tmp_path):
    provider = TeachingProvider(fail_part=1)
    with TestClient(create_app(settings(tmp_path), provider)) as client:
        start(client)
        failed = wait_for(client, "lesson-1")
        assert failed["status"] == "failed" and len(failed["segments"]) == 1
        assert "provider-secret" not in str(failed)
        provider.fail_part = None
        assert client.post("/api/tutor/lessons/lesson-1/retry").status_code == 202
        completed = wait_for(client, "lesson-1")
        assert completed["status"] == "completed"
        assert completed["segments"][0] == failed["segments"][0]
        assert sum(name == "Outline" for name, _ in provider.calls) == 1


def test_cancel_and_resume(tmp_path):
    provider = TeachingProvider(slow=True)
    with TestClient(create_app(settings(tmp_path), provider)) as client:
        start(client)
        wait_for(client, "lesson-1", lambda item: len(item["segments"]) == 1)
        cancelled = client.post("/api/tutor/lessons/lesson-1/cancel").json()
        assert cancelled["status"] == "cancelled" and not cancelled["generating"]
        assert len(cancelled["segments"]) == 1
        client.post("/api/tutor/lessons/lesson-1/retry")
        assert wait_for(client, "lesson-1")["status"] == "completed"


def test_sources_extract_and_reach_model(tmp_path):
    provider = TeachingProvider()
    with TestClient(create_app(settings(tmp_path), provider)) as client:
        response = client.post("/api/tutor/uploads", json={"name": "notes.txt", "media_type": "text/plain", "data": base64.b64encode(b"Study the relationship between hours and score.").decode()})
        assert response.status_code == 200
        source = response.json()
        assert source["text"].startswith("Study the relationship") and source["data"] == ""
        start(client, materials=[source])
        wait_for(client, "lesson-1")
        assert provider.calls[0][1]["materials"][0]["text"] == source["text"]
        for extension, path in [("docx", "word/document.xml"), ("pptx", "ppt/slides/slide1.xml")]:
            archive = io.BytesIO()
            with zipfile.ZipFile(archive, "w") as z:
                z.writestr(path, '<document xmlns:w="urn:test"><w:t>Material from Office</w:t></document>')
            response = client.post("/api/tutor/uploads", json={"name": f"notes.{extension}", "data": base64.b64encode(archive.getvalue()).decode()})
            assert response.status_code == 200, response.text
            assert response.json()["text"] == "Material from Office"
        assert client.post("/api/tutor/uploads", json={"name": "bad.png", "data": base64.b64encode(b"not an image").decode()}).status_code == 422
        assert client.post("/api/tutor/uploads", json={"name": "bad.exe", "data": "aGVsbG8="}).status_code == 415
        assert client.post("/api/tutor/uploads", json={"name": "bad.txt", "data": "!notbase64!"}).status_code == 422


def test_missing_configuration_fails_before_queueing(tmp_path):
    with TestClient(create_app(settings(tmp_path))) as client:
        result = client.post("/api/tutor/lessons", json={"session_id": "new", "prompt": "Explain geometry"})
        assert result.status_code == 503
        assert client.get("/api/tutor/lessons/new").status_code == 404

"""Drawing snapshots reach the vision model without becoming stored source files."""
import base64
import struct
import zlib

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from test_lessons import TeachingProvider, settings, start, wait_for


def png(width=120, height=80, noisy=False):
    def chunk(kind, payload):
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))
    import random
    pixels = random.Random(1).randbytes(width * height * 3) if noisy else b"\xff" * (width * height * 3)
    scan = b"".join(b"\0" + pixels[y * width * 3:(y + 1) * width * 3] for y in range(height))
    raw = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(scan)) + chunk(b"IEND", b"")
    return base64.b64encode(raw).decode()


def question(image=None):
    return {"request_id": "drawing-1", "message": "Explain the area of my drawing", "segment_id": "segment-1", "whiteboard": {
        "media_type": "image/png", "data": image or png(), "scope": "student_work", "element_count": 4,
        "has_student_work": True, "selected_element_ids": [], "text": "3, 7, area?",
    }}


def test_drawing_is_multimodal_context_and_retry_is_idempotent(tmp_path):
    provider = TeachingProvider()
    with TestClient(create_app(settings(tmp_path), provider)) as client:
        start(client, prompt="Teach Python loops")
        wait_for(client, "lesson-1")
        body = question(png(noisy=True))
        # Real images exceed the old text-only request limit of 24 KB.
        assert len(body["whiteboard"]["data"]) > 24000
        response = client.post("/api/tutor/lessons/lesson-1/questions", json=body)
        assert response.status_code == 200, response.text
        assert response.json()["board_used"] is True
        context = next(ctx for name, ctx in provider.calls if name == "TutorAnswer")
        assert context["student_request"] == "Teach Python loops"
        assert context["current_whiteboard"]["has_student_work"] is True
        assert "data" not in context["current_whiteboard"]
        assert context["images"][-1]["data"] == body["whiteboard"]["data"]
        assert "CURRENT WHITEBOARD" in context["images"][-1]["label"]
        calls = len(provider.calls)
        assert client.post("/api/tutor/lessons/lesson-1/questions", json=body).json() == response.json()
        assert len(provider.calls) == calls
        changed = question(png(100, 100))
        assert client.post("/api/tutor/lessons/lesson-1/questions", json=changed).status_code == 409
        saved = client.get("/api/tutor/lessons/lesson-1").json()
        assert saved["materials"] == []
        assert body["whiteboard"]["data"] not in str(saved)
    assert body["whiteboard"]["data"].encode() not in (tmp_path / "lessons.sqlite3").read_bytes()


@pytest.mark.parametrize("image,media_type", [("not base64", "image/png"), (base64.b64encode(b"not a png").decode(), "image/png"), (png(2049, 1), "image/png"), (png(), "image/jpeg"), (png(), "image/svg+xml")])
def test_invalid_images_rejected_before_model_call(tmp_path, image, media_type):
    provider = TeachingProvider()
    with TestClient(create_app(settings(tmp_path), provider)) as client:
        body = question(image)
        body["whiteboard"]["media_type"] = media_type
        result = client.post("/api/tutor/lessons/lesson-1/questions", json=body)
        assert result.status_code == 422
        assert provider.calls == []
        assert image not in result.text


def test_drawing_request_size_is_bounded(tmp_path):
    with TestClient(create_app(settings(tmp_path), TeachingProvider())) as client:
        result = client.post("/api/tutor/lessons/lesson-1/questions", content=b"a" * (3 * 1024 * 1024 + 1))
        assert result.status_code == 413

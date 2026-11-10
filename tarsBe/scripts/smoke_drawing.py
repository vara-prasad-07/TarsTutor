"""Live vision + voice round trip with a raster drawing; uses configured server keys.

No microphone/browser automation. Creates an isolated temporary lesson database
and writes public verification artifacts to ignored data/verification.
"""
import base64
import json
import struct
import sys
import tempfile
import time
import zlib
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient
from app.config import Settings
from app.main import create_app


def drawing_png():
    width, height = 800, 500
    pixels = bytearray(b"\xff" * (width * height * 3))
    def line(points):
        for (x1, y1), (x2, y2) in zip(points, points[1:]):
            steps = max(abs(x2 - x1), abs(y2 - y1), 1)
            for step in range(steps + 1):
                x, y = round(x1 + (x2 - x1) * step / steps), round(y1 + (y2 - y1) * step / steps)
                for dy in range(-2, 3):
                    for dx in range(-2, 3):
                        if 0 <= x + dx < width and 0 <= y + dy < height:
                            offset = ((y + dy) * width + x + dx) * 3
                            pixels[offset:offset + 3] = bytes((35, 50, 60))
    # Slightly uneven ink edges and separate handwritten numeric labels.
    line([(140, 165), (596, 161), (600, 345), (142, 348), (140, 165)])
    line([(343, 91), (359, 82), (376, 85), (380, 97), (363, 109), (377, 114), (381, 126), (368, 137), (350, 134), (343, 127)])
    line([(637, 236), (679, 234), (650, 286)])
    def chunk(kind, payload):
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))
    scan = b"".join(b"\0" + pixels[y * width * 3:(y + 1) * width * 3] for y in range(height))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(scan)) + chunk(b"IEND", b"")


def checked(response):
    if response.status_code >= 400:
        raise RuntimeError(f"Request failed ({response.status_code}): {response.text[:300]}")
    return response


def main():
    artifacts = ROOT / "data" / "verification"
    artifacts.mkdir(parents=True, exist_ok=True)
    image = drawing_png()
    (artifacts / "drawing-question.png").write_bytes(image)
    with tempfile.TemporaryDirectory(prefix="tars-drawing-") as directory:
        config = Settings(database_path=str(Path(directory) / "drawing.sqlite3"), backend_api_token="")
        with TestClient(create_app(config)) as client:
            sid = "drawing-" + uuid4().hex[:10]
            checked(client.post("/api/tutor/lessons", json={"session_id": sid, "prompt": "Teach Python for loops in English, with short explanations."}))
            deadline = time.monotonic() + 240
            while time.monotonic() < deadline:
                lesson = checked(client.get(f"/api/tutor/lessons/{sid}")).json()
                if not lesson["generating"]:
                    break
                time.sleep(.5)
            assert lesson["segments"], lesson.get("error")
            print(json.dumps({"lesson": "ready", "subject": "Python loops"}), flush=True)
            voice = checked(client.post("/api/tutor/speech/tts", json={"text": "What is the area of the rectangle I drew? Please explain the calculation.", "language": "en-IN"}))
            transcript = checked(client.post("/api/tutor/speech/stt", content=voice.content, headers={"Content-Type": "audio/wav"})).json()["text"]
            body = {"request_id": uuid4().hex, "segment_id": lesson["segments"][0]["id"], "message": transcript, "whiteboard": {
                "media_type": "image/png", "data": base64.b64encode(image).decode(), "scope": "student_work", "element_count": 3,
                "has_student_work": True, "selected_element_ids": [], "text": "",
            }}
            reply = checked(client.post(f"/api/tutor/lessons/{sid}/questions", json=body)).json()
            assert reply["board_used"] and "21" in reply["reply"], reply["reply"]
            assert "3" in reply["reply"] and "7" in reply["reply"], reply["reply"]
            assert reply["elements"] and any("21" in item["text"] for item in reply["elements"]), "Worked answer missing from board elements"
            spoken = checked(client.post("/api/tutor/speech/tts", json={"text": reply["narration"], "language": "en-IN"}))
            assert spoken.content[:4] == b"RIFF"
            assert checked(client.post(f"/api/tutor/lessons/{sid}/questions", json=body)).json() == reply
            (artifacts / "drawing-answer.wav").write_bytes(spoken.content)
            report = {"status": "PASS", "transcript": transcript, "answer": reply["reply"], "narration": reply["narration"], "vision": True, "unrelated_lesson_overridden": True, "stt": True, "tts": True, "idempotency": True, "spoken_seconds": float(spoken.headers["x-audio-duration"])}
            (artifacts / "drawing-question.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
            print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()

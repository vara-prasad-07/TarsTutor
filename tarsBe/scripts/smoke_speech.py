"""Explicit live smoke: synthesize a short sentence, then transcribe that WAV.

Uses the local backend .env without printing or saving credentials. This makes
two billed provider calls. It does not record from a microphone.
"""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException

from app.config import Settings
from app.speech import SpeechService


async def main():
    service = SpeechService(Settings())
    try:
        audio, duration = await service.synthesize("The slope tells us how much the value changes.")
        print(json.dumps({"tts": "passed", "audio_bytes": len(audio), "duration_seconds": round(duration, 2)}))
        transcript = await service.transcribe(audio)
        print(json.dumps({"stt": "passed" if transcript else "empty", "transcript": transcript}))
        return 0 if transcript else 1
    except HTTPException as error:
        print(json.dumps({"status": "failed", "http_status": error.status_code, "detail": error.detail}))
        return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

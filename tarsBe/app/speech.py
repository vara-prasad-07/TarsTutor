"""Gnani's authenticated REST speech APIs; credentials never leave the backend.

Protocol references (verified 2026-11-10):
https://docs.gnani.ai/api/TTS/tts-inference
https://docs.gnani.ai/api/STT/speech-to-text
The REST synthesis endpoint supplies WAV audio, not word alignment. Clients
should synchronize their visual timeline against the actual audio duration.
"""

import asyncio
import hashlib
import io
import re
import struct
import time
import wave
from collections import OrderedDict
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import Field

from .config import Settings
from .models import StrictModel

TTS_URL = "https://api.vachana.ai/api/v1/tts/inference"
STT_URL = "https://api.vachana.ai/stt/v3"
MAX_AUDIO_BYTES = 4 * 1024 * 1024
MAX_TTS_BYTES = 24 * 1024 * 1024
CACHE_BYTES = 32 * 1024 * 1024
CACHE_SECONDS = 3600
Language = Literal["en-IN", "hi-IN", "ta-IN", "te-IN", "kn-IN", "ml-IN", "mr-IN", "pa-IN", "bn-IN", "gu-IN"]


class SynthesisRequest(StrictModel):
    text: str = Field(min_length=1, max_length=4500)
    language: Language | None = None


def narration_chunks(text: str) -> list[str]:
    """Keep provider requests short while retaining sentence boundaries."""
    chunks = []
    remaining = text.strip()
    while len(remaining) > 1600:
        boundary = [match.end() for match in re.finditer(r"[.!?]\s", remaining[:1600]) if match.end() >= 600]
        split = boundary[-1] if boundary else remaining.rfind(" ", 0, 1600)
        if split < 1:
            split = 1600
        chunks.append(remaining[:split].strip())
        remaining = remaining[split:].strip()
    if remaining:
        chunks.append(remaining)
    return chunks


def join_wav(parts: list[bytes]) -> bytes:
    if len(parts) == 1:
        return parts[0]
    output = io.BytesIO()
    with wave.open(output, "wb") as target:
        expected = None
        for part in parts:
            with wave.open(io.BytesIO(part), "rb") as source:
                params = (source.getnchannels(), source.getsampwidth(), source.getframerate())
                if expected and params != expected:
                    raise HTTPException(502, "Gnani returned inconsistent audio formats. Please retry narration.")
                if expected is None:
                    target.setnchannels(params[0])
                    target.setsampwidth(params[1])
                    target.setframerate(params[2])
                    expected = params
                target.writeframes(source.readframes(source.getnframes()))
    return output.getvalue()


def finalize_stream_wav(audio: bytes) -> bytes:
    """Gnani streams a WAV with unknown RIFF/data lengths (0xffffffff).

    Once HTTP is complete, replace only these sentinel lengths with real sizes.
    Normal files, corrupt headers, and truncated fixed-length data stay unchanged
    so wav_duration can reject them rather than silently accepting bad audio.
    """
    if len(audio) < 44 or audio[:4] != b"RIFF" or audio[8:12] != b"WAVE":
        return audio
    result = bytearray(audio)
    offset = 12
    while offset + 8 <= len(result):
        chunk = bytes(result[offset:offset + 4])
        size = struct.unpack_from("<I", result, offset + 4)[0]
        if chunk == b"data":
            if size == 0xffffffff:
                struct.pack_into("<I", result, offset + 4, len(result) - offset - 8)
            break
        if size == 0xffffffff:
            return audio
        offset += 8 + size + size % 2
    if struct.unpack_from("<I", result, 4)[0] == 0xffffffff:
        struct.pack_into("<I", result, 4, len(result) - 8)
    return bytes(result)


def wav_duration(audio: bytes, *, recording: bool = False) -> float:
    """Reject malformed/oversized recordings before sending paid API calls."""
    try:
        with wave.open(io.BytesIO(audio), "rb") as source:
            rate = source.getframerate()
            channels = source.getnchannels()
            width = source.getsampwidth()
            frames = source.getnframes()
            if rate <= 0 or channels <= 0 or width <= 0:
                raise ValueError
            # readframes verifies that the claimed data actually exists.
            if len(source.readframes(frames)) != frames * channels * width:
                raise ValueError
            duration = frames / rate
            if recording and (channels != 1 or width != 2 or rate not in (8000, 16000, 22050, 24000, 44100)):
                raise HTTPException(422, "Record mono, 16-bit PCM WAV at 8–44.1 kHz.")
            if recording and not 0.1 <= duration <= 30:
                raise HTTPException(422, "Voice questions must be between 0.1 and 30 seconds long.")
            if duration <= 0:
                raise ValueError
            return duration
    except (wave.Error, EOFError, ValueError, OverflowError):
        raise HTTPException(422 if recording else 502, "The audio could not be read. Please try again.") from None


class SpeechService:
    def __init__(self, config: Settings, *, transport: httpx.AsyncBaseTransport | None = None):
        self.config = config
        self.transport = transport
        # Accounts may permit only one active speech request. A bounded lock
        # serializes synthesis preloads, questions, and transcription safely.
        self.gate = asyncio.Lock()
        self.cache: OrderedDict[str, tuple[float, bytes, float]] = OrderedDict()
        self.cache_size = 0

    def headers(self) -> dict[str, str]:
        key = self.config.gnani_api_key.get_secret_value().strip()
        if not key:
            raise HTTPException(503, "Gnani speech is not configured. Set GNANI_API_KEY (or GNANI_API) in tarsBe/.env and restart the backend.")
        return {"X-API-Key-ID": key}

    async def request(self, url: str, **kwargs) -> tuple[bytes, str]:
        headers = self.headers()
        try:
            async with httpx.AsyncClient(timeout=self.config.speech_timeout_seconds, transport=self.transport, follow_redirects=False) as client:
                for attempt in range(2):
                    async with client.stream("POST", url, headers=headers, **kwargs) as response:
                        if response.status_code in (429, 500, 502, 503, 504) and attempt == 0:
                            await response.aclose()
                            await asyncio.sleep(0.8)
                            continue
                        if response.status_code in (401, 402, 403):
                            raise HTTPException(503, "Gnani rejected the speech credentials or account access. Check the backend key and available credits.")
                        if response.status_code == 429:
                            raise HTTPException(429, "Gnani speech is busy or its rate limit was reached. Please try again shortly.", headers={"Retry-After": "3"})
                        if response.status_code >= 400:
                            raise HTTPException(502, "Gnani could not process the speech request. Check the configured voice/model or retry shortly.")
                        if response.status_code != 200:
                            raise HTTPException(502, "Gnani returned an unexpected speech response. Please try again.")
                        chunks = []
                        size = 0
                        async for chunk in response.aiter_bytes():
                            size += len(chunk)
                            if size > MAX_TTS_BYTES:
                                raise HTTPException(502, "The speech response was too large. Try a shorter explanation.")
                            chunks.append(chunk)
                        return b"".join(chunks), response.headers.get("content-type", "")
        except httpx.TimeoutException:
            raise HTTPException(504, "Gnani speech timed out. Please try again.") from None
        except httpx.HTTPError:
            # Do not expose URLs, headers, provider payloads, or exception text.
            raise HTTPException(503, "Cannot reach Gnani speech. Check the backend network connection and retry.") from None
        raise HTTPException(502, "Gnani speech did not return audio. Please try again.")

    def cached(self, key: str) -> tuple[bytes, float] | None:
        cached = self.cache.get(key)
        if cached is None:
            return None
        created, audio, duration = cached
        if time.monotonic() - created > CACHE_SECONDS:
            self.cache.pop(key)
            self.cache_size -= len(audio)
            return None
        self.cache.move_to_end(key)
        return audio, duration

    async def synthesize(self, text: str, language: str | None = None) -> tuple[bytes, float]:
        self.headers()
        if not text.strip() or len(text) > 4500:
            raise HTTPException(422, "Narration must contain between 1 and 4500 characters.")
        language = language or self.config.gnani_language
        identity = f"{self.config.gnani_tts_model}\0{self.config.gnani_voice}\0{language}\0{text}"
        key = hashlib.sha256(identity.encode()).hexdigest()
        cached = self.cached(key)
        if cached:
            return cached
        try:
            async with asyncio.timeout(self.config.speech_timeout_seconds * 2 + 5):
                async with self.gate:
                    cached = self.cached(key)
                    if cached:
                        return cached
                    parts = []
                    total_bytes = 0
                    for chunk in narration_chunks(text):
                        part, _ = await self.request(TTS_URL, json={
                            "text": chunk,
                            "model": self.config.gnani_tts_model,
                            "voice": self.config.gnani_voice,
                            "language": language,
                            "speed": 1.0,
                            "audio_config": {"encoding": "linear_pcm", "container": "wav", "num_channels": 1, "sample_rate": 24000, "sample_width": 2},
                        })
                        part = finalize_stream_wav(part)
                        wav_duration(part)
                        total_bytes += len(part)
                        if total_bytes > MAX_TTS_BYTES:
                            raise HTTPException(502, "The narration is too long. Please ask for a shorter explanation.")
                        parts.append(part)
                    audio = join_wav(parts)
                    duration = wav_duration(audio)
                    while self.cache and (self.cache_size + len(audio) > CACHE_BYTES or len(self.cache) >= 64):
                        _, old = self.cache.popitem(last=False)
                        self.cache_size -= len(old[1])
                    self.cache[key] = (time.monotonic(), audio, duration)
                    self.cache_size += len(audio)
                    return audio, duration
        except TimeoutError:
            raise HTTPException(504, "Speech is taking too long to prepare. Please try again.") from None

    async def transcribe(self, audio: bytes, language: str | None = None) -> str:
        import json

        self.headers()
        if len(audio) > MAX_AUDIO_BYTES:
            raise HTTPException(413, "Voice recording exceeds 4 MB. Record a question under 30 seconds.")
        wav_duration(audio, recording=True)
        try:
            async with asyncio.timeout(self.config.speech_timeout_seconds * 2 + 5):
                async with self.gate:
                    raw, _ = await self.request(STT_URL, files={"audio_file": ("question.wav", audio, "audio/wav")}, data={"language_code": language or self.config.gnani_language})
            data = json.loads(raw)
            transcript = data.get("transcript")
            if data.get("success") is False or not isinstance(transcript, str):
                raise ValueError
            if len(transcript) > 4000:
                raise HTTPException(422, "The transcript is too long. Please ask a shorter question.")
            return transcript.strip()
        except TimeoutError:
            raise HTTPException(504, "Speech recognition is taking too long. Please try again.") from None
        except (ValueError, TypeError, AttributeError):
            raise HTTPException(502, "Gnani returned an unreadable transcript. Please record your question again.") from None


def create_speech_router(config: Settings, *, service: SpeechService | None = None) -> APIRouter:
    router = APIRouter(prefix="/api/tutor/speech", tags=["speech"])
    speech = service or SpeechService(config)

    @router.get("/status")
    async def status():
        configured = bool(config.gnani_api_key.get_secret_value().strip())
        return {"provider": "gnani", "tts_configured": configured, "stt_configured": configured, "max_recording_seconds": 30}

    @router.post("/tts")
    async def tts(body: SynthesisRequest):
        audio, duration = await speech.synthesize(body.text, body.language)
        return Response(audio, media_type="audio/wav", headers={"Cache-Control": "private, no-store", "X-Audio-Duration": f"{duration:.3f}", "X-Content-Type-Options": "nosniff"})

    @router.post("/stt")
    async def stt(request: Request, language: Language | None = Query(default=None)):
        if request.headers.get("content-type", "").split(";")[0].lower() not in ("audio/wav", "audio/wave", "audio/x-wav"):
            raise HTTPException(415, "Send a PCM WAV recording with Content-Type: audio/wav.")
        # Also bound the route when used without the application's middleware.
        chunks = []
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_AUDIO_BYTES:
                raise HTTPException(413, "Voice recording exceeds 4 MB.")
            chunks.append(chunk)
        return {"text": await speech.transcribe(b"".join(chunks), language)}

    return router

import asyncio
import io
import json
import wave

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.config import Settings
from app.speech import SpeechService, create_speech_router, finalize_stream_wav, narration_chunks, wav_duration


def config(**changes):
    return Settings(_env_file=None, gnani_api_key="test-speech-secret", **changes)


def wav(seconds=1, rate=16000, channels=1):
    output = io.BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(channels)
        target.setsampwidth(2)
        target.setframerate(rate)
        target.writeframes(b"\0\0" * int(seconds * rate) * channels)
    return output.getvalue()


def test_existing_gnani_api_environment_alias(monkeypatch):
    monkeypatch.delenv("GNANI_API_KEY", raising=False)
    monkeypatch.setenv("GNANI_API", "legacy-secret")
    settings = Settings(_env_file=None)
    assert settings.gnani_api_key.get_secret_value() == "legacy-secret"
    assert "legacy-secret" not in repr(settings)


def test_tts_protocol_cache_and_concurrent_deduplication():
    calls = []
    audio = wav()

    async def handler(request):
        calls.append(request)
        assert str(request.url) == "https://api.vachana.ai/api/v1/tts/inference"
        assert request.headers["X-API-Key-ID"] == "test-speech-secret"
        payload = json.loads(request.content)
        assert payload["voice"] == "Kaveri"
        assert payload["model"] == "timbre-v2.5"
        assert payload["audio_config"]["container"] == "wav"
        assert payload["language"] == "en-IN"
        await asyncio.sleep(0.01)
        return httpx.Response(200, content=audio, headers={"content-type": "audio/wav"})

    service = SpeechService(config(), transport=httpx.MockTransport(handler))

    async def run():
        results = await asyncio.gather(*(service.synthesize("Slope is the change in y.") for _ in range(3)))
        assert all(result == (audio, 1) for result in results)
        assert len(calls) == 1
        assert service.cache_size == len(audio)

    asyncio.run(run())


def test_stt_uses_authenticated_multipart_and_actual_transcript():
    def handler(request):
        assert str(request.url) == "https://api.vachana.ai/stt/v3"
        assert request.headers["X-API-Key-ID"] == "test-speech-secret"
        assert "multipart/form-data; boundary=" in request.headers["content-type"]
        assert b'name="audio_file"' in request.content
        assert b'name="language_code"' in request.content
        assert b"en-IN" in request.content
        return httpx.Response(200, json={"success": True, "transcript": " What does slope mean? "})

    service = SpeechService(config(), transport=httpx.MockTransport(handler))
    assert asyncio.run(service.transcribe(wav())) == "What does slope mean?"


def test_gnani_streamed_wav_headers_are_finalized_after_download():
    audio = bytearray(wav(2))
    audio[4:8] = b"\xff" * 4
    audio[40:44] = b"\xff" * 4
    service = SpeechService(config(), transport=httpx.MockTransport(lambda _: httpx.Response(200, content=bytes(audio))))
    result, duration = asyncio.run(service.synthesize("The slope describes a change."))
    assert duration == 2
    assert result == wav(2)
    assert finalize_stream_wav(wav()[:-50]) == wav()[:-50]


def test_long_narration_is_chunked_and_returned_as_one_valid_wav():
    calls = []

    def handler(request):
        text = json.loads(request.content)["text"]
        assert 0 < len(text) <= 1600
        calls.append(text)
        return httpx.Response(200, content=wav())

    text = "This is a complete spoken sentence. " * 110
    service = SpeechService(config(), transport=httpx.MockTransport(handler))
    audio, duration = asyncio.run(service.synthesize(text))
    assert len(calls) >= 3
    assert duration == len(calls)
    assert wav_duration(audio) == len(calls)
    assert " ".join(calls) == text.strip()
    assert narration_chunks("x" * 4500) == ["x" * 1600, "x" * 1600, "x" * 1300]


@pytest.mark.parametrize("status, expected", [(401, 503), (402, 503), (403, 503), (400, 502), (302, 502), (429, 429)])
def test_provider_errors_do_not_expose_credentials_or_payloads(status, expected):
    service = SpeechService(config(), transport=httpx.MockTransport(lambda _: httpx.Response(status, text="test-speech-secret private provider data")))
    with pytest.raises(HTTPException) as captured:
        asyncio.run(service.synthesize("Hello"))
    assert captured.value.status_code == expected
    assert "test-speech-secret" not in captured.value.detail
    assert "private provider data" not in captured.value.detail


def test_retry_recovers_transient_failure():
    calls = 0

    def handler(_):
        nonlocal calls
        calls += 1
        return httpx.Response(503) if calls == 1 else httpx.Response(200, content=wav())

    service = SpeechService(config(), transport=httpx.MockTransport(handler))
    assert asyncio.run(service.synthesize("Hello"))[1] == 1
    assert calls == 2


@pytest.mark.parametrize("audio", [b"not audio", wav(31), wav(1, channels=2), wav(0.01), wav()[:-50]], ids=["invalid", "too-long", "stereo", "too-short", "truncated"])
def test_invalid_recording_rejected_before_provider_call(audio):
    def handler(_):
        pytest.fail("Invalid audio must not be sent to Gnani")

    service = SpeechService(config(), transport=httpx.MockTransport(handler))
    with pytest.raises(HTTPException) as captured:
        asyncio.run(service.transcribe(audio))
    assert captured.value.status_code == 422


def test_empty_transcript_is_a_valid_silent_recording():
    service = SpeechService(config(), transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"success": True, "transcript": ""})))
    assert asyncio.run(service.transcribe(wav())) == ""


def test_invalid_provider_payloads_are_sanitized():
    service = SpeechService(config(), transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"transcript": {"private": "value"}})))
    with pytest.raises(HTTPException) as captured:
        asyncio.run(service.transcribe(wav()))
    assert captured.value.status_code == 502
    assert "private" not in captured.value.detail


def test_routes_and_missing_configuration():
    settings = Settings(_env_file=None, gnani_api_key="")
    app = FastAPI()
    app.include_router(create_speech_router(settings))
    with TestClient(app) as client:
        status = client.get("/api/tutor/speech/status").json()
        assert status["tts_configured"] is False
        assert status["stt_configured"] is False
        assert "gnani_api_key" not in status
        assert client.post("/api/tutor/speech/tts", json={"text": "Hello"}).status_code == 503
        assert client.post("/api/tutor/speech/tts", json={"text": " "}).status_code == 422
        assert client.post("/api/tutor/speech/stt", content=wav(), headers={"Content-Type": "audio/webm"}).status_code == 415
        assert client.post("/api/tutor/speech/stt?language=invalid", content=wav(), headers={"Content-Type": "audio/wav"}).status_code == 422


def test_audio_route_exposes_actual_duration_and_no_provider_key():
    settings = config()
    service = SpeechService(settings, transport=httpx.MockTransport(lambda _: httpx.Response(200, content=wav(2))))
    app = FastAPI()
    app.include_router(create_speech_router(settings, service=service))
    with TestClient(app) as client:
        response = client.post("/api/tutor/speech/tts", json={"text": "An explanation."})
        assert response.status_code == 200
        assert response.headers["content-type"] == "audio/wav"
        assert response.headers["x-audio-duration"] == "2.000"
        assert wav_duration(response.content) == 2
        assert "test-speech-secret" not in str(response.headers)


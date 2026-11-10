# Gnani speech integration

Speech requests go from the browser to FastAPI through `/api/tutor/speech/*`.
Only FastAPI sends the `X-API-Key-ID` authentication header to Gnani. The existing
`GNANI_API` variable is supported; `GNANI_API_KEY` is the preferred equivalent.
Do not place either key in a `VITE_*` variable.

The adapter follows Gnani's official [REST synthesis](https://docs.gnani.ai/api/TTS/tts-inference)
and [REST transcription](https://docs.gnani.ai/api/STT/speech-to-text) documentation.
It uses `https://api.vachana.ai/api/v1/tts/inference` and
`https://api.vachana.ai/stt/v3`, respectively. No alternative speech provider or
browser speech synthesis is used.

Optional backend settings:

```dotenv
GNANI_TTS_MODEL=timbre-v2.5
GNANI_VOICE=Kaveri
GNANI_LANGUAGE=en-IN
SPEECH_TIMEOUT_SECONDS=60
```

The chosen voice must belong to the chosen model's voice catalog. Restart the
backend after changing settings. Speech status reports configuration presence,
not a connectivity, credit, or account-permission check.

## Local API

- `GET /api/tutor/speech/status`: configuration booleans and recording limit.
- `POST /api/tutor/speech/tts`: JSON `{ "text": "An explanation", "language": "en-IN" }`.
  Returns binary `audio/wav`; `X-Audio-Duration` is measured from the actual WAV.
- `POST /api/tutor/speech/stt?language=en-IN`: raw PCM WAV body with
  `Content-Type: audio/wav`. Returns `{ "text": "Recognized question" }`.

The browser records only after microphone consent. It converts its recording to
mono, 16-bit PCM WAV before uploading; WebM is not a documented Gnani REST input
format. The backend accepts recordings from 0.1 to 30 seconds and at most 4 MB.

TTS REST does not provide word timestamps. The classroom synchronizes its visual
timeline to `HTMLAudioElement.currentTime` and actual duration; the individual
visual cues are proportional timings, not forced word alignment. Changing audio
playback rate therefore also changes the rate of board reveals.

Speech requests are serialized per backend process to accommodate accounts with
one active request. Temporary provider failures are retried once. Generated audio
is cached in process for one hour, up to 64 entries and 32 MB, and disappears on
restart. Provider failures are returned as sanitized messages, without upstream
payloads or authentication values. The existing backend API-token dependency also
applies to speech routes.

## Verification

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_speech.py -q
.\.venv\Scripts\python.exe scripts/smoke_speech.py
```

The first command uses mocked provider responses to test the actual HTTP protocol,
cache, concurrency, retry, missing configuration, input validation, and error
redaction. The live smoke makes two billable calls with the local key: synthesizing
a short sentence and transcribing the returned WAV. It does not test microphone
hardware or browser playback permissions.

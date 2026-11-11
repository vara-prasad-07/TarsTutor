# TarsTutor backend

Python 3.11+ backend using FastAPI, LangChain, Gemini, LangGraph, and SQLite. It serves both the retained Excalidraw conversation and the new incremental whiteboard classroom.

Read [draft.md](draft.md) for the implementation, API examples, test instructions, and remaining work.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-lock.txt
# Edit .env: set GEMINI_API_KEY and a model available to your account.
# Keep the existing GNANI_API key here (GNANI_API_KEY is also supported).
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000/docs. Run offline checks with `.\.venv\Scripts\python.exe -m pytest -q`.

Select the inference provider in `tarsBe/.env` with `SWITCH=gemini` (the default) or `SWITCH=openrouter`. Gemini uses `GEMINI_API_KEY` and `GEMINI_MODEL`. OpenRouter uses `OPENROUTER_API` and `OPENROUTER_MODEL` (defaults to `google/gemini-2.5-flash`; use an OpenRouter model ID). Both conversation and classroom APIs follow this setting. Use a model supporting JSON output and image input for drawing questions. Only the selected provider's key is required. Restart the backend after changing these values. Unknown `SWITCH` values fail configuration validation.

The frontend connects through its Vite `/api/tutor` proxy. From the sibling `tarsTutor` folder, `npm run dev:tutor` starts both services, reusing an existing TarsTutor backend if present. Keep provider keys in this backend's `.env`. Restart an existing backend after code/config changes.

## Classroom APIs

- `POST /api/tutor/uploads`: `{name, media_type, data}` with base64 data; validates and extracts study material.
- `POST /api/tutor/lessons`: `{session_id, prompt, materials: []}`; idempotently starts a saved generation job and returns a snapshot with HTTP 202.
- `GET /api/tutor/lessons/{session_id}`: durable progress, public segments, source text and conversation. A segment is published before the next model call, so students can begin early.
- `POST /api/tutor/lessons/{session_id}/retry` or `/cancel`: resume from saved segments or cancel pending generation.
- `POST /api/tutor/lessons/{session_id}/questions`: `{request_id, message, segment_id, whiteboard?}`; contextual spoken reply and optional board visuals. `whiteboard` contains base64 `data`, `media_type` (PNG/JPEG), `scope`, `element_count`, `has_student_work`, `selected_element_ids`, and optional plain `text`. The current board is labeled multimodal context; response `board_used` tells the frontend to keep that drawing visible. Images are limited to 2 MB decoded, 2048 pixels per side and four megapixels; question JSON is capped at 3 MiB. Images are not persisted in lesson sources or action responses.
- `POST /api/tutor/lessons/{session_id}/answers`: `{request_id, question_id, answer}`; private-key grading for multiple-choice, numerical or short text questions. Choice answers accept a zero-based index string or exact choice text.
- `POST /api/tutor/lessons/{session_id}/materials`: `{materials: [...]}`; adds sources used in later segments and questions.

Gnani endpoints and optional voice settings are documented in [speech.md](speech.md). All APIs use the existing optional backend token dependency. The Vite proxy injects that token on the server.

Lesson jobs, outlines, public segments, private quiz keys, source context and request IDs are saved in SQLite. After a server restart an unfinished job reports an interruption and can be retried. Completed segments remain usable. Run a **single Uvicorn worker**: active task ownership, speech serialization and speech caches are process-local. Multi-worker/public deployments require shared job ownership and user/session authentication; the current implementation targets the existing local application.

## Verification

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe scripts/smoke_classroom.py
.\.venv\Scripts\python.exe scripts/smoke_speech.py
.\.venv\Scripts\python.exe scripts/smoke_drawing.py
# Requires the frontend and backend running; exercises the actual Vite proxy:
.\.venv\Scripts\python.exe scripts/smoke_flow.py
```

The tests use mocked providers. Live smoke scripts use the configured services and consume API credits. The classroom smoke checks linear regression and Python loops; the speech smoke synthesizes and transcribes a sentence. The HTTP flow checks PDF extraction, incremental linear regression, generated narration, a transcribed contextual question, a spoken reply, quiz grading, refresh recovery and duplicate-request handling. Public lesson snapshots and the HTTP report are written to ignored `data/verification/` for inspection. No keys are written to those artifacts.

The older `scripts/smoke_frontend.py` targets the retained `/board` conversation and is not the new classroom test. Browser/microphone hardware checks remain a separate manual verification step; see [the current report](../tarsTutor/VERIFICATION.md).

The drawing smoke uses an isolated temporary database, a real raster rectangle with handwritten side labels 3 and 7, and an unrelated Python lesson. It synthesizes/transcribes the question, checks that Gemini sees the image and explains area 21, synthesizes the answer, and checks idempotency. Artifacts are saved in ignored `data/verification/drawing-*`.

Drawing questions request worked solution elements as well as spoken narration. The classroom places those editable elements beside the student's original sketch on the existing board; placement coordinates and undo/save behavior are managed locally by the editor.

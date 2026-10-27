# Backend test results

## Frontend integration verification

FastAPI is now connected to the frontend through Vite's same-origin `/api/tutor` proxy. Both services were started successfully; the frontend address in this workspace is `http://127.0.0.1:3001`.

- **25 backend tests pass**, including in-flight retry deduplication.
- **7 frontend integration tests pass**, covering session creation/reuse, restoration, exact-request retry, late cancellation, response ID validation, selected-text review, and practice feedback. The retained legacy Gemini handler's 10 tests also passed.
- TypeScript and targeted ESLint checks passed. The frontend production build passed, with existing font-resolution and dependency/chunk warnings.
- A real headless Edge test submitted a prompt through the frontend, received a Gemini board lesson and numeric practice question, reloaded the page, restored the session, submitted `7`, and displayed correct feedback. No API credentials appeared on browser requests.
- The final board camera was checked with an existing accepted lesson after its animation settled. Full lesson content fits; Follow tutor respects the conversation panel and no longer tracks just the final step.

Browser captures are in the ignored `data/browser-test/` folder. To repeat the optional browser test, install `requirements-browser.txt`, start both services, and run `scripts/smoke_frontend.py`. It uses headless Microsoft Edge and real Gemini calls; set `TUTOR_FRONTEND_URL` if your frontend uses another address.

From `tarsTutor`, use `yarn dev:tutor` to start both services again. A backend already running on port 8000 is reused and should be restarted after backend edits. The API key remains in `tarsBe/.env`.

Tested using the Gemini key already configured in `tarsBe/.env`, with model `gemini-3.5-flash-lite`. The key was not printed. Live tests used an isolated temporary SQLite database; existing sessions were not modified. The HTTP tests used FastAPI's in-process test client with actual Gemini calls, rather than a separate Uvicorn network server.

## Results

| Check | Result |
| --- | --- |
| Automated regression suite | 24 passed after the fixes below |
| Live lesson + calculator | Passed: sigmoid(2) ≈ 0.8808; valid structured lesson with stable IDs |
| Exact request replay | Passed: identical saved response, no extra logical model calls |
| Follow-up memory | Passed: correctly explained that probability does not guarantee an individual outcome |
| Practice question | Passed: public numeric question created with the answer key kept private |
| Answer submission | Passed: `7` graded correct for `3 + 4`, using the stored key |
| Session readback | Passed: four accepted turns persisted; private answer-key fields absent |
| Educational topic-change classification | Initially wrong; fixed and verified with a separate live classifier check returning `new_topic` |

The complete live workflow finished with 16 successful logical model calls. Explicit transient failures may add one request per call under the bounded retry policy. The live script now also asserts that a practice request is classified as educational; the final prompt adjustment was checked separately rather than repeating the entire paid workflow.

## Observed timing

| Turn | Elapsed time in the completed live run |
| --- | --- |
| Lesson with calculator | 72.09 seconds |
| Contextual follow-up | 84.78 seconds |
| Numeric question | 28.78 seconds |
| Answer grading and feedback | 27.59 seconds |

An earlier successful lesson took 37.44 seconds. During testing, Gemini also returned a deadline error and an explicit 503 high-demand response. The current model/provider showed variable latency. These measurements are a smoke-test sample, not a performance benchmark; interactive response time needs improvement before connecting a live tutor experience.

## Fixes made during testing

- Told the classifier and provider that the app supports calculator-backed lessons and whiteboard rendering. It previously treated those supported requests as unavailable capabilities.
- Defined educational topic changes and practice requests explicitly so they are not labelled `off_topic` just because they differ from the current subject.
- Increased the model deadline from 25 to 60 seconds and the overall turn deadline from 90 to 180 seconds in defaults, `.env.example`, and the local `.env`. The configured key and model were preserved.
- Mapped upstream Gemini 504 errors to HTTP 504.
- Added one retry after 750ms only for explicit provider 500/502/503 failures; persistent temporary failures return HTTP 503. No automatic retry for quota errors, timeouts, or successful calls.
- Removed the explicit temperature setting, which this configured model ignores.
- Added regression coverage for provider deadline handling and transient retry recovery/exhaustion.

## Repeat the tests

From `tarsBe`:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe scripts/smoke_live.py
```

The first command is offline. The second uses your configured key and incurs Gemini usage. Live provider load can still cause a failed run. The frontend remains pending your review before integration.

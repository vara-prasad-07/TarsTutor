# TarsTutor delivery and verification

Verified on 10 November 2026 using the existing local Gemini and Gnani configuration. Credentials were reused server-side; `.env` files were not changed.

## Implemented experience

The homepage leads to `/lesson/generating/:sessionId`, then to `/lesson/:sessionId` when the first saved segment is ready. Subsequent segments generate independently. Progress comes from actual outline generation, segment generation, visual/quiz validation and narration preparation. There is no timer-based simulated percentage.

The classroom embeds the full original Excalidraw editor. Tutor text, equations, scatter/line graphs, shapes, arrows, tables and highlighted code are progressive native editable objects. Selection, pan, pen, shapes, text, eraser, images, sticky notes, frames, laser, library, colors/styles, undo/redo, zoom, theme/settings, `.excalidraw` save and image export are available in the classroom. Student edits, deleted objects and z-order changes survive further narration updates. Native board state and inserted images persist per chapter in IndexedDB; old pen annotations migrate automatically.

The material sidebar, chapter navigation, audio-clock synchronization, speed, seek, pause/resume/replay, generated quizzes, text/voice questions, conversation restore and Markdown notes export remain. Using the editor pauses narration. New classrooms attempt to start narration; browser autoplay restrictions produce a visible Play action. Reloads restore paused.

Student interruptions retain the main lesson's audio position. Replies use the same audio element, and Resume lesson returns to that position. Microphone clips are decoded, downmixed and resampled to mono PCM WAV before Gnani STT; transcripts are automatically submitted with the current segment's context. Speech failures expose a retry and explicit silent-mode option.

Backend lessons, source context, private quiz keys, conversation and idempotent request results are persisted in SQLite. Generation supports cancellation/retry and recovery after restart. The original Excalidraw editor/conversation remains at `/board`; existing scene/room/library links are retained.

## Changed files

| Area | Main files |
| --- | --- |
| App entry, routes, landing and progress | `excalidraw-app/index.tsx`, `index.html`, `tutor/TarsApp.tsx`, `tutor/tars-app.scss` |
| Classroom and whiteboard | `tutor/Classroom.tsx`, `tutor/ClassroomBoard.tsx`, `tutor/lessonBoardEngine.ts`, `tutor/classroomBoardStorage.ts`, `tutor/classroom-board.scss`, `tutor/classroom.scss`; earlier SVG renderer retained in `WhiteboardView.tsx` |
| Narration and recording | `tutor/useClassroomAudio.ts`, `tutor/classroomMedia.ts` |
| Frontend API contract | `shared/classroom.ts` |
| Incremental backend and validation | `../tarsBe/app/lessons.py`, `lesson_models.py`, `main.py`, `provider.py` |
| Gnani integration | `../tarsBe/app/speech.py`, `config.py`, `.env.example`, `speech.md` |
| Dependencies | `../tarsBe/requirements.txt`, `requirements-lock.txt` (HTTP client declaration and PDF extraction) |
| Branding/build | `public/tars-favicon.svg`, `excalidraw-app/vite.config.mts`, `.env.tutor.example`, `scripts/woff2/woff2-vite-plugins.js`, `package.json`, `scripts/build-tutor.mjs` |
| Verification utilities | `scripts/check-client-secrets.mjs`, `scripts/check-preview.mjs`, backend `scripts/smoke_classroom.py`, `smoke_speech.py`, `smoke_flow.py` |
| Tests | frontend `Classroom.test.tsx`, `ClassroomBoard.test.tsx`, `lessonBoardEngine.test.ts`, `classroomBoardStorage.test.ts`, `TarsApp.test.tsx`, `useClassroomAudio.test.ts`, `classroomMedia.test.ts`; backend `tests/test_lessons.py`, `test_speech.py` |
| Documentation | both READMEs, `IMPLEMENTATION.md`, this report; retained browser smoke now targets `/board` |

## Actual results

| Check | Result |
| --- | --- |
| Full backend pytest suite | **66 passed**, including multimodal board context, image validation, bounded requests, retry idempotency and no snapshot persistence |
| Lesson tests after final error-state change | **12 passed** |
| Frontend tutor suite | **53 passed** across fourteen files, followed by focused composer/classroom/native-editor checks. Includes draft preservation when toggling materials, voice/drawing answers, theme persistence, canvas background matching, IME-safe input, autosave recovery, editable answer placement and undo/redo. |
| TypeScript | Passed with no blocking errors |
| Production build | Passed; output in `excalidraw-app/build` |
| Client credential scan | Passed against generated client files; no server credential values found |
| Production preview HTTP check | Passed for four routes, 20 referenced asset requests, lesson proxy and speech proxy |
| Live linear regression | Four segments; graph, worked prediction, generated quiz, contextual answer; first segment in **6.7 seconds** |
| Live Python loops | Four segments with code, generated quizzes and contextual answer; first segment in **10.3 seconds** |
| Live Gnani round trip | TTS returned a valid WAV; STT recovered the synthesized sentence |
| Live drawing + voice round trip | Passed with real Gemini and Gnani: a raster rectangle labeled 3 and 7, with no typed dimensions in context, was explained as area **21** during an unrelated Python lesson. The response included worked board elements containing the answer. Synthesized question → STT → multimodal answer → valid spoken WAV (**9.76 seconds**); duplicate request returned the same answer. Report, drawing and answer WAV in `../tarsBe/data/verification/drawing-*`. |
| Full HTTP flow through Vite | Passed: readable PDF upload, linear-regression graph and prediction of **63** for `45 + 6 × 3`, narration TTS, STT question, contextual answer TTS, quiz grading, duplicate request and reload recovery; first segment in **5.3 seconds** |

The end-to-end HTTP test left a saved lesson at `/lesson/verified-7624b8c62ea3`. It is available after starting the local services. Public snapshots, the narration WAV and machine-readable reports are in ignored `../tarsBe/data/verification/`.

The regression and Python live tests used real Gemini responses, rather than the deterministic providers used by unit tests. The generated lessons are not hardcoded examples.

The answer-drawing update passed TypeScript validation and produced the final bundle in 49.61 seconds. Its first bundling attempt exhausted local memory in esbuild; the successful retry used `GOMAXPROCS=2`, `GOGC=50` and `NODE_OPTIONS=--max-old-space-size=2048` for the Vite process. Application code was unchanged between attempts.

The UI theme/composer build uses the same reduced esbuild concurrency and a 3072 MB Node heap limit for the combined type-check/build command. The initial UI bundle passed in 55.02 seconds; final saved-label contrast changes were verified separately and bundled afterward. Existing user-edited board colors remain untouched.

## Verification limits and operating constraints

- The UI update adds persisted themes, native editor synchronization, multiline/IME-safe composer behavior and closed-connection autosave recovery. The text palette was checked across the background, surface, soft, hover and accent-soft surfaces: minimum normal/muted text contrast **5.02:1 in light mode**, **5.94:1 in dark mode**; primary button labels **12.63:1 / 14.04:1** respectively. These measurements cover the app palette, not arbitrary user-selected canvas colors.
- The minimalist revision could not be inspected through a live screenshot: both the native computer-use pipe and browser access host were unavailable. Native editor/component checks passed; no screenshot comparison is claimed.

- Browser visual inspection could not be completed: the computer-use tool reported that browser access was unavailable and then could not determine the current browser URL reliably. Desktop/mobile CSS and DOM interactions are implemented, but pixel-level screenshot comparison remains unverified.
- Real microphone hardware and browser audio permissions were not exercised. Recording conversion, transcript submission, contextual reply and interruption/resume were verified with automated component tests; real Gnani TTS/STT and the HTTP speech/conversation chain passed separately.
- Gnani REST does not return word timestamps. Visual cues are model-supplied fractions of actual audio duration. Silent mode uses clearly labeled estimated narration timing.
- Drawing-aware explanations and image sources are supported. Formal rubric grading of freehand work is not implemented. Scanned PDFs must be uploaded as page images; legacy `.doc`/`.ppt` formats are not implemented. Text documents are limited to 24,000 extracted characters per source. Create/attach requests have a 12 MiB JSON cap; drawing questions have a 3 MiB JSON cap and 2 MB decoded image limit.
- Use one backend worker. Process-local generation ownership/speech caches and the current session-ID access model are intended for local use. Public multi-user deployment needs shared job ownership and user/session authorization.
- AI-generated content can still contain factual or layout mistakes. Bounds/schema validation and retries protect rendering, but do not prove every educational claim.
- The build retains nonblocking warnings from upstream dependency `use client` directives, large editor chunks, and an old Browserslist dataset. Concurrent development servers/builds exhausted local resources during one final rerun, causing a test-worker allocation failure and a build write error; sequential reruns were used afterward. Production source maps are disabled, continuous dev checking is opt-in, mandatory build type checking runs before bundling, and tutor tests use one worker to reduce peak memory.

## Run and reproduce

From `tarsTutor`:

```powershell
npm run dev:tutor
npm run test:tutor
npm run build:tutor
```

The combined dev command starts FastAPI and Vite. The configured frontend is `http://127.0.0.1:3001/`. To run services separately, use the backend README command and launch Vite from `excalidraw-app`.

From `tarsBe`:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe scripts/smoke_classroom.py
.\.venv\Scripts\python.exe scripts/smoke_speech.py
.\.venv\Scripts\python.exe scripts/smoke_drawing.py
.\.venv\Scripts\python.exe scripts/smoke_flow.py
```

The live commands consume provider credits. Existing local credentials are configured and passed the checks; no additional local API configuration is required. Future installations should install the updated backend requirements, copy `.env.example`, set their own Gemini/Gnani keys and select a model available to their account.

## Minimalist classroom revision

The composer and playback dock share a centered column capped at 760px. Materials start collapsed and open as a 264px panel, becoming an overlay below 1000px. The header uses quiet icon/text actions; the decorative avatar, composer heading, permanent context badge and full-width footer panel are removed. Neutral app surfaces replace blue panels. Legacy default warm canvas backgrounds migrate to #fafafa; the native dark-mode filter renders this as #161616, matching the workspace. Custom canvas colors remain available.

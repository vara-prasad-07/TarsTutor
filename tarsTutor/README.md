# TarsTutor

An AI tutor with a personalized, spoken whiteboard classroom, connected to the sibling `tarsBe` FastAPI/Gemini backend. Enter a topic, attach study materials, follow progressive visual explanations, interrupt by voice or text, and practice with generated quizzes.

## Learning experience

Use the **Light mode / Dark mode** control in the header to switch appearance. Your choice is remembered across the homepage, lesson preparation, classroom and native whiteboard. The first visit follows your system preference. Text and controls use a shared contrast palette in both themes.

The classroom opens with the materials panel collapsed. Its floating question composer is centered and capped at **760px**, with playback controls in one slim row above it. The neutral light/dark canvas matches the surrounding workspace. Open **Materials** to see sources and chapters.

The classroom question composer supports multiline text, **Enter** to send and **Shift + Enter** for a new line. Draw, Attach, Voice and Send are grouped together with clear recording/thinking states. The input grows as you type, while the whiteboard and answer panels adjust to keep controls reachable. Keyboard focus and reduced-motion preferences are supported.

- `/`: responsive TarsTutor homepage, topic examples, drag-and-drop file upload, and recent lessons.
- `/lesson/generating/:sessionId`: real backend generation stages, cancellation, retry, and automatic entry as soon as the first segment is ready.
- `/lesson/:sessionId`: the full Excalidraw editor inside the classroom, with selection, pan, pen, shapes, arrows, lines, text, eraser, images, sticky notes, frames, laser, library, colors/styles, undo/redo, zoom, save and export. Tutor equations, graphs, tables and code are editable native objects that reveal with narration. Lesson controls, source sidebar, conversation and quizzes remain alongside the board.
- `/board`: retained Excalidraw editor and original tutor conversation. Existing scene, room and library links still open the editor.

Lessons and conversation are saved in backend SQLite. Playback position, completed check-ins and recent lessons are saved locally in the browser. Each chapter's editable whiteboard, inserted images, background and viewport are saved in browser IndexedDB. Refreshing a lesson restores its saved content. Previous pen-only annotations migrate into the editable board.

Using the board pauses narration. Tutor playback preserves your edits and deletions. Use **Restore tutor drawing** in the board menu to reset the generated objects while keeping your own added drawings. The menu also provides normal `.excalidraw`, PNG and SVG save/export actions, separate from the lesson's Markdown notes download.

## Run locally

Use Node.js 20 or newer, Python 3.11+, and Yarn 1.22.22 for dependency installation. Once dependencies are installed, the commands below also run through npm.

1. Run `yarn install` from this directory.
2. Set up `../tarsBe/.venv` with Python 3.11+ and install `../tarsBe/requirements-lock.txt` from that backend folder.
3. Set `GEMINI_API_KEY` and `GEMINI_MODEL` in `../tarsBe/.env`. Keep the existing `GNANI_API` speech key there; `GNANI_API_KEY` is also accepted. Optional voice settings are listed in `../tarsBe/.env.example`.
4. Run `npm run dev:tutor` (or `yarn dev:tutor`) here. It starts FastAPI on port 8000 (or reuses an existing TarsTutor backend) and Vite. Open the frontend URL printed by Vite; this workspace currently uses **http://127.0.0.1:3001/**.

Restart FastAPI after backend code or `.env` changes. Restart Vite after proxy settings change. `yarn start` still starts only the frontend if you prefer two terminals. Vite forwards `/api/tutor/*` to FastAPI with timeouts that cover the backend turn deadline. Optional proxy settings are shown in `.env.tutor.example`; the backend API token is read server-side from `../tarsBe/.env` by default. Provider keys stay on the server.

Microphone input requires HTTPS or localhost and browser permission. Record a question for up to 29 seconds; TarsTutor converts it to mono PCM WAV, transcribes it through Gnani, submits it to the tutor, and speaks the contextual reply. The lesson stays paused until you choose **Resume lesson**. A browser that blocks autoplay may require pressing Play. If speech fails, the interface offers an explicit silent playback option.

Draw your problem, click the microphone, speak, then click **Stop recording**. Tars sees the drawing captured at microphone click and explains it aloud, keeping your drawing visible. Typed questions also include the current board. Select specific objects to focus a question; otherwise the snapshot focuses on your added or edited work with nearby labels. Telugu and other supported Indian-language lessons use their matching speech routes. Unclear measurements prompt a clarification. Snapshots are temporary question context, not added study materials.

Worked formulas, calculation steps and helpful diagrams are added beside that sketch on the same board. Tars finds nearby free space and brings the sketch and answer into view. The answer is editable, saves with the chapter, and can be undone as one action. Your existing drawing and previous answers are preserved. If the model returns no visual elements, the written explanation is added to the board instead.

Uploads support UTF-8 text/Markdown/CSV, PDF, DOCX, PPTX, PNG, JPEG and WebP, up to 6 MB per file and five files per lesson. Text extraction is capped at 24,000 characters per source. Scanned PDFs need to be supplied as page images. Source images are sent to Gemini as multimodal context; source instructions are treated as untrusted data.

In the retained `/board` editor, the conversation restores its latest six accepted turns and active practice question after reload. Use **Retry request** to reuse the original request ID after a failure or cancellation. **New conversation** starts fresh tutor context while retaining your drawings. Select board text and choose **Review selected work** for feedback. The classroom supports drawing-aware explanations; formal rubric grading of freehand work is not implemented.

## Code layout

- `excalidraw-app/`: application interface and Vite proxy to FastAPI.
- `excalidraw-app/tutor/`: tutor controls, model client, lesson renderer, and sample lesson.
- `excalidraw-app/tutor/TarsApp.tsx`: homepage, generation screen, routes and polling.
- `excalidraw-app/tutor/Classroom.tsx`, `ClassroomBoard.tsx`, `lessonBoardEngine.ts`, `classroomBoardStorage.ts`: classroom controls, the embedded editor, progressive native objects and saved board state. `useClassroomAudio.ts` owns narration playback; `WhiteboardView.tsx` retains the earlier SVG renderer.
- `shared/classroom.ts`: classroom API contracts and source upload client.
- `shared/`: lesson types and response validation used by the browser and server.
- `packages/`: Excalidraw editor engine and supporting packages required by the app.
- `scripts/`: build and font processing tools.
- `public/`: fonts, icons, screenshots, and static assets.
- `firebase-project/`: retained Firebase deployment rules for upstream cloud features.

See [the backend guide](../tarsBe/draft.md) for API details and [lesson format](excalidraw-app/tutor/lessons/README.md) for rendering rules. The old Gemini experiment handler is retained for reference but is no longer registered in Vite.

Board content uses browser autosave. Accepted conversation turns and private answer keys live in backend SQLite; the browser keeps the session pointer and one interrupted request for recovery.

## Checks and builds

- `npm run test:tutor`: classroom navigation, playback interruption/resume, quizzes, WAV conversion, and retained conversation/playback tests.
- `npm run build:tutor`: TypeScript validation followed by the production build, without requiring Yarn at runtime.
- Continuous development type checking is opt-in with `VITE_APP_ENABLE_CHECKER=true`; the full Excalidraw type graph uses substantial memory. The combined build always checks types before bundling. Tutor tests use one worker to keep memory bounded.
- `yarn test:typecheck`: TypeScript checks.
- `yarn test:code`: lint checks.
- `yarn test:app --run excalidraw-app/tutor/llm.test.tsx`: frontend request, restore, retry, cancellation, and practice-answer checks.
- `yarn build:app`: production frontend bundle in `excalidraw-app/build`; run TypeScript separately when using this command.

Backend tests and live integration checks are documented in [the backend README](../tarsBe/README.md). See [VERIFICATION.md](VERIFICATION.md) for actual results and verification limits. Narration visuals follow the real audio clock using model-supplied proportional cue times; Gnani REST does not supply word-level alignment.

Docker configuration and Vercel configuration are retained. A production deployment must host FastAPI and forward `/api/tutor/*` to it; a static build alone does not include an API. Vite preview also forwards these requests for local build testing. Public hosting additionally needs user authentication and session ownership, as described in the backend guide.

## License

Built on Excalidraw. The upstream MIT license and copyright notice are retained in [LICENSE](LICENSE).

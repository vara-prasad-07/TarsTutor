# TarsTutor

An AI tutor built on the Excalidraw whiteboard, connected to the sibling `tarsBe` FastAPI/LangGraph backend. Ask questions, continue a lesson, review selected text, and answer practice questions.

## Run locally

Use Node.js 20 or newer and Yarn 1.22.22.

1. Run `yarn install` from this directory.
2. Set up `../tarsBe/.venv` with Python 3.11+ and install `../tarsBe/requirements-lock.txt` from that backend folder.
3. Set `GEMINI_API_KEY` and `GEMINI_MODEL` in `../tarsBe/.env`.
4. Run `yarn dev:tutor` here. It starts FastAPI on port 8000 (or reuses an existing TarsTutor backend) and Vite. Open the frontend URL printed by Vite; this workspace currently uses port 3001.

Restart FastAPI after backend code or `.env` changes. Restart Vite after proxy settings change. `yarn start` still starts only the frontend if you prefer two terminals. Vite forwards `/api/tutor/*` to FastAPI with timeouts that cover the backend turn deadline. Optional proxy settings are shown in `.env.tutor.example`; the backend API token is read server-side from `../tarsBe/.env` by default. No LLM key is sent to the browser.

The conversation restores its latest six accepted turns and active practice question after reload. Use **Retry request** to reuse the original request ID after a failure or cancellation. **New conversation** starts fresh tutor context while retaining your drawings. Select board text and choose **Review selected work** for feedback; handwriting/image review is not available yet. Follow tutor controls whether new lessons move your viewport.

## Code layout

- `excalidraw-app/`: application interface and Vite proxy to FastAPI.
- `excalidraw-app/tutor/`: tutor controls, model client, lesson renderer, and sample lesson.
- `shared/`: lesson types and response validation used by the browser and server.
- `packages/`: Excalidraw editor engine and supporting packages required by the app.
- `scripts/`: build and font processing tools.
- `public/`: fonts, icons, screenshots, and static assets.
- `firebase-project/`: retained Firebase deployment rules for upstream cloud features.

See [the backend guide](../tarsBe/draft.md) for API details and [lesson format](excalidraw-app/tutor/lessons/README.md) for rendering rules. The old Gemini experiment handler is retained for reference but is no longer registered in Vite.

Board content uses browser autosave. Accepted conversation turns and private answer keys live in backend SQLite; the browser keeps the session pointer and one interrupted request for recovery.

## Checks and builds

- `yarn test:typecheck`: TypeScript checks.
- `yarn test:code`: lint checks.
- `yarn test:app --run excalidraw-app/tutor/llm.test.tsx`: frontend request, restore, retry, cancellation, and practice-answer checks.
- `yarn build:app`: production frontend build in `excalidraw-app/build`.

Docker configuration and Vercel configuration are retained. A production deployment must host FastAPI and forward `/api/tutor/*` to it; a static build alone does not include an API. Vite preview also forwards these requests for local build testing. Public hosting additionally needs user authentication and session ownership, as described in the backend guide.

## License

Built on Excalidraw. The upstream MIT license and copyright notice are retained in [LICENSE](LICENSE).

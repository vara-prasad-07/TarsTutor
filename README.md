# TarsTutor

An AI tutor that explains concepts on an interactive whiteboard, speaks through each lesson, and answers questions about what you draw.

[Live app](https://tarstutor.netlify.app/) · [Demo video](https://youtu.be/knIbF8aXEyk)

<!-- Replace SCREENSHOT_URL with an image URL or a repository path. -->
![TarsTutor classroom](https://res.cloudinary.com/diryolcmm/image/upload/v1794342420/Screenshot_2026-11-11_015619_tzjdec.png)

## The problem

Learning from videos is passive, and text-based AI answers can be difficult to visualize. Students need a way to see a concept unfold, ask questions in the moment, and work through problems themselves.

## The solution

TarsTutor combines spoken explanations, an editable whiteboard, and contextual questions in one classroom.

- **Learn from a topic or your materials.** Enter a topic or upload documents and images to generate a lesson.
- **Watch and listen.** Follow narrated explanations with equations, diagrams, graphs, and code revealed on the board.
- **Ask as you learn.** Pause to ask a question by voice or text, including questions about your whiteboard drawings.
- **Practice and return.** Check your understanding with quizzes and resume saved lessons.

## Tech stack

| Layer | Technologies |
|---|---|
| Frontend | React, TypeScript, Vite, Excalidraw |
| Backend | Python, FastAPI, Pydantic, SQLite |
| AI | Google Gemini, LangChain, LangGraph |
| Voice | Gnani speech-to-text and text-to-speech |
| Hosting | Netlify frontend and API proxy, Render backend |

## Run locally

Install Git, Node.js 22, Python 3.11+, and Yarn Classic 1.22.22. You will also need a Gemini API key and a Gnani API key for voice features.

### Windows (PowerShell)

```powershell
git clone https://github.com/vara-prasad-07/TarsTutor.git
cd TarsTutor

cd tarsBe
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-lock.txt
Copy-Item .env.example .env

cd ..\tarsTutor
yarn install
cd ..
```

### macOS / Linux

```bash
git clone https://github.com/vara-prasad-07/TarsTutor.git
cd TarsTutor

cd tarsBe
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-lock.txt
cp .env.example .env

cd ../tarsTutor
yarn install
cd ..
```

On Linux, install your distribution's Python venv package if virtual environment creation fails. Ensure `python3` is version 3.11 or newer.

### Configure and start

Edit `tarsBe/.env` and set:

```dotenv
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
GNANI_API_KEY=your_gnani_api_key
```

Keep the other defaults. API usage may incur provider charges; keep keys in the backend `.env` and out of Git.

From the repository root, run on either platform:

```bash
cd tarsTutor
yarn dev:tutor
```

This starts both the backend and frontend. Open the frontend URL printed in the terminal (normally `http://127.0.0.1:3000`). Backend API documentation is available at `http://127.0.0.1:8000/docs`.

Allow microphone access to ask questions by voice. Restart the app after changing environment variables.

## Project structure

```text
tarsTutor/       React frontend, whiteboard, and Netlify API proxy
tarsBe/          FastAPI backend, AI lesson generation, speech, and SQLite storage
netlify.toml     Frontend deployment configuration
```

For build, test, and deployment details, see the [frontend guide](tarsTutor/README.md) and [backend guide](tarsBe/README.md).

## License

Built on [Excalidraw](https://github.com/excalidraw/excalidraw). The upstream MIT license and copyright notice are retained in [LICENSE](tarsTutor/LICENSE).

# TarsTutor backend

Python 3.11+ backend using FastAPI, LangChain, Gemini, and LangGraph.

Read [draft.md](draft.md) for the implementation, API examples, test instructions, and remaining work.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-lock.txt
# Edit .env: set GEMINI_API_KEY and a model available to your account.
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000/docs. Run offline checks with `.\.venv\Scripts\python.exe -m pytest -q`.

The frontend now connects through its Vite `/api/tutor` proxy. From the sibling `tarsTutor` folder, `yarn dev:tutor` starts both services, reusing an existing TarsTutor backend if present. Keep the key in this backend's `.env`. Restart an existing backend after code/config changes.

import asyncio
import hashlib
import hmac
import json
import logging
import time
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError

from .config import Settings
from .graph import build_graph
from .models import PublicQuestion, TurnRequest, TurnResponse, TutorLesson, StrictModel
from pydantic import Field


class LegacyPrompt(StrictModel):
    prompt: str = Field(min_length=1, max_length=4000)
from .provider import create_provider, Provider, ProviderUnavailable
from .store import Store
from .lessons import LessonService, create_lesson_router
from .speech import create_speech_router

logger = logging.getLogger("tars.tutor")


def create_app(settings: Settings | None = None, provider: Provider | None = None) -> FastAPI:
    config = settings or Settings()
    graph = build_graph(provider) if provider else None
    gate = asyncio.Semaphore(config.max_concurrent_turns)
    lessons = LessonService(config, provider, gate)
    store: Store | None = None
    inflight: dict[str, tuple[str, str, asyncio.Task]] = {}

    @asynccontextmanager
    async def lifespan(app):
        nonlocal store
        store = Store(config.db_path)
        lessons.start()
        yield
        await lessons.close()
        tasks = [item[2] for item in inflight.values()]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    api = FastAPI(title="TarsTutor Backend", version="0.1.0", lifespan=lifespan)
    @api.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, error: RequestValidationError):
        # Validation errors must not echo entire uploaded drawings/source files.
        return JSONResponse(status_code=422, content={"detail": [
            {"type": item["type"], "loc": list(item["loc"]), "msg": item["msg"]}
            for item in error.errors()
        ]})
    if config.cors_origins:
        api.add_middleware(CORSMiddleware, allow_origins=config.cors_origins, allow_methods=["GET", "POST"], allow_headers=["Content-Type", "X-API-Key"])

    @api.middleware("http")
    async def request_limits(request: Request, call_next):
        # Check actual bytes too: Content-Length alone does not limit chunked requests.
        if request.method == "POST":
            path = request.url.path
            if path == "/api/tutor/speech/stt":
                limit = 4 * 1024 * 1024
            elif path.startswith("/api/tutor/lessons/") and path.endswith("/questions"):
                limit = 3 * 1024 * 1024
            elif path == "/api/tutor/uploads" or path == "/api/tutor/lessons" or path.endswith("/materials"):
                limit = 12 * 1024 * 1024
            else:
                limit = 24000
            size = 0
            chunks = []
            async for chunk in request.stream():
                size += len(chunk)
                if size > limit:
                    return JSONResponse(status_code=413, content={"detail": "Request exceeds the upload or message size limit."})
                chunks.append(chunk)
            request._body = b"".join(chunks)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    def authorize(x_api_key: str | None = Header(default=None)):
        expected = config.backend_api_token.get_secret_value()
        if expected and not hmac.compare_digest(x_api_key or "", expected):
            raise HTTPException(401, "Invalid backend API token.")

    api.include_router(create_lesson_router(lessons), dependencies=[Depends(authorize)])
    api.include_router(create_speech_router(config), dependencies=[Depends(authorize)])

    @api.get("/health")
    async def health():
        return {"status": "ok", "llm_configured": bool(provider or config.llm_api_key.get_secret_value()), "model": config.llm_model}

    @api.get("/ready")
    async def ready():
        if not provider and not config.llm_api_key.get_secret_value():
            raise HTTPException(503, config.missing_llm_key_message)
        return {"status": "ready", "note": "Configuration present; provider connectivity is checked on a turn."}

    @api.post("/api/tutor/sessions", status_code=201, dependencies=[Depends(authorize)])
    async def create_session():
        return store.create()

    @api.get("/api/tutor/sessions/{session_id}", dependencies=[Depends(authorize)])
    async def get_session(session_id: str):
        session = store.session(session_id)
        if not session:
            raise HTTPException(404, "Session not found.")
        question = session.pop("active_question")
        session["active_question"] = PublicQuestion(id=question["id"], **{k: question["key"][k] for k in ("prompt", "kind", "choices")}).model_dump() if question else None
        return session

    async def execute_turn(session_id: str, body: TurnRequest):
        nonlocal graph
        started = time.monotonic()
        request_data = body.model_dump()
        fingerprint = hashlib.sha256(json.dumps(request_data, sort_keys=True).encode()).hexdigest()
        session = store.session(session_id)
        if not session:
            raise HTTPException(404, "Session not found.")
        cached = store.cached(session_id, body.turn_id)
        if cached:
            if cached[0] != fingerprint:
                raise HTTPException(409, "turn_id already used with different input.")
            return cached[1]
        if body.answer_to_question_id and (not session["active_question"] or session["active_question"]["id"] != body.answer_to_question_id):
            raise HTTPException(422, "Question is not the active question in this session.")
        if not provider and not config.llm_api_key.get_secret_value():
            raise HTTPException(503, config.missing_llm_key_message)
        if graph is None:
            graph = build_graph(create_provider(config))
        # Avoid building an unbounded queue of paid generations.
        if gate.locked():
            raise HTTPException(429, "Backend is busy. Retry this turn later.")
        try:
            async with gate:
                async with asyncio.timeout(config.turn_timeout_seconds):
                    result = await graph.ainvoke({"request": body, "context": session, "trace": [], "evidence": [], "rounds": 0, "repairs": 0}, config={"recursion_limit": 24})
        except TimeoutError:
            raise HTTPException(504, "Tutor turn timed out; retry with the same turn_id.") from None
        except ProviderUnavailable:
            raise HTTPException(503, "The AI provider is temporarily unavailable after one retry. Try this turn again shortly.") from None
        except ValidationError:
            raise HTTPException(502, "The model returned an invalid decision. Retry this turn.") from None
        except Exception as exc:
            # Exception messages may contain provider credentials or private prompt data.
            logger.warning("tutor_provider_failure type=%s", type(exc).__name__)
            raise HTTPException(502, "LLM request failed. Check the configured key/model, quota, and provider availability.") from None
        draft = result["draft"]
        lesson = None
        if draft.lesson:
            lesson_data = draft.lesson.model_dump()
            for i, step in enumerate(lesson_data["steps"]):
                step["id"] = f"step-{i + 1}"
                for j, block in enumerate(step["blocks"]):
                    block["id"] = f"block-{j + 1}"
            lesson_id = hashlib.sha256(f"{session_id}:{body.turn_id}".encode()).hexdigest()[:32]
            lesson = TutorLesson(lessonId=f"tutor-{lesson_id}", turnId=body.turn_id, **lesson_data)
        question = session["active_question"]
        public_question = None
        if draft.question:
            qid = f"q-{uuid4().hex}"
            question = {"id": qid, "key": draft.question.model_dump()}
            public_question = PublicQuestion(id=qid, prompt=draft.question.prompt, kind=draft.question.kind, choices=draft.question.choices)
        response = TurnResponse(session_id=session_id, turn_id=body.turn_id, status=result["status"], intent=result["classification"].intent,
            reply=draft.reply, lesson=lesson, question=public_question, feedback=result.get("feedback"),
            next_action="clarify" if result["status"] != "completed" else "answer_question" if public_question else "continue",
            trace=result["trace"], model=config.llm_model)
        try:
            store.commit(session_id, fingerprint, request_data, response.model_dump(), session["revision"], question)
        except ValueError:
            # A simultaneous duplicate may already have committed this exact request.
            cached = store.cached(session_id, body.turn_id)
            if cached and cached[0] == fingerprint:
                return cached[1]
            raise HTTPException(409, "Session changed during generation. Retry against the updated session.") from None
        logger.info("tutor_turn status=%s duration_ms=%d nodes=%s", response.status, (time.monotonic() - started) * 1000, response.trace)
        return response

    @api.post("/api/tutor/sessions/{session_id}/turns", response_model=TurnResponse, dependencies=[Depends(authorize)])
    async def turn(session_id: str, body: TurnRequest):
        fingerprint = hashlib.sha256(json.dumps(body.model_dump(), sort_keys=True).encode()).hexdigest()
        existing = inflight.get(session_id)
        if existing:
            if existing[0] != body.turn_id or existing[1] != fingerprint:
                raise HTTPException(409, "Another request is running for this conversation. Wait for it or retry that request.")
            # Retrying after client cancellation joins the original generation.
            return await asyncio.shield(existing[2])
        task = asyncio.create_task(execute_turn(session_id, body))
        inflight[session_id] = (body.turn_id, fingerprint, task)

        def completed(finished):
            if inflight.get(session_id, (None, None, None))[2] is finished:
                inflight.pop(session_id, None)
            if not finished.cancelled():
                finished.exception()  # Retrieve exceptions even if the HTTP caller disconnected.

        task.add_done_callback(completed)
        return await asyncio.shield(task)

    @api.post("/api/tutor/gemini", dependencies=[Depends(authorize)], deprecated=True)
    async def legacy_turn(body: LegacyPrompt, request: Request, response: Response):
        # Older open tabs still use this URL and expect {lesson, model}.
        sid = request.cookies.get("tars_legacy_session")
        if not sid or not store.session(sid):
            sid = store.create()["session_id"]
        tid = uuid4().hex
        result = TurnResponse.model_validate(await turn(sid, TurnRequest(turn_id=tid, message=body.prompt)))
        lesson = result.lesson or TutorLesson(
            lessonId=f"tutor-{tid}", turnId=tid, title="Tutor response", reply=result.reply,
            steps=[{"id": "step-1", "title": "Explanation", "explanation": result.reply,
                    "blocks": [{"id": "block-1", "type": "text", "text": result.reply[:240], "caption": ""}]}],
        )
        response.set_cookie("tars_legacy_session", sid, httponly=True, samesite="lax")
        return {"lesson": lesson.model_dump(), "model": result.model}

    return api


app = create_app()

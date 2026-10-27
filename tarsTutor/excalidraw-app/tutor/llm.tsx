import { useEffect, useRef, useState } from "react";

import {
  object,
  parseId,
  parseQuestion,
  parseTutorResponse,
} from "../../shared/agent";

import type { RefObject } from "react";
import type {
  BoardContext,
  TutorQuestion,
  TutorRequest,
  TutorResponse,
} from "../../shared/agent";

const STORAGE_KEY = "tars-tutor-session-v1";
export type LLMTurn = {
  id: string;
  prompt: string;
  response?: TutorResponse;
  request?: TutorRequest;
  error?: string;
};
type Options = {
  context?: BoardContext;
  action?: "message" | "review_work";
  questionId?: string;
};

const request = async (
  view: Window,
  path: string,
  signal: AbortSignal,
  body?: unknown,
) => {
  const response = await view.fetch(`/api/tutor/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      data && typeof data === "object" && "detail" in data ? data.detail : null;
    throw new Error(
      response.status === 404
        ? "This tutor session no longer exists. Start a new conversation."
        : typeof detail === "string"
        ? detail
        : response.status === 422
        ? "The request was not accepted. Check your answer or selected work."
        : "Tutor backend is unavailable. Start FastAPI on port 8000 and try again.",
    );
  }
  return data;
};

export const useLLM = (node: RefObject<HTMLElement | null>) => {
  const [turns, setTurns] = useState<LLMTurn[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [sessionError, setSessionError] = useState("");
  const [activeQuestion, setActiveQuestion] = useState<TutorQuestion | null>(
    null,
  );
  const active = useRef<AbortController | null>(null);
  const sessionId = useRef<string | null>(null);
  const pending = useRef<TutorRequest | null>(null);
  const persist = (view: Window) => {
    try {
      view.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          sessionId: sessionId.current,
          pending: pending.current,
        }),
      );
    } catch {
      /* Storage can be disabled. */
    }
  };

  useEffect(() => {
    const view = node.current?.ownerDocument.defaultView;
    if (!view) {
      setIsRestoring(false);
      return;
    }
    let alive = true;
    const controller = new view.AbortController();
    const timeout = view.setTimeout(() => controller.abort(), 10000);
    const restore = async () => {
      try {
        let stored: string | null = null;
        try {
          stored = view.localStorage.getItem(STORAGE_KEY);
        } catch {
          /* Use an in-memory session. */
        }
        const saved = JSON.parse(stored || "null");
        if (!saved?.sessionId) {
          return;
        }
        const id = parseId(saved.sessionId);
        sessionId.current = id;
        const data = object(
          await request(view, `sessions/${id}`, controller.signal),
        );
        if (!alive || controller.signal.aborted) {
          return;
        }
        if (!Array.isArray(data.recent_turns)) {
          throw new Error("Could not restore this tutor conversation.");
        }
        const restored = data.recent_turns.map((raw): LLMTurn => {
          const turn = object(raw);
          const response = parseTutorResponse(turn.response, id);
          return {
            id: response.turn_id,
            prompt: String(turn.message),
            response,
          };
        });
        if (
          saved.pending &&
          !restored.some((turn) => turn.id === saved.pending.turn_id)
        ) {
          const previous = object(saved.pending);
          if (
            typeof previous.message === "string" &&
            previous.message.length <= 4000 &&
            previous.board_context
          ) {
            parseId(previous.turn_id);
            pending.current = saved.pending;
            restored.push({
              id: saved.pending.turn_id,
              prompt: saved.pending.message,
              request: saved.pending,
              error:
                "This request was interrupted. Retry to recover its result.",
            });
          }
        } else {
          pending.current = null;
          persist(view);
        }
        setTurns(restored);
        setActiveQuestion(parseQuestion(data.active_question));
      } catch (error) {
        if (alive) {
          setSessionError(
            controller.signal.aborted
              ? "Could not restore the conversation. Check that FastAPI is running."
              : error instanceof Error
              ? error.message
              : "Could not restore the conversation.",
          );
        }
      } finally {
        view.clearTimeout(timeout);
        if (alive) {
          setIsRestoring(false);
        }
      }
    };
    void restore();
    return () => {
      alive = false;
      controller.abort();
      active.current?.abort();
      active.current = null;
      view.clearTimeout(timeout);
    };
  }, [node]);

  const cancel = () => active.current?.abort();
  const run = async (
    payload: TutorRequest,
    ownerDocument: Document,
  ): Promise<TutorResponse | null> => {
    const view = ownerDocument.defaultView;
    if (!view || active.current) {
      return null;
    }
    const controller = new view.AbortController();
    active.current = controller;
    setIsLoading(true);
    setSessionError("");
    setTurns((previous) => [
      ...previous.filter((turn) => turn.id !== payload.turn_id),
      { id: payload.turn_id, prompt: payload.message, request: payload },
    ]);
    const timeout = view.setTimeout(() => controller.abort(), 195000);
    try {
      if (!sessionId.current) {
        const created = object(
          await request(view, "sessions", controller.signal, {}),
        );
        sessionId.current = parseId(created.session_id);
      }
      pending.current = payload;
      persist(view);
      const id = sessionId.current;
      const result = parseTutorResponse(
        await request(view, `sessions/${id}/turns`, controller.signal, payload),
        id,
        payload.turn_id,
      );
      if (controller.signal.aborted || active.current !== controller) {
        if (active.current === controller) {
          setTurns((previous) =>
            previous.map((turn) =>
              turn.id === payload.turn_id
                ? {
                    ...turn,
                    error:
                      "Stopped waiting. Retry this request to recover a saved result.",
                  }
                : turn,
            ),
          );
        }
        return null;
      }
      pending.current = null;
      persist(view);
      setTurns((previous) =>
        previous.map((turn) =>
          turn.id === payload.turn_id
            ? { ...turn, response: result, error: undefined }
            : turn,
        ),
      );
      if (result.question) {
        setActiveQuestion(result.question);
      }
      return result;
    } catch (error) {
      if (active.current === controller) {
        const message = controller.signal.aborted
          ? "Stopped waiting. Retry this request to recover a saved result."
          : error instanceof Error
          ? error.message
          : "Could not reach the tutor backend.";
        setTurns((previous) =>
          previous.map((turn) =>
            turn.id === payload.turn_id ? { ...turn, error: message } : turn,
          ),
        );
      }
      return null;
    } finally {
      view.clearTimeout(timeout);
      if (active.current === controller) {
        active.current = null;
        setIsLoading(false);
      }
    }
  };
  const submit = (
    prompt: string,
    ownerDocument: Document,
    options: Options = {},
  ) => {
    const view = ownerDocument.defaultView;
    if (!view || !prompt.trim() || isRestoring || sessionError) {
      return Promise.resolve(null);
    }
    const payload: TutorRequest = {
      turn_id: view.crypto.randomUUID(),
      message: prompt.trim(),
      action: options.action || "message",
      board_context: {
        ...(options.context || { selected_element_ids: [], selected_text: "" }),
      },
      ...(options.questionId
        ? { answer_to_question_id: options.questionId }
        : {}),
    };
    // Accommodate multibyte text within the server's 24KB body limit.
    while (
      new view.TextEncoder().encode(JSON.stringify(payload)).length > 23000 &&
      payload.board_context.selected_text.length
    ) {
      payload.board_context.selected_text =
        payload.board_context.selected_text.slice(
          0,
          Math.floor(payload.board_context.selected_text.length / 2),
        );
    }
    return run(payload, ownerDocument);
  };
  const retry = (turn: LLMTurn, ownerDocument: Document) =>
    turn.request ? run(turn.request, ownerDocument) : Promise.resolve(null);
  const reset = () => {
    if (active.current) {
      return;
    }
    sessionId.current = null;
    pending.current = null;
    setTurns([]);
    setActiveQuestion(null);
    setSessionError("");
    const view = node.current?.ownerDocument.defaultView;
    if (view) {
      persist(view);
    }
  };
  return {
    turns,
    isLoading,
    isRestoring,
    sessionError,
    activeQuestion,
    submit,
    retry,
    cancel,
    reset,
  };
};

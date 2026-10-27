import { TextEncoder } from "node:util";

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { parseTutorResponse } from "../../shared/agent";

import { TutorOverlay } from "./TutorOverlay";
import { useLLM } from "./llm";

vi.mock("./boardController", () => ({
  showGeneratedLesson: vi.fn(),
  showSampleLesson: vi.fn(),
}));

const answer = (id: string, extra = {}) => ({
  session_id: "session-1",
  turn_id: id,
  status: "completed",
  intent: "follow_up",
  reply: "A probability is not a guarantee.",
  lesson: null,
  question: null,
  feedback: null,
  next_action: "continue",
  model: "test-model",
  ...extra,
});
const json = (data: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => data,
});
const fetchMock = vi.fn();

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("TextEncoder", TextEncoder);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const hook = () => {
  const ref = { current: document.createElement("textarea") };
  return renderHook(() => useLLM(ref));
};
const handleRequests = () =>
  fetchMock.mockImplementation(async (url: string, options: RequestInit) => {
    if (url.endsWith("/sessions")) {
      return json({ session_id: "session-1" });
    }
    const body = JSON.parse(options.body as string);
    return json(answer(body.turn_id));
  });

describe("FastAPI tutor client", () => {
  it("sends only selected board text for work review", async () => {
    handleRequests();
    const api = {
      getAppState: () => ({ selectedElementIds: { work: true } }),
      getSceneElements: () => [
        { id: "work", type: "text", text: "2 + 2 = 5" },
        { id: "private", type: "text", text: "Unrelated private notes" },
      ],
      onChange: () => () => {},
    } as unknown as ExcalidrawImperativeAPI;
    render(
      <TutorOverlay excalidrawAPI={api} theme="light" autoLoadDemo={false} />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Review selected work" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Review selected work" }),
    );
    await screen.findByText("A probability is not a guarantee.");
    const payload = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(payload.action).toBe("review_work");
    expect(payload.board_context.selected_text).toBe("2 + 2 = 5");
    expect(payload.board_context.selected_element_ids).toEqual(["work"]);
    expect(fetchMock.mock.calls[1][1].body).not.toContain(
      "Unrelated private notes",
    );
  });
  it("creates a session once and displays replies without requiring a board lesson", async () => {
    handleRequests();
    const { result } = hook();
    await waitFor(() => expect(result.current.isRestoring).toBe(false));
    await act(async () => {
      await result.current.submit("Why?", document);
    });
    await act(async () => {
      await result.current.submit("Explain again", document);
    });
    expect(
      fetchMock.mock.calls.filter(([url]) => url.endsWith("/sessions")),
    ).toHaveLength(1);
    expect(result.current.turns[1].response?.reply).toBe(
      "A probability is not a guarantee.",
    );
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).turn_id).not.toBe(
      JSON.parse(fetchMock.mock.calls[1][1].body).turn_id,
    );
  });

  it("retries exactly the same turn and frozen board context after a provider error", async () => {
    handleRequests();
    const implementation = fetchMock.getMockImplementation()!;
    let fail = true;
    fetchMock.mockImplementation(async (url, options) => {
      if (url.endsWith("/turns") && fail) {
        fail = false;
        return json({ detail: "Temporarily unavailable" }, 503);
      }
      return implementation(url, options);
    });
    const { result } = hook();
    await waitFor(() => expect(result.current.isRestoring).toBe(false));
    await act(async () => {
      await result.current.submit("Check this", document, {
        context: {
          selected_element_ids: ["text-1"],
          selected_text: "2 + 2 = 5",
        },
      });
    });
    expect(result.current.turns[0].error).toContain("Temporarily unavailable");
    await act(async () => {
      await result.current.retry(result.current.turns[0], document);
    });
    expect(fetchMock.mock.calls[2][1].body).toBe(
      fetchMock.mock.calls[1][1].body,
    );
    expect(result.current.turns).toHaveLength(1);
    expect(result.current.turns[0].response).toBeTruthy();
  });

  it("restores persisted conversation and the active question", async () => {
    localStorage.setItem(
      "tars-tutor-session-v1",
      JSON.stringify({ sessionId: "session-1" }),
    );
    fetchMock.mockResolvedValue(
      json({
        recent_turns: [{ message: "Why?", response: answer("old-turn") }],
        active_question: {
          id: "q-1",
          prompt: "What is 3 + 4?",
          kind: "numeric",
          choices: [],
        },
      }),
    );
    const { result } = hook();
    await waitFor(() => expect(result.current.isRestoring).toBe(false));
    expect(result.current.turns[0].id).toBe("old-turn");
    expect(result.current.activeQuestion?.id).toBe("q-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tutor/sessions/session-1",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("ignores an answer arriving after cancellation", async () => {
    let finish: (value: unknown) => void = () => {};
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith("/sessions")
        ? json({ session_id: "session-1" })
        : new Promise((resolve) => {
            finish = resolve;
          }),
    );
    const { result } = hook();
    await waitFor(() => expect(result.current.isRestoring).toBe(false));
    let running: Promise<unknown>;
    act(() => {
      running = result.current.submit("Why?", document);
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const payload = JSON.parse(fetchMock.mock.calls[1][1].body);
    await act(async () => {
      result.current.cancel();
      finish(json(answer(payload.turn_id)));
      await running;
    });
    expect(result.current.turns[0].response).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it("rejects mismatched session/turn responses before they reach the board", () => {
    expect(() =>
      parseTutorResponse(answer("turn-1"), "other-session", "turn-1"),
    ).toThrow();
    expect(() =>
      parseTutorResponse(answer("turn-1"), "session-1", "turn-2"),
    ).toThrow();
    expect(() =>
      parseTutorResponse(
        answer("turn-1", { lesson: { turnId: "wrong" } }),
        "session-1",
      ),
    ).toThrow();
  });

  it("supports a practice answer and shows answer feedback in the conversation", async () => {
    let question = false;
    fetchMock.mockImplementation(async (url: string, options: RequestInit) => {
      if (url.endsWith("/sessions")) {
        return json({ session_id: "session-1" });
      }
      const body = JSON.parse(options.body as string);
      if (!question) {
        question = true;
        return json(
          answer(body.turn_id, {
            reply: "Try this question.",
            question: {
              id: "q-1",
              prompt: "What is 3 + 4?",
              kind: "numeric",
              choices: [],
            },
          }),
        );
      }
      expect(body.answer_to_question_id).toBe("q-1");
      expect(body.message).toBe("7");
      return json(
        answer(body.turn_id, {
          reply: "Well done.",
          feedback: { question_id: "q-1", correct: true, message: "Correct." },
        }),
      );
    });
    const api = {
      getAppState: () => ({ selectedElementIds: {} }),
      getSceneElements: () => [],
      onChange: () => () => {},
    } as unknown as ExcalidrawImperativeAPI;
    render(
      <TutorOverlay excalidrawAPI={api} theme="light" autoLoadDemo={false} />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Your question")).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText("Your question"), {
      target: { value: "Ask a practice question" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send to tutor" }));
    await screen.findByText("Try this question.");
    fireEvent.change(screen.getByLabelText("Your answer"), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    await screen.findByText("Well done.");
    expect(screen.getByText("Correct: Correct.")).toBeInTheDocument();
  });
});

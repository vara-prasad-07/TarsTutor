import { StrictMode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TarsApp from "./TarsApp";

vi.mock("./Classroom", () => ({
  default: ({ snapshot }: { snapshot: { title: string } }) => (
    <main aria-label="Verified classroom">{snapshot.title}</main>
  ),
}));
const fetchMock = vi.fn();
const json = (data: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => data,
});
const snapshot = (id: string, extra = {}) => ({
  session_id: id,
  prompt: "Teach me regression",
  title: "Linear regression",
  status: "generating",
  stage: "plan",
  generating: true,
  stages: [
    {
      id: "understand",
      label: "Understanding your learning request",
      status: "completed",
    },
    {
      id: "plan",
      label: "Planning your personalized lesson",
      status: "active",
    },
  ],
  segments: [],
  materials: [],
  error: null,
  revision: 1,
  ...extra,
});
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("three-screen lesson navigation", () => {
  it("opens real generation immediately and enters the classroom as soon as a segment is ready", async () => {
    let id = "";
    let playable = false;
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === "/api/tutor/lessons") {
        id = JSON.parse(options?.body as string).session_id;
        return json(snapshot(id), 202);
      }
      return json(
        snapshot(
          id,
          playable ? { segments: [{ id: "segment-1" }], status: "ready" } : {},
        ),
      );
    });
    render(
      <StrictMode>
        <TarsApp view={window} />
      </StrictMode>,
    );
    fireEvent.change(
      screen.getByLabelText("What would you like to learn today?"),
      { target: { value: "Teach me regression" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /Start lesson/ }));
    expect(
      screen.getByRole("heading", { name: "Creating your lesson…" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(id).toBeTruthy());
    expect(window.location.pathname).toBe(`/lesson/generating/${id}`);
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "1");
    playable = true;
    await waitFor(
      () =>
        expect(
          screen.getByRole("main", { name: "Verified classroom" }),
        ).toBeInTheDocument(),
      { timeout: 4000 },
    );
    expect(window.location.pathname).toBe(`/lesson/${id}`);
    expect(
      fetchMock.mock.calls.filter(([url]) => url === "/api/tutor/lessons"),
    ).toHaveLength(1);
  });

  it("restores a classroom directly from its URL without creating a duplicate lesson", async () => {
    window.history.replaceState({}, "", "/lesson/saved-session");
    fetchMock.mockResolvedValue(
      json(
        snapshot("saved-session", {
          generating: false,
          status: "completed",
          segments: [{ id: "segment-1" }],
        }),
      ),
    );
    render(<TarsApp view={window} />);
    await screen.findByRole("main", { name: "Verified classroom" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/tutor/lessons/saved-session");
  });

  it("shows a server failure and retries the same lesson ID", async () => {
    window.history.replaceState({}, "", "/lesson/generating/failed-session");
    let retried = false;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/retry")) {
        retried = true;
        return json(snapshot("failed-session"), 202);
      }
      return json(
        snapshot(
          "failed-session",
          retried
            ? {}
            : {
                status: "failed",
                generating: false,
                error: "Provider quota reached. Retry shortly.",
              },
        ),
      );
    });
    render(<TarsApp view={window} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Provider quota reached",
    );
    fireEvent.click(screen.getByRole("button", { name: /Retry lesson/ }));
    await waitFor(() => expect(retried).toBe(true));
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(window.location.pathname).toContain("failed-session");
  });
});

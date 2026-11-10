import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useClassroomAudio } from "./useClassroomAudio";

const fetchMock = vi.fn();
let audio: HTMLMediaElement;
let playSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    blob: async () => new Blob(["wav"], { type: "audio/wav" }),
  });
  vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(100);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    audio = this;
    queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
  });
  playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  Object.defineProperty(window.URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:narration"),
  });
  Object.defineProperty(window.URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("classroom narration ownership", () => {
  it("synthesizes a Telugu drawing explanation using the Telugu voice route", async () => {
    const hook = renderHook(() => useClassroomAudio(window, 1, false));
    await act(async () => {
      await hook.result.current.play("వైశాల్యం మూడు గుణం ఏడు", 20, "reply");
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      language: "te-IN",
    });
  });
  it("pauses at the exact media position, answers without moving the lesson, and resumes there", async () => {
    const hook = renderHook(() => useClassroomAudio(window, 1, false));
    await act(async () => {
      await hook.result.current.play("Main lesson", 100);
    });
    expect(hook.result.current.playing).toBe(true);
    audio.currentTime = 42.75;
    act(() => hook.result.current.pause());
    expect(hook.result.current.progress).toBeCloseTo(0.4275);
    await act(async () => {
      await hook.result.current.play("Contextual answer", 20, "reply");
    });
    expect(audio.currentTime).toBe(0);
    expect(hook.result.current.progress).toBeCloseTo(0.4275);
    audio.currentTime = 100;
    act(() => audio.dispatchEvent(new Event("ended")));
    expect(hook.result.current.playing).toBe(false);
    expect(hook.result.current.progress).toBeCloseTo(0.4275);
    await act(async () => {
      await hook.result.current.play("Main lesson", 100);
    });
    expect(audio.currentTime).toBeCloseTo(42.75);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(playSpy).toHaveBeenCalledTimes(3);
    hook.rerender();
  });

  it("does not start a buffered request after the student has paused", async () => {
    let release!: (value: unknown) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const hook = renderHook(() => useClassroomAudio(window, 1, false));
    let request!: Promise<void>;
    act(() => {
      request = hook.result.current.play("Slow narration", 30);
    });
    expect(hook.result.current.loading).toBe(true);
    act(() => hook.result.current.pause());
    await act(async () => {
      release({ ok: true, blob: async () => new Blob(["wav"]) });
      await request;
    });
    expect(playSpy).not.toHaveBeenCalled();
    expect(hook.result.current.playing).toBe(false);
  });

  it("seeks from the board clock and applies speed and mute to the same audio element", async () => {
    const hook = renderHook(
      ({ speed, muted }) => useClassroomAudio(window, speed, muted),
      { initialProps: { speed: 1, muted: false } },
    );
    await act(async () => {
      await hook.result.current.play("Narration", 100);
    });
    act(() => hook.result.current.setProgress(0.65));
    expect(audio.currentTime).toBe(65);
    hook.rerender({ speed: 1.5, muted: true });
    expect(audio.playbackRate).toBe(1.5);
    expect(audio.muted).toBe(true);
    audio.currentTime = 80;
    await waitFor(() => expect(hook.result.current.progress).toBeCloseTo(0.8));
  });
});

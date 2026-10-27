import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { playGeneratedLesson } from "./lessonPlayback";

import type { TutorLesson } from "../../shared/tutor";

const lesson: TutorLesson = {
  lessonId: "typing-example",
  turnId: "turn-1",
  title: "A deliberately long lesson title",
  reply: "A complete reply should emerge a few characters at a time.",
  steps: [
    {
      id: "first",
      title: "First idea",
      explanation: "",
      blocks: [
        { id: "text", type: "text", text: "Build understanding slowly." },
      ],
    },
  ],
};

afterEach(() => vi.useRealTimers());

describe("lesson playback", () => {
  it("reveals partial text, pauses, and finishes with the complete editable lesson", () => {
    vi.useFakeTimers();
    let scene: ExcalidrawElement[] = [];
    const api = {
      getSceneElementsIncludingDeleted: () => scene,
      updateScene: ({ elements }: { elements: ExcalidrawElement[] }) => {
        scene = elements;
      },
      setViewport: vi.fn(),
    } as unknown as ExcalidrawImperativeAPI;
    const onFinish = vi.fn();
    const playback = playGeneratedLesson(
      api,
      lesson,
      window,
      0,
      false,
      onFinish,
    );

    expect(scene).toHaveLength(0);
    vi.advanceTimersByTime(300);
    const partial = scene.find(
      (element) => element.type === "text" && element.id.includes("header"),
    );
    expect(partial?.type).toBe("text");
    if (partial?.type === "text") {
      expect(partial.text.length).toBeGreaterThan(0);
      expect(partial.text.length).toBeLessThan(lesson.title.length);
    }
    vi.advanceTimersByTime(160);
    const progressed = scene.find((element) => element.id === partial?.id);
    expect(progressed?.version).toBeGreaterThan(partial?.version || 0);

    playback.setPaused(true);
    const pausedText = scene.map((element) =>
      element.type === "text" ? element.text : "",
    );
    vi.advanceTimersByTime(1000);
    expect(
      scene.map((element) => (element.type === "text" ? element.text : "")),
    ).toEqual(pausedText);

    playback.setSpeed(3);
    playback.setPaused(false);
    vi.advanceTimersByTime(200);
    expect(
      scene.find(
        (element) => element.type === "text" && element.id.includes("header"),
      ),
    ).toBeTruthy();

    playback.finish();
    expect(
      scene.some(
        (element) => element.type === "text" && element.text === lesson.title,
      ),
    ).toBe(true);
    expect(
      scene.some(
        (element) =>
          element.type === "text" &&
          element.text.includes("Build understanding slowly."),
      ),
    ).toBe(true);
    expect(onFinish).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000);
    expect(onFinish).toHaveBeenCalledOnce();
  });
});

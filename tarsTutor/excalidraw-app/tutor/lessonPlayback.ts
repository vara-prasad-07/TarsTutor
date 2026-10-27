import {
  CaptureUpdateAction,
  getCommonBounds,
  newElementWith,
} from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { createLessonElements, showGeneratedLesson } from "./boardController";

import type { TutorLesson } from "../../shared/tutor";

export const WRITING_SPEEDS = [
  { label: "Gentle", charactersPerSecond: 38 },
  { label: "Steady", charactersPerSecond: 65 },
  { label: "Brisk", charactersPerSecond: 100 },
  { label: "Swift", charactersPerSecond: 150 },
] as const;

export type LessonPlayback = {
  setSpeed: (speed: number) => void;
  setPaused: (paused: boolean) => void;
  finish: () => void;
};

/** Reveal a complete response on the board without changing its final layout. */
export const playGeneratedLesson = (
  api: ExcalidrawImperativeAPI,
  lesson: TutorLesson,
  view: Window,
  speed: number,
  focus: boolean,
  onFinish: () => void,
): LessonPlayback => {
  if (view.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    showGeneratedLesson(api, lesson, focus);
    onFinish();
    return { setSpeed: () => {}, setPaused: () => {}, finish: () => {} };
  }
  const initial = api.getSceneElementsIncludingDeleted();
  if (
    initial.some(
      (element) =>
        !element.isDeleted && element.customData?.lessonId === lesson.lessonId,
    )
  ) {
    showGeneratedLesson(api, lesson, focus);
    onFinish();
    return { setSpeed: () => {}, setPaused: () => {}, finish: () => {} };
  }

  const visible = initial.filter((element) => !element.isDeleted);
  const elements = createLessonElements(
    lesson,
    visible.length ? getCommonBounds(visible)[2] + 160 : 0,
  );
  if (focus) {
    api.setViewport({
      target: getCommonBounds(elements),
      fit: "scale-down",
      animation: true,
      offsets: {
        ui: true,
        top: 112,
        bottom: 200,
        left: 24,
        right: api.getAppState().width >= 900 ? 400 : 24,
      },
    });
  }

  let timer: number | undefined;
  let elementIndex = 0;
  let characterIndex = 0;
  let currentSpeed = speed;
  let paused = false;
  let completed = false;
  let lastTick = view.performance.now();
  let timeCredit = 0;
  const revealed: ExcalidrawElement[] = [];
  const lastWritten = new Map<string, ExcalidrawElement>();
  const studentChanged = new Set<string>();

  const write = (
    captureUpdate: typeof CaptureUpdateAction[keyof typeof CaptureUpdateAction],
  ) => {
    const current = api.getSceneElementsIncludingDeleted();
    const existing = new Map(current.map((element) => [element.id, element]));
    // Keep student edits and other lessons made while the tutor is writing.
    const additions = revealed.map((element) => {
      const previous = existing.get(element.id);
      const last = lastWritten.get(element.id);
      if (previous && last && previous.versionNonce !== last.versionNonce) {
        studentChanged.add(element.id);
      }
      const next =
        studentChanged.has(element.id) && previous ? previous : element;
      lastWritten.set(element.id, next);
      return next;
    });
    const ids = new Set(additions.map((element) => element.id));
    api.updateScene({
      elements: [
        ...current.filter((element) => !ids.has(element.id)),
        ...additions,
      ],
      captureUpdate,
    });
  };

  const complete = () => {
    if (completed) {
      return;
    }
    completed = true;
    if (timer !== undefined) {
      view.clearTimeout(timer);
    }
    const written = new Map(revealed.map((element) => [element.id, element]));
    revealed.splice(
      0,
      revealed.length,
      ...elements.map((element) => {
        const previous = written.get(element.id);
        return previous?.type === "text" && element.type === "text"
          ? newElementWith(previous, {
              text: element.text,
              originalText: element.originalText,
            })
          : element;
      }),
    );
    write(CaptureUpdateAction.IMMEDIATELY);
    onFinish();
  };

  const tick = () => {
    if (completed || paused) {
      return;
    }
    const now = view.performance.now();
    timeCredit += Math.min(now - lastTick, 200);
    lastTick = now;
    let changed = false;
    while (elementIndex < elements.length) {
      const element = elements[elementIndex];
      if (element.type !== "text") {
        revealed.push(element);
        elementIndex++;
        changed = true;
        continue;
      }
      const characters = Array.from(element.text);
      const next = characters[characterIndex];
      if (next === undefined) {
        elementIndex++;
        characterIndex = 0;
        continue;
      }
      const previousCharacter = characters[characterIndex - 1] || "";
      const cost =
        1000 / WRITING_SPEEDS[currentSpeed].charactersPerSecond +
        (/[.!?]/.test(previousCharacter)
          ? 105
          : /[,;:]/.test(previousCharacter)
          ? 55
          : 0);
      if (timeCredit < cost) {
        break;
      }
      timeCredit -= cost;
      characterIndex++;
      const partial = characters.slice(0, characterIndex).join("");
      const last = revealed[revealed.length - 1];
      const previous =
        characterIndex > 1 && last?.type === "text" ? last : element;
      const typed = newElementWith(previous, {
        text: partial,
        originalText: partial,
      });
      if (characterIndex === 1) {
        revealed.push(typed);
      } else {
        revealed[revealed.length - 1] = typed;
      }
      changed = true;
    }
    if (elementIndex === elements.length) {
      complete();
      return;
    }
    if (changed) {
      write(CaptureUpdateAction.NEVER);
    }
    timer = view.setTimeout(tick, 40);
  };

  timer = view.setTimeout(tick, 40);
  return {
    setSpeed: (next) => {
      currentSpeed = next;
    },
    setPaused: (next) => {
      paused = next;
      lastTick = view.performance.now();
      if (!next && !completed) {
        if (timer !== undefined) {
          view.clearTimeout(timer);
        }
        timer = view.setTimeout(tick, 40);
      }
    },
    finish: complete,
  };
};

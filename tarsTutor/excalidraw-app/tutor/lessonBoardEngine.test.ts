import { describe, expect, it, vi } from "vitest";
import {
  convertToExcalidrawElements,
  newElementWith,
} from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { LessonElement } from "../../shared/classroom";
import {
  ClassroomBoardController,
  createClassroomBoard,
} from "./lessonBoardEngine";

export const visual = (extra: Partial<LessonElement> = {}): LessonElement => ({
  id: "example",
  type: "text",
  text: "Learn one step at a time.",
  caption: "",
  reveal_at: 0.2,
  x: 60,
  y: 160,
  width: 800,
  height: 300,
  color: "blue",
  shape: "rectangle",
  x2: 350,
  y2: 300,
  x_label: "Hours",
  y_label: "Score",
  x_min: 0,
  x_max: 5,
  y_min: 0,
  y_max: 100,
  series: [],
  columns: [],
  rows: [],
  language: "python",
  ...extra,
});
const scene = () => {
  let elements: ExcalidrawElement[] = [];
  const update = vi.fn(
    ({ elements: next }: { elements: ExcalidrawElement[] }) => {
      elements = next;
    },
  );
  return {
    api: {
      getSceneElementsIncludingDeleted: () => elements,
      updateScene: update,
    } as unknown as ExcalidrawImperativeAPI,
    get: () => elements,
    set: (next: ExcalidrawElement[]) => {
      elements = next;
    },
    update,
  };
};
const cues = () =>
  createClassroomBoard("lesson-segment", "Reading a line", "Understand slope", [
    visual(),
  ]);

describe("editable classroom scene", () => {
  it("upgrades saved tutor text contrast while preserving the student's chosen colors", () => {
    for (const edited of [false, true]) {
      const source = cues();
      const legacy = source.map((cue) => ({
        ...cue,
        element: newElementWith(cue.element, { strokeColor: "#838878" }),
      }));
      const board = scene();
      const old = new ClassroomBoardController(legacy);
      old.apply(board.api, 1);
      const target = board.get().find((e) => e.id.includes("objective"))!;
      if (edited) {
        board.set(
          board
            .get()
            .map((e) =>
              e.id === target.id
                ? newElementWith(e, { strokeColor: "#c74f83" })
                : e,
            ),
        );
        old.observe(board.get());
      }
      const restored = new ClassroomBoardController(source, {
        ...old.snapshot(),
        elements: board.get(),
      });
      restored.apply(board.api, 1);
      expect(board.get().find((e) => e.id === target.id)?.strokeColor).toBe(
        edited ? "#c74f83" : "#566477",
      );
    }
  });
  it("converts generated text, equations, graphs, tables and code into editable native elements", () => {
    const result = createClassroomBoard(
      "native-lesson",
      "Our lesson",
      "Understand and practice",
      [
        visual({ id: "equation", type: "equation", text: "y = 45 + 6x" }),
        visual({
          id: "graph",
          type: "graph",
          series: [
            {
              label: "Actual",
              kind: "points",
              color: "blue",
              points: [
                { x: 1, y: 51 },
                { x: 3, y: 63 },
              ],
            },
            {
              label: "Fit",
              kind: "line",
              color: "green",
              points: [
                { x: 0, y: 45 },
                { x: 5, y: 75 },
              ],
            },
          ],
        }),
        visual({
          id: "table",
          type: "table",
          columns: ["Hours", "Score"],
          rows: [["3", "63"]],
        }),
        visual({
          id: "code",
          type: "code",
          text: "for n in range(3):\n    print(n)",
        }),
      ],
    ).map((c) => c.element);
    expect(
      result.some((e) => e.type === "text" && e.text === "y = 45 + 6x"),
    ).toBe(true);
    expect(result.some((e) => e.type === "ellipse")).toBe(true);
    expect(result.some((e) => e.type === "line")).toBe(true);
    expect(result.some((e) => e.type === "text" && e.text === "63")).toBe(true);
    expect(
      result.some(
        (e) =>
          e.type === "text" && e.strokeColor === "#8464b6" && e.text === "for",
      ),
    ).toBe(true);
    expect(result.every((e) => !e.locked && e.type !== "image")).toBe(true);
  });
  it("reveals from the audio clock and rewinds without losing student drawings", () => {
    const board = scene(),
      controller = new ClassroomBoardController(cues());
    controller.apply(board.api, 0.22);
    const partial = board
      .get()
      .find((e) => e.type === "text" && e.id.includes("example"))!;
    expect(partial.type === "text" && partial.text.length).toBeGreaterThan(0);
    expect(partial.type === "text" && partial.text.length).toBeLessThan(24);
    const note = convertToExcalidrawElements(
      [
        {
          type: "rectangle",
          id: "student-shape",
          x: 600,
          y: 450,
          width: 100,
          height: 90,
        },
      ],
      { regenerateIds: false },
    )[0];
    board.set([...board.get(), note]);
    controller.apply(board.api, 1);
    expect(board.get().find((e) => e.id === note.id)).toBe(note);
    expect(
      board
        .get()
        .some(
          (e) => e.type === "text" && e.text === "Learn one step at a time.",
        ),
    ).toBe(true);
    controller.apply(board.api, 0);
    expect(board.get().find((e) => e.id === partial.id)?.opacity).toBe(0);
    expect(board.get().find((e) => e.id === note.id)?.opacity).toBe(100);
  });
  it("preserves edits, moved content and erased tutor objects across playback and reload", () => {
    const board = scene(),
      source = cues(),
      controller = new ClassroomBoardController(source);
    controller.apply(board.api, 0.3);
    const target = board
      .get()
      .find((e) => e.type === "text" && e.id.includes("example"))!;
    board.set(
      board
        .get()
        .map((e) =>
          e.id === target.id
            ? newElementWith(e, { x: 220, isDeleted: true })
            : e,
        ),
    );
    controller.observe(board.get());
    controller.apply(board.api, 1);
    expect(board.get().find((e) => e.id === target.id)).toMatchObject({
      x: 220,
      isDeleted: true,
    });
    const restored = new ClassroomBoardController(source, {
      ...controller.snapshot(),
      elements: board.get(),
    });
    restored.apply(board.api, 0);
    expect(board.get().find((e) => e.id === target.id)).toMatchObject({
      x: 220,
      isDeleted: true,
    });
    restored.restore(board.api, 1);
    expect(board.get().find((e) => e.id === target.id)).toMatchObject({
      x: 60,
      isDeleted: false,
    });
  });
  it("does not mistake font remeasurement for a student edit", () => {
    const board = scene(),
      controller = new ClassroomBoardController(cues());
    controller.apply(board.api, 0.22);
    board.set(
      board
        .get()
        .map((e) =>
          e.type === "text"
            ? newElementWith(e, { width: e.width + 10, height: e.height + 2 })
            : e,
        ),
    );
    controller.observe(board.get());
    controller.apply(board.api, 1);
    expect(
      board
        .get()
        .some(
          (e) => e.type === "text" && e.text === "Learn one step at a time.",
        ),
    ).toBe(true);
    expect(controller.snapshot().edited).toHaveLength(0);
  });
  it("retains the student's front/back ordering while the tutor continues", () => {
    const board = scene(),
      controller = new ClassroomBoardController(cues());
    controller.apply(board.api, 0.22);
    const note = convertToExcalidrawElements(
      [
        {
          type: "rectangle",
          id: "behind-lesson",
          x: 60,
          y: 160,
          width: 100,
          height: 80,
        },
      ],
      { regenerateIds: false },
    )[0];
    board.set([note, ...board.get()]);
    controller.apply(board.api, 1);
    expect(board.get()[0].id).toBe("behind-lesson");
  });
});

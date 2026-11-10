import { describe, expect, it } from "vitest";
import {
  convertToExcalidrawElements,
  getCommonBounds,
} from "@excalidraw/element";
import type { TutorAnswer } from "../../shared/classroom";
import { placeDrawingAnswer } from "./drawingAnswer";
import {
  ClassroomBoardController,
  createClassroomBoard,
} from "./lessonBoardEngine";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

const answer: TutorAnswer = {
  request_id: "area-1",
  board_used: true,
  reply: "Area = 3 × 7 = 21 square units.",
  narration: "Multiply three by seven to get twenty-one square units.",
  elements: [],
};
const sketch = () =>
  convertToExcalidrawElements(
    [
      {
        id: "sketch",
        type: "rectangle",
        x: 1500,
        y: -500,
        width: 300,
        height: 160,
      },
      { id: "label", type: "text", x: 1600, y: -540, text: "3" },
    ],
    { regenerateIds: false },
  );
const overlaps = (a: readonly number[], b: readonly number[]) =>
  a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
describe("drawing the answer on the student's board", () => {
  it("writes a fallback worked answer near an off-screen sketch without replacing its ink", () => {
    const original = sketch();
    const placed = placeDrawingAnswer(
      "chapter-1",
      answer,
      { ids: ["sketch", "label"], bounds: getCommonBounds(original) },
      original,
    )!;
    expect(placed.elements.slice(0, 2)).toEqual(original);
    expect(placed.elements[0]).toBe(original[0]);
    const additions = placed.elements.slice(2);
    expect(
      additions.some(
        (e) => e.type === "text" && e.text.includes("21 square units"),
      ),
    ).toBe(true);
    const bounds = getCommonBounds(additions);
    expect(overlaps(bounds, getCommonBounds(original))).toBe(false);
    expect(bounds[0]).toBeCloseTo(1500);
    expect(bounds[1]).toBeCloseTo(-290);
    expect(placed.target[1]).toBeLessThanOrEqual(-540);
    expect(
      additions.every(
        (e) =>
          e.opacity === 100 &&
          !e.locked &&
          e.customData?.answerRequestId === answer.request_id,
      ),
    ).toBe(true);
  });
  it("avoids other notes and previous answers, even after a sketch is moved during a request", () => {
    const original = sketch();
    const anchor = {
      ids: ["sketch", "label"],
      bounds: getCommonBounds(original),
    };
    const moved = original.map((e) => ({ ...e, x: e.x + 400, y: e.y + 600 }));
    const notes = convertToExcalidrawElements([
      { type: "rectangle", x: 1900, y: 290, width: 1100, height: 700 },
    ]);
    const scene = [...moved, ...notes];
    const placed = placeDrawingAnswer("chapter", answer, anchor, scene)!;
    const added = getCommonBounds(placed.elements.slice(scene.length));
    for (const e of scene) {
      expect(overlaps(added, getCommonBounds([e]))).toBe(false);
    }
    expect(placed.target[0]).toBeLessThanOrEqual(1900);
    expect(placed.target[3]).toBeGreaterThanOrEqual(260);
    const second = placeDrawingAnswer(
      "chapter",
      { ...answer, request_id: "area-2" },
      anchor,
      placed.elements,
    )!;
    expect(
      overlaps(
        getCommonBounds(second.elements.slice(placed.elements.length)),
        added,
      ),
    ).toBe(false);
  });
  it("does not duplicate retried answers or resurrect an answer the student undid", () => {
    const placed = placeDrawingAnswer("chapter", answer, null, sketch())!;
    expect(
      placeDrawingAnswer("chapter", answer, null, placed.elements),
    ).toBeNull();
    const undone = placed.elements.map((e) =>
      e.customData?.answerRequestId ? { ...e, isDeleted: true } : e,
    );
    expect(placeDrawingAnswer("chapter", answer, null, undone)).toBeNull();
  });
  it("keeps equations and diagrams editable through lesson playback and restores", () => {
    const visuals = [
      {
        ...answer.elements[0],
        id: "result",
        type: "equation",
        text: "A = 3 × 7 = 21",
        x: 60,
        y: 150,
        width: 750,
        height: 80,
        reveal_at: 0.4,
        color: "green",
      },
    ];
    const drawn = { ...answer, elements: visuals } as TutorAnswer;
    const main = createClassroomBoard(
      "chapter",
      "Circle lesson",
      "Understand circles",
      [],
    );
    let elements = [...main.map((c) => c.element), ...sketch()];
    const placed = placeDrawingAnswer("chapter", drawn, null, elements)!;
    elements = placed.elements;
    const additions = elements.filter((e) => e.customData?.answerRequestId);
    const api = {
      getSceneElementsIncludingDeleted: () => elements,
      updateScene: ({ elements: next }: { elements: typeof elements }) => {
        elements = next;
      },
    } as unknown as ExcalidrawImperativeAPI;
    const controller = new ClassroomBoardController(main);
    controller.apply(api, 0.2);
    controller.restore(api, 1);
    expect(elements.filter((e) => e.customData?.answerRequestId)).toEqual(
      additions,
    );
    expect(
      additions.some((e) => e.type === "text" && e.text.includes("21")),
    ).toBe(true);
  });
});

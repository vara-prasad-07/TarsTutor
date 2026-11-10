import { getCommonBounds, newElementWith } from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { TutorAnswer } from "../../shared/classroom";
import { createClassroomBoard } from "./lessonBoardEngine";

export type DrawingAnchor = {
  ids: string[];
  bounds: readonly [number, number, number, number];
};
type Bounds = readonly [number, number, number, number];
const intersects = (a: Bounds, b: Bounds) =>
  a[0] < b[2] + 28 && a[2] > b[0] - 28 && a[1] < b[3] + 28 && a[3] > b[1] - 28;

/** Find nearby empty space, keeping the student's ink and previous answers intact. */
function answerPosition(
  anchor: Bounds,
  width: number,
  height: number,
  occupied: Bounds[],
) {
  const gap = 50;
  const candidates = [
    { x: anchor[0], y: anchor[3] + gap, dx: 0, dy: 1 },
    { x: anchor[2] + gap, y: anchor[1], dx: 1, dy: 0 },
    { x: anchor[0] - width - gap, y: anchor[1], dx: -1, dy: 0 },
    { x: anchor[0], y: anchor[1] - height - gap, dx: 0, dy: -1 },
  ];
  for (const candidate of candidates) {
    // Each move passes an obstacle edge; no obstacle can be hit twice.
    for (let index = 0; index <= occupied.length; index++) {
      const hit = occupied.find((box) =>
        intersects(
          [candidate.x, candidate.y, candidate.x + width, candidate.y + height],
          box,
        ),
      );
      if (!hit) {
        break;
      }
      if (candidate.dx > 0) {
        candidate.x = hit[2] + gap;
      } else if (candidate.dx < 0) {
        candidate.x = hit[0] - width - gap;
      } else if (candidate.dy > 0) {
        candidate.y = hit[3] + gap;
      } else {
        candidate.y = hit[1] - height - gap;
      }
    }
  }
  return candidates.reduce((best, candidate) => {
    const distance = (p: typeof candidate) =>
      Math.hypot(p.x - anchor[0], p.y - anchor[3]);
    return distance(candidate) < distance(best) ? candidate : best;
  });
}

export function placeDrawingAnswer(
  sceneId: string,
  answer: TutorAnswer,
  anchor: DrawingAnchor | null,
  current: readonly ExcalidrawElement[],
) {
  // Retried responses must not duplicate an answer, or resurrect an undone one.
  if (
    current.some((e) => e.customData?.answerRequestId === answer.request_id)
  ) {
    return null;
  }
  const visible = current.filter((e) => !e.isDeleted && e.opacity > 0);
  const anchored = visible.filter((e) => anchor?.ids.includes(e.id));
  const bounds: Bounds = anchored.length
    ? getCommonBounds(anchored)
    : anchor?.bounds ||
      (visible.length ? getCommonBounds(visible) : [60, 60, 700, 200]);
  const visuals = answer.elements.length
    ? answer.elements
    : [
        {
          id: "explanation",
          type: "text" as const,
          text: answer.reply,
          x: 60,
          y: 145,
          width: 760,
          height: 450,
          reveal_at: 0,
          color: "ink" as const,
        },
      ];
  const generated = createClassroomBoard(
    `${sceneId}-answer-${answer.request_id}`,
    "Worked answer",
    "",
    visuals as TutorAnswer["elements"],
  ).map((cue) => cue.element);
  const [left, top, right, bottom] = getCommonBounds(generated);
  const location = answerPosition(
    bounds,
    right - left,
    bottom - top,
    current.filter((e) => !e.isDeleted).map((e) => getCommonBounds([e])),
  );
  const additions = generated.map((e) =>
    newElementWith(e, {
      x: e.x + location.x - left,
      y: e.y + location.y - top,
      customData: { ...e.customData, answerRequestId: answer.request_id },
    }),
  );
  return {
    elements: [...current, ...additions],
    target: getCommonBounds([...anchored, ...additions]),
  };
}

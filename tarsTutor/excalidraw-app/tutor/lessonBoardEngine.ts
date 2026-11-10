import { FONT_FAMILY } from "@excalidraw/common";
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  newElementWith,
} from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";
import type { LocalPoint } from "@excalidraw/math";
import type { ExcalidrawElementSkeleton } from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { LessonElement } from "../../shared/classroom";
import { revealProgress, wrapBoardText } from "./classroomMedia";

const COLORS = {
  ink: "#303b43",
  green: "#148667",
  blue: "#3384d6",
  coral: "#da786a",
  purple: "#8464b6",
};
export type BoardCue = { element: ExcalidrawElement; at: number; end: number };
export type BoardOverrides = { edited: string[]; baseline: [string, number][] };
function editSignature(e: ExcalidrawElement) {
  return JSON.stringify([
    e.type,
    e.x,
    e.y,
    e.angle,
    e.opacity,
    e.locked,
    e.isDeleted,
    e.strokeColor,
    e.backgroundColor,
    e.strokeWidth,
    e.strokeStyle,
    e.fillStyle,
    e.roughness,
    e.groupIds,
    e.frameId,
    e.type === "text"
      ? [e.text, e.fontFamily, e.fontSize, e.textAlign, e.containerId]
      : [e.width, e.height],
    e.type === "line" || e.type === "arrow" ? e.points : null,
  ]);
}

/** Every teaching primitive is a real, editable Excalidraw object. */
export function createClassroomBoard(
  sceneId: string,
  title: string,
  objective: string,
  visuals: LessonElement[],
): BoardCue[] {
  const skeletons: ExcalidrawElementSkeleton[] = [];
  const timing = new Map<string, { at: number; end: number }>();
  let group = "header";
  let start = -1;
  let sequence = 0;
  const add = (element: ExcalidrawElementSkeleton) => {
    const id = `${sceneId}-${group}-${sequence++}`;
    skeletons.push({
      ...element,
      id,
      groupIds: [`${sceneId}-${group}`],
      roughness: 0,
      customData: { source: "tars-classroom", sceneId },
      seed: 11,
    });
    timing.set(id, {
      at: start,
      end: start < 0 ? -1 : Math.min(1, start + 0.12),
    });
  };
  const text = (
    value: string,
    x: number,
    y: number,
    width: number,
    height: number,
    size = 23,
    color = COLORS.ink,
    mono = false,
  ) => {
    if (!value) {
      return;
    }
    let fontSize = size;
    let lines = wrapBoardText(
      value,
      Math.max(8, Math.floor(width / (fontSize * 0.55))),
    );
    while (lines.length * fontSize * 1.36 > height && fontSize > 13) {
      fontSize--;
      lines = wrapBoardText(
        value,
        Math.max(8, Math.floor(width / (fontSize * 0.55))),
      );
    }
    add({
      type: "text",
      x,
      y,
      text: mono ? value : lines.join("\n"),
      fontSize,
      fontFamily: mono ? FONT_FAMILY.Cascadia : FONT_FAMILY.Excalifont,
      strokeColor: color,
    });
  };
  const line = (
    x: number,
    y: number,
    dx: number,
    dy: number,
    color = COLORS.ink,
    width = 2,
    dashed = false,
  ) =>
    add({
      type: "line",
      x,
      y,
      points: [pointFrom(0, 0), pointFrom(dx, dy)],
      strokeColor: color,
      strokeWidth: width,
      strokeStyle: dashed ? "dashed" : "solid",
    });
  const box = (
    x: number,
    y: number,
    width: number,
    height: number,
    fill: string,
    stroke = "transparent",
  ) =>
    add({
      type: "rectangle",
      x,
      y,
      width,
      height,
      backgroundColor: fill,
      fillStyle: "solid",
      strokeColor: stroke,
      strokeWidth: 1,
    });
  text(title, 58, 30, 880, 70, 35, COLORS.green);
  group = "objective";
  text(objective, 60, 100, 875, 44, 16, "#566477");
  for (const e of visuals) {
    group = e.id;
    start = e.reveal_at;
    const first = skeletons.length;
    const color = COLORS[e.color];
    if (e.type === "text" || e.type === "equation") {
      text(
        e.text,
        e.x,
        e.y,
        e.width,
        e.height,
        e.type === "equation" ? 31 : 23,
        color,
      );
    } else if (e.type === "shape") {
      if (e.shape === "triangle") {
        add({
          type: "line",
          x: e.x,
          y: e.y,
          points: [
            pointFrom(3, e.height - 3),
            pointFrom(e.width / 2, 3),
            pointFrom(e.width - 3, e.height - 3),
            pointFrom(3, e.height - 3),
          ],
          strokeColor: color,
          strokeWidth: 2.5,
        });
      } else {
        add({
          type: e.shape === "ellipse" ? "ellipse" : "rectangle",
          x: e.x,
          y: e.y,
          width: e.width,
          height: e.height,
          strokeColor: color,
          strokeWidth: 2.5,
          backgroundColor: "transparent",
        });
      }
      text(
        e.text,
        e.x + 18,
        e.y + e.height / 2 - 20,
        e.width - 36,
        Math.max(30, e.height - 20),
        22,
        color,
      );
    } else if (e.type === "arrow") {
      add({
        type: "arrow",
        x: e.x,
        y: e.y,
        points: [pointFrom(0, 0), pointFrom(e.x2 - e.x, e.y2 - e.y)],
        strokeColor: color,
        strokeWidth: 2.5,
        endArrowhead: "arrow",
      });
      text(
        e.text,
        Math.min(e.x, e.x2),
        Math.min(e.y, e.y2) - 32,
        e.width,
        45,
        18,
        color,
      );
    } else if (e.type === "graph") {
      const left = e.x + 52,
        top = e.y + 22,
        w = Math.max(50, e.width - 76),
        h = Math.max(40, e.height - 92);
      const x = (value: number) =>
        left + ((value - e.x_min) / (e.x_max - e.x_min)) * w;
      const y = (value: number) =>
        top + h - ((value - e.y_min) / (e.y_max - e.y_min)) * h;
      for (let n = 0; n <= 4; n++) {
        line(left, top + (n * h) / 4, w, 0, "#dfdfd4", 1, true);
        text(
          Number(
            (e.y_min + ((e.y_max - e.y_min) * n) / 4).toPrecision(3),
          ).toString(),
          left - 42,
          top + h - (n * h) / 4 - 7,
          36,
          22,
          13,
          "#83877f",
        );
        text(
          Number(
            (e.x_min + ((e.x_max - e.x_min) * n) / 4).toPrecision(3),
          ).toString(),
          left + (n * w) / 4 - 8,
          top + h + 10,
          45,
          22,
          13,
          "#83877f",
        );
      }
      line(left, top, 0, h, "#6c7772");
      line(left, top + h, w, 0, "#6c7772");
      text(
        e.x_label,
        left + w / 2 - Math.min(w / 2, 100),
        top + h + 39,
        Math.min(w, 250),
        30,
        16,
      );
      text(e.y_label, e.x, Math.max(145, top - 24), e.width, 25, 14);
      e.series.forEach((series, index) => {
        if (series.kind === "line") {
          const first = series.points[0];
          add({
            type: "line",
            x: x(first.x),
            y: y(first.y),
            points: series.points.map((p) =>
              pointFrom(x(p.x) - x(first.x), y(p.y) - y(first.y)),
            ),
            strokeColor: COLORS[series.color],
            strokeWidth: 2.5,
          });
        } else {
          for (const p of series.points) {
            if (
              p.x < e.x_min ||
              p.x > e.x_max ||
              p.y < e.y_min ||
              p.y > e.y_max
            ) {
              continue;
            }
            add({
              type: "ellipse",
              x: x(p.x) - 4,
              y: y(p.y) - 4,
              width: 8,
              height: 8,
              strokeColor: COLORS[series.color],
              backgroundColor: COLORS[series.color],
              fillStyle: "solid",
            });
          }
        }
        if (series.label && e.series.length < 4) {
          text(
            series.label,
            left + 10 + index * Math.min(140, w / e.series.length),
            top + 5,
            Math.min(140, w / e.series.length),
            22,
            12,
            COLORS[series.color],
          );
        }
      });
    } else if (e.type === "table") {
      const rows = [e.columns, ...e.rows];
      const columns = Math.max(1, ...rows.map((row) => row.length));
      const rowHeight = Math.min(55, e.height / rows.length);
      box(e.x, e.y, e.width, rowHeight, "#e8eee3");
      rows.forEach((row, ri) => {
        line(e.x, e.y + (ri + 1) * rowHeight, e.width, 0, "#d5dbd0", 1);
        row.forEach((cell, ci) =>
          text(
            cell,
            e.x + (ci * e.width) / columns + 10,
            e.y + ri * rowHeight + 6,
            e.width / columns - 18,
            rowHeight - 8,
            17,
          ),
        );
      });
    } else if (e.type === "code") {
      box(e.x - 10, e.y - 7, e.width + 20, e.height + 12, "#eef1ed");
      const lines = e.text.split("\n");
      const size = Math.min(
        17,
        Math.max(
          10,
          e.width / Math.max(25, ...lines.map((l) => l.length)) / 0.63,
        ),
        (e.height - 15) / Math.max(1, lines.length) / 1.6,
      );
      lines.forEach((value, index) => {
        let offset = 0;
        for (const token of value.split(
          /("[^"\n]*"|'[^'\n]*'|#[^\n]*|\/\/[^\n]*|\b(?:def|class|for|while|in|if|else|elif|return|import|from|as|print|const|let|var|function|true|false|None|True|False|range|break|continue)\b|\b\d+(?:\.\d+)?\b)/g,
        )) {
          const ink = /^(#|\/\/)/.test(token)
            ? "#566477"
            : /^["']/.test(token)
            ? COLORS.green
            : /^\d/.test(token)
            ? "#c57449"
            : /^(def|class|for|while|in|if|else|elif|return|import|from|as|print|const|let|var|function|true|false|None|True|False|range|break|continue)$/.test(
                token,
              )
            ? COLORS.purple
            : COLORS.ink;
          text(
            token,
            e.x + 10 + offset * size * 0.6,
            e.y + 24 + index * size * 1.6,
            e.width,
            40,
            size,
            ink,
            true,
          );
          offset += token.length;
        }
      });
    }
    if (e.caption) {
      text(e.caption, e.x, e.y + e.height + 8, e.width, 48, 15, "#566477");
    }
    const count = skeletons.length - first;
    skeletons.slice(first).forEach((skeleton, index) => {
      const at = Math.min(
        0.96,
        e.reveal_at + (0.065 * index) / Math.max(1, count - 1),
      );
      timing.set(skeleton.id!, { at, end: Math.min(1, at + 0.065) });
    });
  }
  return convertToExcalidrawElements(skeletons, { regenerateIds: false }).map(
    (element) => ({ element, ...timing.get(element.id)! }),
  );
}

export function progressiveElement(
  cue: BoardCue,
  progress: number,
): ExcalidrawElement {
  const amount =
    cue.at < 0 || progress >= 0.999
      ? 1
      : revealProgress(progress, cue.at, cue.end);
  const element = cue.element;
  const props: {
    opacity: number;
    locked: boolean;
    text?: string;
    originalText?: string;
    points?: LocalPoint[];
  } = { opacity: amount > 0 ? 100 : 0, locked: amount <= 0 };
  if (element.type === "text" && amount < 1) {
    props.text = Array.from(element.text)
      .slice(0, Math.ceil(Array.from(element.text).length * amount))
      .join("");
    props.originalText = props.text;
  }
  if (
    (element.type === "line" || element.type === "arrow") &&
    amount > 0 &&
    amount < 1 &&
    element.points.length > 1
  ) {
    const end = amount * (element.points.length - 1),
      whole = Math.floor(end);
    const a = element.points[whole],
      b = element.points[whole + 1] || a;
    props.points = [
      ...element.points.slice(0, whole + 1),
      pointFrom(
        a[0] + (b[0] - a[0]) * (end - whole),
        a[1] + (b[1] - a[1]) * (end - whole),
      ),
    ];
  }
  return newElementWith(element, props);
}

/** Programmatic narration updates must never overwrite a student's edits/deletions. */
export class ClassroomBoardController {
  readonly ids: Set<string>;
  private edited: Set<string>;
  private baseline: Map<string, number>;
  private written = new Map<string, ExcalidrawElement>();
  constructor(
    readonly cues: BoardCue[],
    saved?: BoardOverrides & { elements?: readonly ExcalidrawElement[] },
  ) {
    this.ids = new Set(cues.map((c) => c.element.id));
    this.edited = new Set(saved?.edited || []);
    this.baseline = new Map(saved?.baseline || []);
    for (const e of saved?.elements || []) {
      this.written.set(e.id, e);
    }
  }
  observe(elements: readonly ExcalidrawElement[]) {
    for (const e of elements) {
      const previous = this.baseline.get(e.id);
      if (
        this.ids.has(e.id) &&
        previous !== undefined &&
        previous !== e.versionNonce
      ) {
        const written = this.written.get(e.id);
        if (!written || editSignature(written) !== editSignature(e)) {
          this.edited.add(e.id);
        } else {
          this.baseline.set(e.id, e.versionNonce);
          this.written.set(e.id, e);
        }
      }
    }
  }
  snapshot(): BoardOverrides {
    return { edited: [...this.edited], baseline: [...this.baseline] };
  }
  apply(api: ExcalidrawImperativeAPI, progress: number) {
    const current = api.getSceneElementsIncludingDeleted();
    this.observe(current);
    const previous = new Map(current.map((e) => [e.id, e]));
    let changed = false;
    const next = this.cues.map((cue) => {
      const existing = previous.get(cue.element.id);
      if (existing && this.edited.has(existing.id)) {
        return existing;
      }
      const desired = progressiveElement(cue, progress);
      const same =
        existing &&
        existing.opacity === desired.opacity &&
        existing.locked === desired.locked &&
        existing.isDeleted === desired.isDeleted &&
        existing.strokeColor === desired.strokeColor &&
        (existing.type !== "text" ||
          desired.type !== "text" ||
          existing.text === desired.text) &&
        ((existing.type !== "line" && existing.type !== "arrow") ||
          (desired.type !== "line" && desired.type !== "arrow") ||
          JSON.stringify(existing.points) === JSON.stringify(desired.points));
      let result = existing || desired;
      if (!same) {
        if (!existing) {
          result = desired;
        } else if (existing.type === "text" && desired.type === "text") {
          result = newElementWith(existing, {
            opacity: desired.opacity,
            locked: desired.locked,
            text: desired.text,
            originalText: desired.originalText,
            strokeColor: desired.strokeColor,
          });
        } else if (
          (existing.type === "line" || existing.type === "arrow") &&
          (desired.type === "line" || desired.type === "arrow")
        ) {
          result = newElementWith(existing, {
            opacity: desired.opacity,
            locked: desired.locked,
            points: desired.points,
            strokeColor: desired.strokeColor,
          });
        } else {
          result = newElementWith(existing, {
            opacity: desired.opacity,
            locked: desired.locked,
            strokeColor: desired.strokeColor,
          });
        }
      }
      if (!same) {
        changed = true;
      }
      this.baseline.set(result.id, result.versionNonce);
      this.written.set(result.id, result);
      return result;
    });
    if (changed) {
      const replacements = new Map(
        next.map((element) => [element.id, element]),
      );
      api.updateScene({
        // Preserve native z-order changes, including send-to-back/front.
        elements: [
          ...next.filter((element) => !previous.has(element.id)),
          ...current.map((element) => replacements.get(element.id) || element),
        ],
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }
  }
  restore(api: ExcalidrawImperativeAPI, progress: number) {
    this.edited.clear();
    this.baseline.clear();
    this.written.clear();
    const current = api.getSceneElementsIncludingDeleted();
    const next = this.cues.map((cue) => {
      const e = progressiveElement(cue, progress);
      this.baseline.set(e.id, e.versionNonce);
      this.written.set(e.id, e);
      return e;
    });
    api.updateScene({
      elements: [...next, ...current.filter((e) => !this.ids.has(e.id))],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  }
}

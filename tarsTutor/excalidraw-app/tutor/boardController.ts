import { FONT_FAMILY, getFontString } from "@excalidraw/common";
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  getCommonBounds,
  wrapText,
} from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";
import type { ExcalidrawElementSkeleton } from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { logisticRegressionLesson } from "./lessons/logisticRegression";

import type { TutorLesson } from "../../shared/tutor";

const COLUMN_WIDTH = 420;
const COLUMN_GAP = 72;
const INK = "#243449";
const MUTED = "#64748b";
const GREEN = "#087f5b";
const BLUE = "#1971c2";
const BORDER = "#dce3ea";

export const sigmoid = (score: number) => 1 / (1 + Math.exp(-score));

/** Render semantic content through the repo's documented element skeleton API. */
export const createLessonElements = (lesson: TutorLesson, originX = 0) => {
  const skeletons: ExcalidrawElementSkeleton[] = [];
  let stepId = "overview";
  let blockId = "header";
  let sequence = 0;

  const add = (skeleton: ExcalidrawElementSkeleton) => {
    skeletons.push({
      ...skeleton,
      id: `${lesson.lessonId}-${stepId}-${blockId}-${sequence++}`,
      customData: {
        source: "tars-tutor",
        lessonId: lesson.lessonId,
        turnId: lesson.turnId,
        stepId,
        blockId,
      },
    });
  };

  const text = (
    value: string,
    x: number,
    y: number,
    size = 20,
    color = INK,
    width = COLUMN_WIDTH,
    handDrawn = true,
  ) => {
    const fontFamily = handDrawn
      ? FONT_FAMILY.Excalifont
      : FONT_FAMILY.Helvetica;
    const wrapped = wrapText(
      value,
      getFontString({ fontFamily, fontSize: size }),
      width,
    );
    add({
      type: "text",
      x: originX + x,
      y,
      text: wrapped,
      fontFamily,
      fontSize: size,
      strokeColor: color,
    });
    return wrapped.split("\n").length * size * (handDrawn ? 1.25 : 1.15);
  };

  const line = (
    x: number,
    y: number,
    dx: number,
    dy: number,
    color = BORDER,
    dashed = false,
  ) => {
    add({
      type: "line",
      x: originX + x,
      y,
      points: [pointFrom(0, 0), pointFrom(dx, dy)],
      strokeColor: color,
      strokeWidth: 1,
      roughness: 0,
      strokeStyle: dashed ? "dashed" : "solid",
    });
  };

  const box = (
    x: number,
    y: number,
    width: number,
    height: number,
    fill: string,
    stroke = BORDER,
  ) => {
    add({
      type: "rectangle",
      x: originX + x,
      y,
      width,
      height,
      backgroundColor: fill,
      strokeColor: stroke,
      fillStyle: "solid",
      strokeWidth: 1,
      roughness: 0,
      roundness: { type: 3 },
    });
  };

  const boardWidth =
    lesson.steps.length * (COLUMN_WIDTH + COLUMN_GAP) - COLUMN_GAP;
  const generated = lesson.lessonId !== logisticRegressionLesson.lessonId;
  text(
    generated ? "TARS TUTOR  /  LESSON" : "MACHINE LEARNING  /  SAMPLE LESSON",
    0,
    0,
    12,
    MUTED,
    boardWidth,
    false,
  );
  const titleHeight = text(lesson.title, 0, 34, 42, GREEN, boardWidth);
  const replyY = 34 + titleHeight + 14;
  const replyHeight = text(
    lesson.reply,
    0,
    replyY,
    18,
    MUTED,
    boardWidth,
    false,
  );
  const dividerY = replyY + replyHeight + 26;
  line(0, dividerY, boardWidth, 0);

  lesson.steps.forEach((step, index) => {
    stepId = step.id;
    blockId = "section-heading";
    const x = index * (COLUMN_WIDTH + COLUMN_GAP);
    text(
      `0${index + 1}  /  ${
        generated
          ? "TEACHING STEP"
          : ["THE IDEA", "THE CURVE", "PUT IT TO WORK"][index] || "NEXT STEP"
      }`,
      x,
      dividerY + 32,
      12,
      MUTED,
      COLUMN_WIDTH,
      false,
    );
    const stepTitleY = dividerY + 64;
    const stepTitleHeight = text(step.title, x, stepTitleY, 27, GREEN);
    let y = stepTitleY + Math.max(34, stepTitleHeight) + 22;

    step.blocks.forEach((block) => {
      blockId = block.id;
      if (block.type === "text") {
        y +=
          text(
            block.text,
            x,
            y,
            block.tone === "muted" ? 18 : 20,
            block.tone === "muted"
              ? MUTED
              : block.tone === "accent"
              ? GREEN
              : INK,
          ) + 26;
      } else if (block.type === "formula") {
        const firstText = skeletons.length;
        const formulaHeight = text(
          block.text,
          x + 18,
          y + 15,
          25,
          BLUE,
          COLUMN_WIDTH - 36,
        );
        const captionHeight = text(
          block.caption,
          x + 18,
          y + 15 + formulaHeight + 12,
          15,
          MUTED,
          COLUMN_WIDTH - 36,
          false,
        );
        const height = Math.max(
          100,
          15 + formulaHeight + 12 + captionHeight + 18,
        );
        box(x, y, COLUMN_WIDTH, height, "#f4f7fb");
        const background = skeletons.pop()!;
        skeletons.splice(firstText, 0, background);
        y += height + 24;
      } else if (block.type === "pipeline") {
        const cellWidth = 120;
        block.stages.forEach((stage, stageIndex) => {
          const cellX = x + stageIndex * 150;
          box(
            cellX,
            y + 4,
            cellWidth,
            48,
            stageIndex === 2 ? "#ebf7ef" : "#f4f1ff",
          );
          text(
            stage,
            cellX + 10,
            y + 20,
            14,
            stageIndex === 2 ? GREEN : INK,
            cellWidth - 14,
            false,
          );
          if (stageIndex < 2) {
            add({
              type: "arrow",
              x: originX + cellX + cellWidth + 4,
              y: y + 28,
              width: 20,
              height: 0,
              strokeColor: MUTED,
              roughness: 0,
              strokeWidth: 1.5,
            });
          }
        });
        y += 86;
      } else if (block.type === "sigmoid") {
        const plotX = x + 42;
        const plotY = y + 16;
        const width = 350;
        const height = 232;
        [0, 0.25, 0.5, 0.75, 1].forEach((probability) => {
          const gridY = plotY + height * (1 - probability);
          line(
            plotX,
            gridY,
            width,
            0,
            probability === 0.5 ? "#b2d8cf" : BORDER,
            probability === 0.5,
          );
          text(String(probability), x, gridY - 7, 12, MUTED, 40, false);
        });
        [-6, -3, 0, 3, 6]
          .filter((score) => score >= block.minScore && score <= block.maxScore)
          .forEach((score) => {
            const gridX =
              plotX +
              ((score - block.minScore) / (block.maxScore - block.minScore)) *
                width;
            line(gridX, plotY, 0, height, BORDER);
            text(
              String(score),
              gridX - 6,
              plotY + height + 10,
              12,
              MUTED,
              30,
              false,
            );
          });
        line(plotX, plotY + height, width, 0, MUTED);
        line(plotX, plotY, 0, height, MUTED);
        const points = Array.from({ length: 97 }, (_, pointIndex) => {
          const score =
            block.minScore +
            (pointIndex / 96) * (block.maxScore - block.minScore);
          return pointFrom<LocalPoint>(
            (pointIndex / 96) * width,
            height * (1 - sigmoid(score)),
          );
        });
        add({
          type: "line",
          x: originX + plotX,
          y: plotY,
          width,
          height,
          points,
          strokeColor: BLUE,
          strokeWidth: 3,
          roughness: 0,
        });
        const midpointX =
          plotX +
          ((0 - block.minScore) / (block.maxScore - block.minScore)) * width;
        add({
          type: "ellipse",
          x: originX + midpointX - 5,
          y: plotY + height / 2 - 5,
          width: 10,
          height: 10,
          backgroundColor: GREEN,
          fillStyle: "solid",
          strokeColor: GREEN,
          roughness: 0,
        });
        text(
          "(0, 0.5)",
          midpointX + 12,
          plotY + height / 2 - 26,
          15,
          GREEN,
          100,
          false,
        );
        text(
          "score z",
          plotX + 138,
          plotY + height + 36,
          14,
          MUTED,
          100,
          false,
        );
        text("probability p", plotX, plotY - 25, 12, MUTED, 160, false);
        y += height + 96;
      } else if (block.type === "question") {
        const promptHeight =
          wrapText(
            block.prompt,
            getFontString({ fontFamily: FONT_FAMILY.Excalifont, fontSize: 20 }),
            COLUMN_WIDTH - 36,
          ).split("\n").length * 25;
        box(x, y, COLUMN_WIDTH, promptHeight + 166, "#f2f8f1", "#d4e5d1");
        text(
          "QUICK CHECK",
          x + 18,
          y + 16,
          11,
          GREEN,
          COLUMN_WIDTH - 36,
          false,
        );
        text(block.prompt, x + 18, y + 44, 20, INK, COLUMN_WIDTH - 36);
        const choicesY = y + 56 + promptHeight;
        block.choices.forEach((choice, choiceIndex) => {
          const choiceX = x + 18 + choiceIndex * 96;
          const correct = choiceIndex === block.correctIndex;
          box(
            choiceX,
            choicesY,
            82,
            38,
            correct ? "#d3efdb" : "#ffffff",
            correct ? "#87c69a" : BORDER,
          );
          text(
            choice,
            choiceX + 14,
            choicesY + 10,
            16,
            correct ? GREEN : MUTED,
            62,
            false,
          );
        });
        text(
          block.explanation,
          x + 18,
          choicesY + 58,
          17,
          GREEN,
          COLUMN_WIDTH - 36,
        );
        y += promptHeight + 190;
      }
    });
  });

  return convertToExcalidrawElements(skeletons, { regenerateIds: false });
};

export const isSampleElement = (element: ExcalidrawElement) =>
  element.customData?.lessonId === logisticRegressionLesson.lessonId;

/** Append accepted Gemini output without replacing the student's existing work. */
export const showGeneratedLesson = (
  api: ExcalidrawImperativeAPI,
  lesson: TutorLesson,
  focus = true,
) => {
  const current = api.getSceneElementsIncludingDeleted();
  let elements = current.filter(
    (element) =>
      !element.isDeleted && element.customData?.lessonId === lesson.lessonId,
  );
  if (!elements.length) {
    const visible = current.filter((element) => !element.isDeleted);
    elements = createLessonElements(
      lesson,
      visible.length ? getCommonBounds(visible)[2] + 160 : 0,
    );
    api.updateScene({
      elements: [
        ...current.filter(
          (element) => element.customData?.lessonId !== lesson.lessonId,
        ),
        ...elements,
      ],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  }
  if (!focus) {
    return;
  }
  api.setViewport({
    target: getCommonBounds(elements),
    fit: "scale-down",
    animation: true,
    offsets: {
      ui: true,
      top: 100,
      bottom: api.getAppState().width < 640 ? 248 : 190,
    },
  });
};

/** Add once, preserve the student's scene, and focus the requested lesson area. */
export const showSampleLesson = (
  api: ExcalidrawImperativeAPI,
  requestedStep?: string,
) => {
  const current = api.getSceneElementsIncludingDeleted();
  let sample = current.filter(
    (element) => !element.isDeleted && isSampleElement(element),
  );
  if (!sample.length) {
    const existing = current.filter((element) => !element.isDeleted);
    const originX = existing.length ? getCommonBounds(existing)[2] + 160 : 0;
    sample = createLessonElements(logisticRegressionLesson, originX);
    api.updateScene({
      elements: [
        ...current.filter((element) => !isSampleElement(element)),
        ...sample,
      ],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  }
  const step =
    requestedStep || (api.getAppState().width < 640 ? "idea" : undefined);
  const targets =
    step && step !== "all"
      ? sample.filter((element) => element.customData?.stepId === step)
      : sample;
  if (targets.length) {
    api.setViewport({
      target: getCommonBounds(targets),
      fit: "scale-down",
      animation: true,
      offsets: {
        ui: true,
        top: api.getAppState().width < 640 ? 82 : 112,
        bottom: api.getAppState().width < 640 ? 248 : 190,
      },
    });
  }
};

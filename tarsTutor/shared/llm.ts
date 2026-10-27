import type { TutorLesson } from "./tutor";

/** Keep this first experiment limited to blocks the board can safely lay out. */
export const geminiLessonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", maxLength: 70 },
    reply: { type: "string", maxLength: 360 },
    steps: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", maxLength: 32 },
          explanation: { type: "string", maxLength: 360 },
          blocks: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                type: { type: "string", enum: ["text", "formula"] },
                text: { type: "string", maxLength: 240 },
                caption: { type: "string", maxLength: 100 },
              },
              required: ["type", "text", "caption"],
            },
          },
        },
        required: ["title", "explanation", "blocks"],
      },
    },
  },
  required: ["title", "reply", "steps"],
};

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Gemini returned an invalid lesson object.");
  }
  return value as Record<string, unknown>;
};

const string = (value: unknown, max: number, allowEmpty = false) => {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!allowEmpty && !value.trim())
  ) {
    throw new Error("Gemini returned missing or oversized lesson text.");
  }
  return value.trim();
};

/** Validate on both sides and assign IDs ourselves instead of trusting model IDs. */
export const parseGeminiLesson = (value: unknown, id: string): TutorLesson => {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
    throw new Error("Invalid lesson ID.");
  }
  const input = record(value);
  if (
    !Array.isArray(input.steps) ||
    input.steps.length < 1 ||
    input.steps.length > 3
  ) {
    throw new Error("Gemini must return between one and three lesson steps.");
  }
  return {
    lessonId: id,
    turnId: id,
    title: string(input.title, 70),
    reply: string(input.reply, 360),
    steps: input.steps.map((rawStep, index) => {
      const step = record(rawStep);
      if (
        !Array.isArray(step.blocks) ||
        step.blocks.length < 1 ||
        step.blocks.length > 4
      ) {
        throw new Error("Gemini returned an invalid number of content blocks.");
      }
      return {
        id: `step-${index + 1}`,
        title: string(step.title, 32),
        explanation: string(step.explanation, 360),
        blocks: step.blocks.map((rawBlock, blockIndex) => {
          const block = record(rawBlock);
          const text = string(block.text, 240);
          const caption = string(block.caption ?? "", 100, true);
          const blockId = `block-${blockIndex + 1}`;
          if (block.type === "text") {
            return { id: blockId, type: "text" as const, text };
          }
          if (block.type === "formula") {
            return { id: blockId, type: "formula" as const, text, caption };
          }
          throw new Error("Gemini returned an unsupported board block.");
        }),
      };
    }),
  };
};

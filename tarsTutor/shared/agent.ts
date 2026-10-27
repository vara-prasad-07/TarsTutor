import { parseGeminiLesson } from "./llm";

import type { TutorLesson } from "./tutor";

export type BoardContext = {
  selected_element_ids: string[];
  selected_text: string;
  lesson_id?: string;
  step_id?: string;
};
export type TutorRequest = {
  turn_id: string;
  message: string;
  action: "message" | "review_work";
  board_context: BoardContext;
  answer_to_question_id?: string;
};
export type TutorQuestion = {
  id: string;
  prompt: string;
  kind: "numeric" | "choice";
  choices: string[];
};
export type TutorResponse = {
  session_id: string;
  turn_id: string;
  status: "completed" | "clarification" | "fallback";
  intent: string;
  reply: string;
  lesson: TutorLesson | null;
  question: TutorQuestion | null;
  feedback: {
    question_id: string;
    correct: boolean | null;
    message: string;
  } | null;
  next_action: "continue" | "answer_question" | "clarify";
  model: string;
};
export const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The tutor returned an invalid response.");
  }
  return value as Record<string, unknown>;
};
const text = (value: unknown, max = 400) => {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error("The tutor returned invalid text.");
  }
  return value;
};
export const parseId = (value: unknown) => {
  const result = text(value, 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(result)) {
    throw new Error("The tutor returned an invalid ID.");
  }
  return result;
};
const member = <T extends string>(value: unknown, values: readonly T[]): T => {
  if (!values.includes(value as T)) {
    throw new Error("The tutor returned an unsupported response type.");
  }
  return value as T;
};
export const parseQuestion = (value: unknown): TutorQuestion | null => {
  if (value == null) {
    return null;
  }
  const q = object(value);
  const kind = member(q.kind, ["numeric", "choice"] as const);
  if (
    !Array.isArray(q.choices) ||
    q.choices.length > 4 ||
    (kind === "choice" && q.choices.length < 2) ||
    (kind === "numeric" && q.choices.length !== 0)
  ) {
    throw new Error("The tutor returned invalid question choices.");
  }
  return {
    id: parseId(q.id),
    prompt: text(q.prompt, 240),
    kind,
    choices: q.choices.map((choice) => text(choice, 400)),
  };
};
export const parseTutorResponse = (
  value: unknown,
  sessionId: string,
  turnId?: string,
): TutorResponse => {
  const data = object(value);
  if (data.session_id !== sessionId || (turnId && data.turn_id !== turnId)) {
    throw new Error("The tutor response does not match this request.");
  }
  const id = parseId(data.turn_id);
  const feedback = data.feedback == null ? null : object(data.feedback);
  if (
    feedback &&
    feedback.correct !== null &&
    typeof feedback.correct !== "boolean"
  ) {
    throw new Error("The tutor returned invalid answer feedback.");
  }
  const lesson = data.lesson == null ? null : object(data.lesson);
  if (lesson && lesson.turnId !== id) {
    throw new Error("The lesson does not match this turn.");
  }
  return {
    session_id: parseId(data.session_id),
    turn_id: id,
    status: member(data.status, [
      "completed",
      "clarification",
      "fallback",
    ] as const),
    intent: text(data.intent, 40),
    reply: text(data.reply, 360),
    lesson: lesson
      ? { ...parseGeminiLesson(lesson, parseId(lesson.lessonId)), turnId: id }
      : null,
    question: parseQuestion(data.question),
    feedback: feedback
      ? {
          question_id: parseId(feedback.question_id),
          correct: feedback.correct as boolean | null,
          message: text(feedback.message),
        }
      : null,
    next_action: member(data.next_action, [
      "continue",
      "answer_question",
      "clarify",
    ] as const),
    model: text(data.model, 100),
  };
};

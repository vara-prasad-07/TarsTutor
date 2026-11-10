/** Versioned, validated server lesson contract. Coordinates use a 1000 × 700 board. */
export type ClassroomWindow = Window & typeof globalThis;
export type LessonMaterial = {
  name: string;
  media_type: string;
  text: string;
  data: string;
};
export type LessonColor = "ink" | "green" | "blue" | "coral" | "purple";
export type LessonElement = {
  id: string;
  type: "text" | "equation" | "graph" | "shape" | "arrow" | "table" | "code";
  reveal_at: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  caption: string;
  color: LessonColor;
  shape: "rectangle" | "ellipse" | "triangle";
  x2: number;
  y2: number;
  x_label: string;
  y_label: string;
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
  series: {
    label: string;
    kind: "points" | "line";
    color: LessonColor;
    points: { x: number; y: number }[];
  }[];
  columns: string[];
  rows: string[][];
  language: string;
};
export type LessonQuiz = {
  id: string;
  kind: "choice" | "numeric" | "text";
  prompt: string;
  choices: string[];
};
export type LessonSegment = {
  id: string;
  title: string;
  objective: string;
  narration: string;
  duration_seconds: number;
  elements: LessonElement[];
  quiz: LessonQuiz | null;
};
export type LessonStage = {
  id: string;
  label: string;
  status: "pending" | "active" | "completed" | "failed";
};
export type TutorAnswer = {
  request_id: string;
  reply: string;
  narration: string;
  elements: LessonElement[];
  board_used?: boolean;
};
export type WhiteboardContext = {
  media_type: "image/png" | "image/jpeg";
  data: string;
  scope: "selection" | "student_work" | "board";
  element_count: number;
  has_student_work: boolean;
  selected_element_ids: string[];
  text: string;
};
export type ClassroomQuestion = {
  request_id: string;
  message: string;
  segment_id: string;
  whiteboard?: WhiteboardContext | null;
};
export type QuizFeedback = {
  question_id: string;
  correct: boolean | null;
  explanation: string;
};
export type LessonSnapshot = {
  session_id: string;
  prompt: string;
  title: string;
  status: "generating" | "ready" | "completed" | "failed" | "cancelled";
  generating: boolean;
  stage: string;
  stages: LessonStage[];
  segments: LessonSegment[];
  materials: LessonMaterial[];
  error: string | null;
  revision: number;
  total_segments?: number | null;
  conversation?: { role: "student" | "tutor"; text: string }[];
  [key: string]: unknown;
};

export class LessonAPIError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function lessonRequest<T>(
  view: Window,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await view.fetch(`/api/tutor/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new LessonAPIError(
      typeof data?.detail === "string"
        ? data.detail
        : response.status === 422
        ? "Please check the topic and attached files and try again."
        : "Could not reach your tutor. Check the backend connection and retry.",
      response.status,
    );
  }
  if (!data) {
    throw new Error("The tutor returned an empty response. Please retry.");
  }
  return data as T;
}

export async function uploadMaterial(
  view: Window,
  file: File,
  signal?: AbortSignal,
): Promise<LessonMaterial> {
  if (file.size > 6_000_000) {
    throw new Error(`${file.name} exceeds the 6 MB file limit.`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let start = 0; start < bytes.length; start += 16384) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 16384));
  }
  return lessonRequest<LessonMaterial>(
    view,
    "uploads",
    {
      name: file.name,
      media_type: file.type || "application/octet-stream",
      data: view.btoa(binary),
    },
    signal,
  );
}

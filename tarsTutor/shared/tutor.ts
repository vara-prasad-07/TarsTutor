/** Teaching content stays separate from Excalidraw coordinates and styles. */
export type LessonBlock = { id: string } & (
  | { type: "text"; text: string; tone?: "muted" | "accent" }
  | { type: "formula"; text: string; caption: string }
  | { type: "pipeline"; stages: [string, string, string] }
  | { type: "sigmoid"; minScore: number; maxScore: number }
  | {
      type: "question";
      prompt: string;
      choices: string[];
      correctIndex: number;
      explanation: string;
    }
);

export type LessonStep = {
  id: string;
  title: string;
  explanation: string;
  blocks: LessonBlock[];
};

export type TutorLesson = {
  lessonId: string;
  turnId: string;
  title: string;
  reply: string;
  steps: LessonStep[];
};

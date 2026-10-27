import type { TutorLesson } from "../../../shared/tutor";

/** A fixed tutor response, using the content format proposed in plan.md. */
export const logisticRegressionLesson: TutorLesson = {
  lessonId: "logistic-regression-v1",
  turnId: "logistic-regression-demo",
  title: "Logistic regression",
  reply:
    "Turn a score into a probability. Then use that probability to make a decision.",
  steps: [
    {
      id: "idea",
      title: "Predict a probability",
      explanation:
        "Start with measurable features, calculate a linear score, and use the sigmoid to get a probability for the positive class.",
      blocks: [
        {
          id: "definition",
          type: "text",
          text: "Will a student pass? Logistic regression estimates the probability of a yes/no outcome.",
        },
        {
          id: "pipeline",
          type: "pipeline",
          stages: ["Features x", "Score z", "Probability p"],
        },
        {
          id: "score",
          type: "formula",
          text: "z = w·x + b",
          caption: "One feature: x = study hours",
        },
        {
          id: "sigmoid-formula",
          type: "formula",
          text: "p = 1 / (1 + e⁻ᶻ)",
          caption: "The sigmoid turns any real score into 0 < p < 1.",
        },
        {
          id: "meaning",
          type: "text",
          text: "p = P(pass | study hours)\nA probability of 0.75 means an estimated 75% chance of passing.",
          tone: "muted",
        },
      ],
    },
    {
      id: "curve",
      title: "Meet the sigmoid",
      explanation:
        "The S-shaped sigmoid approaches zero for negative scores and one for positive scores. At a score of zero, it is exactly one half.",
      blocks: [
        {
          id: "curve-intro",
          type: "text",
          text: "The score can be any number. The probability stays between 0 and 1.",
        },
        { id: "curve", type: "sigmoid", minScore: -6, maxScore: 6 },
        {
          id: "midpoint",
          type: "formula",
          text: "z = 0  →  p = 0.50",
          caption: "The midpoint of the S-curve",
        },
        {
          id: "curve-note",
          type: "text",
          text: "Higher score → higher probability.\nThe curve approaches 0 and 1; it never reaches them for a finite score.",
          tone: "muted",
        },
      ],
    },
    {
      id: "practice",
      title: "Try a real example",
      explanation:
        "With an illustrative weight of one and bias of minus four, five hours gives a score of one and a probability of about 73.1 percent. Check what happens at a score of zero.",
      blocks: [
        {
          id: "assumptions",
          type: "text",
          text: "An illustrative model: w = 1, b = −4.\nSuppose the student studies for x = 5 hours.",
          tone: "muted",
        },
        {
          id: "example",
          type: "formula",
          text: "z = 1 × 5 − 4 = 1",
          caption: "p = 1 / (1 + e⁻¹) ≈ 0.731 → 73.1%",
        },
        {
          id: "decision",
          type: "text",
          text: "With a 0.5 decision threshold, predict “pass”. The threshold is a choice; the probability is not a guarantee.",
        },
        {
          id: "check",
          type: "question",
          prompt: "When the score z = 0, what is the predicted probability?",
          choices: ["0%", "25%", "50%", "100%"],
          correctIndex: 2,
          explanation: "e⁰ = 1, so p = 1 / (1 + 1) = 0.50.",
        },
      ],
    },
  ],
};

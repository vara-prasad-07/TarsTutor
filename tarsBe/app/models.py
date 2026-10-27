from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Id = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,100}$")]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Intent = Literal["new_topic", "follow_up", "clarification", "answer_submission", "review_work", "board_reference", "off_topic"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)


class BoardContext(StrictModel):
    selected_element_ids: list[Id] = Field(default_factory=list, max_length=30)
    selected_text: str = Field(default="", max_length=6000)
    lesson_id: Id | None = None
    step_id: Id | None = None


class TurnRequest(StrictModel):
    turn_id: Id
    message: str = Field(min_length=1, max_length=4000)
    answer_to_question_id: Id | None = None
    action: Literal["message", "review_work"] = "message"
    board_context: BoardContext = Field(default_factory=BoardContext)


class Classification(StrictModel):
    intent: Intent
    needs_clarification: bool
    clarification: str = Field(max_length=360)


class Calculation(StrictModel):
    operation: Literal["expression", "sigmoid"]
    expression: str = Field(default="", max_length=200)
    value: float = Field(default=0, ge=-1000000, le=1000000)


class Plan(StrictModel):
    goal: str = Field(min_length=1, max_length=240)
    steps: list[Text] = Field(min_length=1, max_length=3)
    criteria: list[Text] = Field(min_length=1, max_length=5)
    calculations: list[Calculation] = Field(default_factory=list, max_length=2)


class Block(StrictModel):
    type: Literal["text", "formula"]
    text: str = Field(min_length=1, max_length=240)
    caption: str = Field(default="", max_length=100)


class Step(StrictModel):
    title: str = Field(min_length=1, max_length=32)
    explanation: str = Field(min_length=1, max_length=360)
    blocks: list[Block] = Field(min_length=1, max_length=4)


class LessonDraft(StrictModel):
    title: str = Field(min_length=1, max_length=70)
    reply: str = Field(min_length=1, max_length=360)
    steps: list[Step] = Field(min_length=1, max_length=3)


class QuestionDraft(StrictModel):
    prompt: str = Field(min_length=1, max_length=240)
    kind: Literal["numeric", "choice"]
    choices: list[Text] = Field(default_factory=list, max_length=4)
    expected_number: float | None = None
    correct_index: int | None = Field(default=None, ge=0, le=3)
    tolerance: float = Field(default=0.001, ge=0, le=1)

    @model_validator(mode="after")
    def check_key(self):
        if self.kind == "numeric" and (self.expected_number is None or self.choices or self.correct_index is not None):
            raise ValueError("Numeric questions need a number and no choices/index")
        if self.kind == "choice" and (len(self.choices) < 2 or self.correct_index is None or self.correct_index >= len(self.choices) or self.expected_number is not None):
            raise ValueError("Choice questions need 2-4 choices and a valid index")
        return self


class Draft(StrictModel):
    reply: str = Field(min_length=1, max_length=360)
    lesson: LessonDraft | None = None
    question: QuestionDraft | None = None


class Review(StrictModel):
    passed: bool
    issues: list[Text] = Field(default_factory=list, max_length=5)


class PublicQuestion(StrictModel):
    id: Id
    prompt: str
    kind: Literal["numeric", "choice"]
    choices: list[str]


class Feedback(StrictModel):
    question_id: Id
    correct: bool | None
    message: str


class LessonBlock(Block):
    id: Id


class LessonStep(Step):
    id: Id
    blocks: list[LessonBlock] = Field(min_length=1, max_length=4)


class TutorLesson(LessonDraft):
    lessonId: Id
    turnId: Id
    steps: list[LessonStep] = Field(min_length=1, max_length=3)


class TurnResponse(StrictModel):
    session_id: Id
    turn_id: Id
    status: Literal["completed", "clarification", "fallback"]
    intent: Intent
    reply: str
    lesson: TutorLesson | None = None
    question: PublicQuestion | None = None
    feedback: Feedback | None = None
    next_action: Literal["continue", "answer_question", "clarify"]
    trace: list[str]
    model: str

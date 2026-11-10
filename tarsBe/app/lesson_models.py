"""Validated, declarative classroom content. No executable HTML or JavaScript."""
import base64
import binascii
import struct
from typing import Literal

from pydantic import Field, model_validator

from .models import Id, StrictModel

Color = Literal["ink", "green", "blue", "coral", "purple"]


class Point(StrictModel):
    x: float = Field(ge=-1e7, le=1e7)
    y: float = Field(ge=-1e7, le=1e7)


class Series(StrictModel):
    label: str = Field(default="", max_length=80)
    kind: Literal["points", "line"] = "points"
    color: Color = "blue"
    points: list[Point] = Field(min_length=1, max_length=80)


class Element(StrictModel):
    id: str = Field(default="", max_length=100)
    type: Literal["text", "equation", "graph", "shape", "arrow", "table", "code"]
    reveal_at: float = Field(default=0, ge=0, le=1)
    x: float = Field(default=60, ge=0, le=1000)
    y: float = Field(default=80, ge=0, le=700)
    width: float = Field(default=880, gt=0, le=1000)
    height: float = Field(default=100, gt=0, le=700)
    text: str = Field(default="", max_length=2000)
    caption: str = Field(default="", max_length=200)
    color: Color = "ink"
    shape: Literal["rectangle", "ellipse", "triangle"] = "rectangle"
    x2: float = Field(default=250, ge=0, le=1000)
    y2: float = Field(default=250, ge=0, le=700)
    x_label: str = Field(default="x", max_length=80)
    y_label: str = Field(default="y", max_length=80)
    x_min: float = Field(default=0, ge=-1e7, le=1e7)
    x_max: float = Field(default=10, ge=-1e7, le=1e7)
    y_min: float = Field(default=0, ge=-1e7, le=1e7)
    y_max: float = Field(default=10, ge=-1e7, le=1e7)
    series: list[Series] = Field(default_factory=list, max_length=6)
    columns: list[str] = Field(default_factory=list, max_length=6)
    rows: list[list[str]] = Field(default_factory=list, max_length=10)
    language: str = Field(default="python", max_length=30)

    @model_validator(mode="after")
    def bounds(self):
        if self.type == "graph" and (self.x_max <= self.x_min or self.y_max <= self.y_min):
            raise ValueError("Graph axes must have increasing bounds")
        if any(len(row) > 6 or any(len(cell) > 120 for cell in row) for row in self.rows):
            raise ValueError("Table exceeds cell limits")
        if any(len(column) > 120 for column in self.columns):
            raise ValueError("Table headings exceed limits")
        return self


class Material(StrictModel):
    name: str = Field(min_length=1, max_length=180)
    media_type: str = Field(default="text/plain", max_length=100)
    text: str = Field(default="", max_length=24000)
    data: str = Field(default="", max_length=8_000_000)


class Upload(StrictModel):
    name: str = Field(min_length=1, max_length=180)
    media_type: str = Field(default="application/octet-stream", max_length=100)
    data: str = Field(min_length=1, max_length=8_000_000)


class LessonRequest(StrictModel):
    session_id: Id
    prompt: str = Field(min_length=1, max_length=4000)
    materials: list[Material] = Field(default_factory=list, max_length=5)


class OutlinePart(StrictModel):
    title: str = Field(min_length=1, max_length=90)
    objective: str = Field(min_length=1, max_length=300)


class Outline(StrictModel):
    title: str = Field(min_length=1, max_length=100)
    subject: str = Field(min_length=1, max_length=80)
    objectives: list[str] = Field(min_length=1, max_length=6)
    parts: list[OutlinePart] = Field(min_length=3, max_length=6)


class Quiz(StrictModel):
    kind: Literal["choice", "numeric", "text"]
    prompt: str = Field(min_length=1, max_length=400)
    choices: list[str] = Field(default_factory=list, max_length=5)
    correct_index: int | None = Field(default=None, ge=0, le=4)
    expected_number: float | None = None
    accepted_answers: list[str] = Field(default_factory=list, max_length=12)
    tolerance: float = Field(default=0.01, ge=0, le=1)
    explanation: str = Field(min_length=1, max_length=900)

    @model_validator(mode="after")
    def key(self):
        if self.kind == "choice" and (len(self.choices) < 2 or self.correct_index is None or self.correct_index >= len(self.choices)):
            raise ValueError("Choice quiz needs at least two choices and a valid key")
        if self.kind == "numeric" and self.expected_number is None:
            raise ValueError("Numeric quiz needs expected_number")
        if self.kind == "text" and not self.accepted_answers:
            raise ValueError("Text quiz needs accepted_answers")
        if any(len(item) > 400 for item in self.choices + self.accepted_answers):
            raise ValueError("Quiz answers are too long")
        return self


class SegmentDraft(StrictModel):
    title: str = Field(min_length=1, max_length=100)
    objective: str = Field(min_length=1, max_length=300)
    narration: str = Field(min_length=30, max_length=4500)
    elements: list[Element] = Field(min_length=2, max_length=12)
    quiz: Quiz


class WhiteboardContext(StrictModel):
    media_type: Literal["image/png", "image/jpeg"]
    data: str = Field(min_length=1, max_length=2_700_000)
    scope: Literal["selection", "student_work", "board"] = "board"
    element_count: int = Field(ge=0, le=20000)
    has_student_work: bool = False
    selected_element_ids: list[str] = Field(default_factory=list, max_length=100)
    text: str = Field(default="", max_length=6000)

    @model_validator(mode="after")
    def check_image(self):
        try:
            raw = base64.b64decode(self.data, validate=True)
        except (ValueError, binascii.Error):
            raise ValueError("Whiteboard image must be valid base64.") from None
        if not raw or len(raw) > 2_000_000:
            raise ValueError("Whiteboard image must be at most 2 MB.")
        width = height = 0
        if self.media_type == "image/png":
            if len(raw) < 33 or raw[:8] != b"\x89PNG\r\n\x1a\n" or raw[12:16] != b"IHDR" or raw[-8:-4] != b"IEND":
                raise ValueError("Whiteboard image is not a complete PNG.")
            width, height = struct.unpack(">II", raw[16:24])
        else:
            if raw[:2] != b"\xff\xd8" or raw[-2:] != b"\xff\xd9":
                raise ValueError("Whiteboard image is not a complete JPEG.")
            offset = 2
            while offset + 4 <= len(raw):
                if raw[offset] != 0xff:
                    break
                marker = raw[offset + 1]
                if marker == 0xff:
                    offset += 1
                    continue
                size = int.from_bytes(raw[offset + 2:offset + 4], "big")
                if size < 2 or offset + 2 + size > len(raw):
                    break
                if marker in (0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf) and size >= 8:
                    height, width = struct.unpack(">HH", raw[offset + 5:offset + 9])
                    break
                offset += 2 + size
        if not 1 <= width <= 2048 or not 1 <= height <= 2048 or width * height > 4_000_000:
            raise ValueError("Whiteboard image dimensions must be at most 2048 pixels and four megapixels.")
        if any(len(value) > 300 for value in self.selected_element_ids):
            raise ValueError("Selected whiteboard identifiers are too long.")
        return self


class AskRequest(StrictModel):
    request_id: Id
    message: str = Field(min_length=1, max_length=4000)
    segment_id: Id
    whiteboard: WhiteboardContext | None = None


class TutorAnswer(StrictModel):
    reply: str = Field(min_length=1, max_length=2000)
    narration: str = Field(min_length=1, max_length=2400)
    elements: list[Element] = Field(default_factory=list, max_length=6)


class AnswerRequest(StrictModel):
    request_id: Id
    question_id: Id
    answer: str = Field(min_length=1, max_length=1200)

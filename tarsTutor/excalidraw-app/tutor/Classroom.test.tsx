import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LessonElement, LessonSnapshot } from "../../shared/classroom";
import Classroom from "./Classroom";
import { useClassroomAudio } from "./useClassroomAudio";

vi.mock("./useClassroomAudio", () => ({ useClassroomAudio: vi.fn() }));
const capture = vi.hoisted(() => vi.fn());
const explain = vi.hoisted(() => vi.fn());
vi.mock("./ClassroomBoard", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    default: forwardRef(({ title }: { title: string }, ref) => {
      useImperativeHandle(ref, () => ({
        capture,
        explain,
        follow: vi.fn(),
        draw: vi.fn(),
      }));
      return (
        <div
          role="region"
          aria-label={`${title}. Interactive lesson whiteboard`}
        />
      );
    }),
  };
});
const drawing = {
  media_type: "image/png",
  data: "drawing-at-question-time",
  scope: "student_work",
  element_count: 4,
  has_student_work: true,
  selected_element_ids: [],
  text: "",
};
const fetchMock = vi.fn();
const play = vi.fn();
const pause = vi.fn();
const preload = vi.fn();
const visual = {
  id: "graph-1",
  type: "graph",
  reveal_at: 0,
  x: 60,
  y: 160,
  width: 800,
  height: 350,
  text: "",
  caption: "",
  color: "blue",
  shape: "rectangle",
  x2: 0,
  y2: 0,
  x_label: "Hours",
  y_label: "Score",
  x_min: 0,
  x_max: 5,
  y_min: 0,
  y_max: 100,
  series: [
    {
      label: "Predicted",
      kind: "line",
      color: "blue",
      points: [
        { x: 0, y: 45 },
        { x: 5, y: 75 },
      ],
    },
  ],
  columns: [],
  rows: [],
  language: "python",
} as LessonElement;
const lesson: LessonSnapshot = {
  session_id: "classroom-test",
  prompt: "Teach linear regression",
  title: "Linear regression",
  status: "completed",
  stage: "start",
  generating: false,
  stages: [],
  materials: [],
  error: null,
  revision: 1,
  conversation: [
    { role: "student", text: "What is slope?" },
    { role: "tutor", text: "The change for each additional input unit." },
  ],
  segments: [
    {
      id: "s1",
      title: "Reading a line",
      objective: "Understand slope",
      narration: "The slope is the predicted change for each hour.",
      duration_seconds: 30,
      elements: [visual],
      quiz: {
        id: "q1",
        kind: "choice",
        prompt: "What is the slope?",
        choices: ["6 points per hour", "45 points"],
      },
    },
    {
      id: "s2",
      title: "Make a prediction",
      objective: "Apply the equation",
      narration: "Substitute three hours into the equation.",
      duration_seconds: 25,
      elements: [{ ...visual, id: "graph-2" }],
      quiz: null,
    },
  ],
};
const json = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => data,
});
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  capture.mockReset().mockResolvedValue(drawing);
  explain.mockReset();
  play.mockReset();
  pause.mockReset();
  preload.mockReset();
  window.localStorage.clear();
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
  vi.mocked(useClassroomAudio).mockImplementation(() => {
    const [progress, setProgress] = useState(0);
    return {
      progress,
      replyProgress: 1,
      playing: false,
      isReply: false,
      loading: false,
      error: "",
      silent: false,
      setSilent: vi.fn(),
      pause,
      play,
      setProgress,
      preload,
    };
  });
  fetchMock.mockImplementation(async (url: string) =>
    json(
      url.endsWith("/status")
        ? { stt_configured: true, tts_configured: true }
        : {},
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("interactive classroom", () => {
  it("keeps a drafted question when the compact materials panel opens and closes", async () => {
    await act(async () => {
      render(
        <Classroom
          snapshot={lesson}
          view={window}
          onNavigate={vi.fn()}
          refresh={vi.fn()}
        />,
      );
    });
    expect(
      screen.queryByRole("complementary", { name: "Course source" }),
    ).not.toBeInTheDocument();
    const input = screen.getByRole("textbox", {
      name: "Ask your tutor a question",
    });
    fireEvent.change(input, { target: { value: "Explain my drawing" } });
    fireEvent.click(screen.getByRole("button", { name: "Materials" }));
    expect(
      screen.getByRole("complementary", { name: "Course source" }),
    ).toBeInTheDocument();
    expect(input).toHaveValue("Explain my drawing");
    fireEvent.click(
      screen.getByRole("button", { name: "Close materials sidebar" }),
    );
    expect(
      screen.queryByRole("complementary", { name: "Course source" }),
    ).not.toBeInTheDocument();
    expect(input).toHaveValue("Explain my drawing");
    expect(
      screen
        .getByRole("button", { name: "Play lesson" })
        .closest(".tc-lesson-dock"),
    ).not.toBeNull();
  });
  it.each(["English", "Telugu"])(
    "converts %s voice to WAV and asks about the drawing",
    async (language) => {
      const stopTrack = vi.fn();
      vi.stubGlobal("navigator", {
        mediaDevices: {
          getUserMedia: vi.fn(async () => ({
            getTracks: () => [{ stop: stopTrack }],
          })),
        },
      });
      vi.stubGlobal(
        "Blob",
        class {
          size = 1;
          async arrayBuffer() {
            return new ArrayBuffer(1);
          }
        },
      );
      vi.stubGlobal(
        "MediaRecorder",
        class {
          state = "inactive";
          mimeType = "audio/webm";
          ondataavailable: ((event: { data: Blob }) => void) | null = null;
          onstop: (() => void) | null = null;
          start() {
            this.state = "recording";
          }
          stop() {
            this.state = "inactive";
            this.ondataavailable?.({ data: new window.Blob(["audio"]) });
            this.onstop?.();
          }
        },
      );
      vi.stubGlobal(
        "AudioContext",
        class {
          async decodeAudioData() {
            return {
              numberOfChannels: 1,
              sampleRate: 16000,
              getChannelData: () => new Float32Array(16000),
            };
          }
          async close() {}
        },
      );
      fetchMock.mockImplementation(async (url: string) =>
        json(
          url.startsWith("/api/tutor/speech/stt")
            ? { text: "Explain slope in simple words" }
            : url.endsWith("/questions")
            ? {
                request_id: "voice-ask",
                reply: "Slope is the change per input unit.",
                narration: "Think of a rate per hour.",
                elements: [],
                board_used: true,
              }
            : { stt_configured: true, tts_configured: true },
        ),
      );
      render(
        <Classroom
          snapshot={{
            ...lesson,
            prompt: `Teach linear regression in ${language}`,
          }}
          view={window}
          onNavigate={vi.fn()}
          refresh={vi.fn()}
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Record a question" }),
      );
      await screen.findByRole("button", { name: "Stop recording" });
      // The image is frozen at microphone click, before transcription completes.
      capture.mockResolvedValue({
        ...drawing,
        data: "changed-after-recording-started",
      });
      fireEvent.click(
        await screen.findByRole("button", { name: "Stop recording" }),
      );
      expect(
        await screen.findByRole("region", { name: "Tutor answer" }),
      ).toHaveTextContent("change per input unit");
      const recording = fetchMock.mock.calls.find(([url]) =>
        url.startsWith("/api/tutor/speech/stt"),
      );
      expect(recording?.[0]).toBe(
        `/api/tutor/speech/stt${
          language === "Telugu" ? "?language=te-IN" : ""
        }`,
      );
      expect(recording?.[1].headers["Content-Type"]).toBe("audio/wav");
      const wav = new DataView(recording?.[1].body);
      expect(wav.getUint32(24, true)).toBe(16000);
      const questionRequest = fetchMock.mock.calls.find(([url]) =>
        url.endsWith("/questions"),
      );
      expect(JSON.parse(questionRequest?.[1].body)).toMatchObject({
        message: "Explain slope in simple words",
        segment_id: "s1",
        whiteboard: drawing,
      });
      expect(capture).toHaveBeenCalledTimes(1);
      expect(stopTrack).toHaveBeenCalled();
      expect(play).toHaveBeenCalledWith(
        "Think of a rate per hour.",
        expect.any(Number),
        "reply",
      );
    },
  );

  it("renders the generated graph, checks a quiz, and continues with the next chapter's narration", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      json(
        url.endsWith("/answers")
          ? {
              question_id: "q1",
              correct: true,
              explanation:
                "The coefficient 6 is the score gained per study hour.",
            }
          : { stt_configured: true, tts_configured: true },
      ),
    );
    const { container } = render(
      <Classroom
        snapshot={lesson}
        view={window}
        onNavigate={vi.fn()}
        refresh={vi.fn()}
      />,
    );
    fireEvent.change(
      screen.getByRole("slider", { name: "Lesson playback position" }),
      { target: { value: "1000" } },
    );
    expect(
      screen.getByRole("region", {
        name: /Reading a line. Interactive lesson whiteboard/,
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /6 points per hour/ }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "The coefficient 6",
    );
    const answerRequest = fetchMock.mock.calls.find(([url]) =>
      url.endsWith("/answers"),
    );
    expect(JSON.parse(answerRequest?.[1].body).answer).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: /Continue lesson/ }));
    expect(play).toHaveBeenCalledWith(lesson.segments[1].narration, 25);
    expect(
      screen.getByRole("region", { name: /Make a prediction/ }),
    ).toBeInTheDocument();
  });

  it("pauses for a contextual question and provides a resume control and restored conversation", async () => {
    window.localStorage.setItem(
      "tars-classroom-classroom-test",
      JSON.stringify({ segmentId: "s1", progress: 0.43 }),
    );
    fetchMock.mockImplementation(async (url: string) =>
      json(
        url.endsWith("/questions")
          ? {
              request_id: "ask",
              reply: "Think of an hourly pay rate.",
              narration: "For every extra hour you earn six more points.",
              elements: [],
            }
          : { stt_configured: true, tts_configured: true },
      ),
    );
    render(
      <Classroom
        snapshot={lesson}
        view={window}
        onNavigate={vi.fn()}
        refresh={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByRole("slider")).toHaveValue("430"));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Ask your tutor a question" }),
      { target: { value: "Give a real-life example" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));
    expect(
      await screen.findByRole("region", { name: "Tutor answer" }),
    ).toHaveTextContent("hourly pay rate");
    expect(pause).toHaveBeenCalled();
    const request = fetchMock.mock.calls.find(([url]) =>
      url.endsWith("/questions"),
    );
    expect(JSON.parse(request?.[1].body)).toMatchObject({
      segment_id: "s1",
      message: "Give a real-life example",
    });
    expect(play).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Number),
      "reply",
    );
    fireEvent.click(screen.getByRole("button", { name: /Resume lesson/ }));
    expect(play).toHaveBeenLastCalledWith(lesson.segments[0].narration, 30);
    expect(screen.getByRole("slider")).toHaveValue("430");
    fireEvent.click(
      screen.getByRole("button", { name: "Toggle lesson transcript" }),
    );
    expect(
      screen.getByRole("complementary", { name: "Lesson transcript" }),
    ).toHaveTextContent("The change for each additional input unit.");
  });
  it("keeps the student's drawing visible while explaining it and reuses its snapshot on network retry", async () => {
    let attempts = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/questions")) {
        if (++attempts === 1) {
          throw new Error("Connection interrupted");
        }
        return json({
          request_id: "drawing-reply",
          reply: "Area is length times width: 3 × 7 = 21 square units.",
          narration: "Multiply three by seven to get twenty-one square units.",
          elements: [visual],
          board_used: true,
        });
      }
      return json({ stt_configured: true, tts_configured: true });
    });
    render(
      <Classroom
        snapshot={lesson}
        view={window}
        onNavigate={vi.fn()}
        refresh={vi.fn()}
      />,
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Ask your tutor a question" }),
      { target: { value: "What is the area of my drawing?" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Connection interrupted",
    );
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));
    expect(
      await screen.findByRole("region", { name: "Tutor answer" }),
    ).toHaveTextContent("21 square units");
    const requests = fetchMock.mock.calls.filter(([url]) =>
      url.endsWith("/questions"),
    );
    expect(JSON.parse(requests[0][1].body).whiteboard).toEqual(drawing);
    expect(requests[1][1].body).toBe(requests[0][1].body);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(explain).toHaveBeenCalledWith(
      expect.objectContaining({
        request_id: "drawing-reply",
        board_used: true,
      }),
      drawing,
    );
    expect(
      screen.getByRole("region", {
        name: "Reading a line. Interactive lesson whiteboard",
      }),
    ).toBeInTheDocument();
    expect(play).toHaveBeenLastCalledWith(
      expect.stringContaining("twenty-one"),
      expect.any(Number),
      "reply",
    );
  });

  it("reports snapshot failures without sending an unseen drawing to the tutor", async () => {
    capture.mockRejectedValue(new Error("Please select a smaller drawing."));
    render(
      <Classroom
        snapshot={lesson}
        view={window}
        onNavigate={vi.fn()}
        refresh={vi.fn()}
      />,
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Ask your tutor a question" }),
      { target: { value: "Explain this" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "select a smaller drawing",
    );
    expect(
      fetchMock.mock.calls.some(([url]) => url.endsWith("/questions")),
    ).toBe(false);
    expect(screen.getByRole("button", { name: "Send question" })).toBeEnabled();
  });
});

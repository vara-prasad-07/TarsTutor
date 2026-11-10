import { useCallback, useEffect, useRef, useState } from "react";

import { lessonRequest, uploadMaterial } from "../../shared/classroom";
import type {
  ClassroomWindow,
  ClassroomQuestion,
  WhiteboardContext,
  LessonSnapshot,
  QuizFeedback,
  TutorAnswer,
} from "../../shared/classroom";

import { speechLanguage } from "./speechLanguage";
import { encodeWav, readableError } from "./classroomMedia";
import { useClassroomAudio } from "./useClassroomAudio";
import ClassroomBoard from "./ClassroomBoard";
import type { ClassroomBoardHandle } from "./ClassroomBoard";
import type { InkStroke } from "./WhiteboardView";

import { ThemeToggle, useTutorTheme } from "./useTutorTheme";
import QuestionComposer from "./QuestionComposer";
import "./classroom.scss";
import "./classroom-polish.scss";

const Icon = ({ name, size = 20 }: { name: string; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {name === "play" ? (
      <path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none" />
    ) : name === "pause" ? (
      <>
        <path d="M8 5v14M16 5v14" strokeWidth="4" />
      </>
    ) : name === "mic" ? (
      <>
        <rect x="9" y="2" width="6" height="13" rx="3" />
        <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" />
      </>
    ) : name === "volume" ? (
      <>
        <path d="m3 9 5 0 5-5v16l-5-5H3Z" />
        <path d="M16 8a7 7 0 0 1 0 8m3-11a11 11 0 0 1 0 14" />
      </>
    ) : name === "mute" ? (
      <>
        <path d="m3 9 5 0 5-5v16l-5-5H3Z" />
        <path d="m17 9 5 6m0-6-5 6" />
      </>
    ) : name === "chat" ? (
      <>
        <path d="M20 15a4 4 0 0 1-4 4h-5l-5 3v-3H5a3 3 0 0 1-3-3V6a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
        <path d="M7 7h8M7 11h6" />
      </>
    ) : name === "close" ? (
      <path d="m6 6 12 12M6 18 18 6" />
    ) : name === "upload" ? (
      <>
        <path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5" />
      </>
    ) : name === "download" ? (
      <>
        <path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5" />
      </>
    ) : name === "pen" ? (
      <>
        <path d="m4 16 12-12 4 4L8 20l-5 1ZM14 6l4 4" />
      </>
    ) : name === "send" ? (
      <>
        <path d="M12 21V3m-7 7 7-7 7 7" />
      </>
    ) : name === "back" ? (
      <path d="m14 5-7 7 7 7" />
    ) : name === "next" ? (
      <path d="m10 5 7 7-7 7" />
    ) : name === "replay" ? (
      <>
        <path d="M3 9a9 9 0 1 1 0 6M3 3v6h6" />
      </>
    ) : name === "focus" ? (
      <>
        <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />
        <circle cx="12" cy="12" r="2" />
      </>
    ) : name === "file" ? (
      <>
        <path d="M5 2h9l5 5v15H5Z" />
        <path d="M14 2v6h5M8 12h8M8 16h6" />
      </>
    ) : name === "check" ? (
      <path d="m5 12 4 4L20 5" />
    ) : name === "plus" ? (
      <path d="M12 5v14M5 12h14" />
    ) : name === "minus" ? (
      <path d="M5 12h14" />
    ) : name === "book" ? (
      <>
        <path d="M12 5C9 2 5 2 2 3v17c3-1 7-1 10 2 3-3 7-3 10-2V3c-3-1-7-1-10 2Zm0 0v17" />
      </>
    ) : (
      <circle cx="12" cy="12" r="8" />
    )}
  </svg>
);

type ChatMessage = { role: "student" | "tutor"; text: string };
type SavedClassroom = {
  segmentId?: string;
  progress?: number;
  answered?: string[];
  strokes?: Record<string, InkStroke[]>;
  speed?: number;
};

export type ClassroomProps = {
  snapshot: LessonSnapshot;
  view: ClassroomWindow;
  onNavigate: (path: string) => void;
  refresh: () => void;
  autoplay?: boolean;
  /** Initial UI state for the standalone development render harness. */
  initialPresentation?: {
    sidebar?: boolean;
    transcript?: boolean;
    question?: string;
    answer?: TutorAnswer;
    quizAnswer?: string;
    feedback?: QuizFeedback;
    recording?: boolean;
    complete?: boolean;
    onBoardReady?: () => void;
  };
};

export default function Classroom({
  snapshot,
  view,
  onNavigate,
  refresh,
  autoplay = false,
  initialPresentation,
}: ClassroomProps) {
  const presentation = import.meta.env.DEV ? initialPresentation : undefined;
  const { theme } = useTutorTheme(view);
  const storageKey = `tars-classroom-${snapshot.session_id}`;
  const saved = useRef<SavedClassroom | null>(null);
  if (!saved.current) {
    try {
      saved.current = JSON.parse(view.localStorage.getItem(storageKey) || "{}");
    } catch {
      saved.current = {};
    }
  }
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      snapshot.segments.findIndex(
        (part) => part.id === saved.current?.segmentId,
      ),
    ),
  );
  const [speed, setSpeed] = useState(saved.current?.speed || 1);
  const [muted, setMuted] = useState(false);
  const [sidebar, setSidebar] = useState(presentation?.sidebar || false);
  const [transcript, setTranscript] = useState(presentation?.transcript || false);
  const [drawing, setDrawing] = useState(false);
  const [question, setQuestion] = useState(presentation?.question || "");
  const [messages, setMessages] = useState<ChatMessage[]>(
    snapshot.conversation || [],
  );
  const [answer, setAnswer] = useState<TutorAnswer | null>(presentation?.answer || null);
  const [boardAnswer, setBoardAnswer] = useState<TutorAnswer | null>(null);
  const [startingRecording, setStartingRecording] = useState(false);
  const questionBusy = useRef(false);
  const voiceBusy = useRef(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");
  const [answered, setAnswered] = useState<string[]>(
    saved.current?.answered || [],
  );
  const [quizAnswer, setQuizAnswer] = useState(presentation?.quizAnswer || "");
  const [feedback, setFeedback] = useState<QuizFeedback | null>(presentation?.feedback || null);
  const [grading, setGrading] = useState(false);
  const [strokes] = useState<Record<string, InkStroke[]>>(
    saved.current?.strokes || {},
  );
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(presentation?.recording || false);
  const [transcribing, setTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voiceReady, setVoiceReady] = useState<boolean | null>(null);
  const [complete, setComplete] = useState(presentation?.complete || false);
  const mainRef = useRef<HTMLElement>(null);
  const controlsRef = useRef<HTMLElement>(null);
  const boardEditor = useRef<ClassroomBoardHandle>(null);
  useEffect(() => {
    if (!presentation) return;
    const timers = [1500, 6000].map(delay => view.setTimeout(() => boardEditor.current?.restore(), delay));
    return () => timers.forEach(timer => view.clearTimeout(timer));
  }, [presentation, view]);
  const uploadRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingTimer = useRef<number | undefined>(undefined);
  const activeRequest = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const pendingQuestion = useRef<ClassroomQuestion | null>(null);
  const pendingGrade = useRef<{
    request_id: string;
    question_id: string;
    answer: string;
  } | null>(null);
  const segment = snapshot.segments[index] || snapshot.segments[0];
  const playback = useClassroomAudio(view, speed, muted);
  useEffect(() => {
    const controls = controlsRef.current;
    const root = mainRef.current;
    const ownerView = controls?.ownerDocument
      .defaultView as ClassroomWindow | null;
    if (!controls || !root || !ownerView) {
      return;
    }
    const measure = () => {
      const height = Math.ceil(controls.getBoundingClientRect().height);
      if (height > 0) {
        root.style.setProperty("--tc-controls-height", `${height}px`);
      }
    };
    measure();
    const observer = ownerView.ResizeObserver
      ? new ownerView.ResizeObserver(measure)
      : null;
    observer?.observe(controls);
    ownerView.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      ownerView.removeEventListener("resize", measure);
    };
  }, [view]);
  const latest = useRef({
    index,
    progress: playback.progress,
    answered,
    strokes,
    speed,
  });
  latest.current = {
    index,
    progress: playback.progress,
    answered,
    strokes,
    speed,
  };
  const ended = playback.progress >= 0.999;
  const quiz = segment?.quiz;
  const showQuiz =
    ended &&
    quiz &&
    !answered.includes(quiz.id) &&
    !answer &&
    !asking &&
    !startingRecording &&
    !recording &&
    !transcribing &&
    !complete;

  const persist = useCallback(() => {
    const current = latest.current;
    try {
      view.localStorage.setItem(
        storageKey,
        JSON.stringify({
          segmentId: snapshot.segments[current.index]?.id,
          progress: current.progress,
          answered: current.answered,
          strokes: current.strokes,
          speed: current.speed,
        }),
      );
    } catch {
      /* The current lesson remains usable when browser storage is disabled/full. */
    }
  }, [snapshot.segments, storageKey, view]);

  useEffect(() => {
    playback.setProgress(saved.current?.progress || 0);
    const controller = new view.AbortController();
    void lessonRequest<{ stt_configured: boolean; tts_configured: boolean }>(
      view,
      "speech/status",
      undefined,
      controller.signal,
    )
      .then((status) => {
        if (!controller.signal.aborted) {
          setVoiceReady(status.stt_configured);
        }
      })
      .catch(() => {});
    return () => controller.abort();
    // The initial playback position is restored once for this session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.session_id, view]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      activeRequest.current?.abort();
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      view.clearInterval(recordingTimer.current);
    };
  }, [view]);

  useEffect(() => {
    if (!autoplay) {
      return;
    }
    const first = snapshot.segments[index] || snapshot.segments[0];
    if (first) {
      void playback.play(first.narration, first.duration_seconds);
    }
    return () => playback.pause();
    // Only a newly generated classroom attempts autoplay. Reloads restore paused.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.session_id, autoplay]);

  useEffect(() => {
    const timer = view.setInterval(persist, 1800);
    view.addEventListener("pagehide", persist);
    return () => {
      persist();
      view.clearInterval(timer);
      view.removeEventListener("pagehide", persist);
    };
  }, [persist, view]);

  useEffect(() => {
    if (
      playback.playing &&
      !playback.isReply &&
      !playback.silent &&
      snapshot.segments[index + 1]
    ) {
      playback.preload(snapshot.segments[index + 1].narration);
    }
  }, [
    index,
    playback.playing,
    playback.isReply,
    playback.silent,
    playback.preload,
    snapshot.segments,
  ]);

  const playLesson = () => {
    if (!segment || asking || startingRecording || recording || transcribing) {
      return;
    }
    setAnswer(null);
    setBoardAnswer(null);
    setComplete(false);
    if (playback.progress >= 0.999) {
      playback.setProgress(0);
    }
    void playback.play(segment.narration, segment.duration_seconds);
  };

  const changeSegment = (next: number, autoplay = false) => {
    if (
      next < 0 ||
      next >= snapshot.segments.length ||
      asking ||
      startingRecording ||
      recording ||
      transcribing
    ) {
      return;
    }
    playback.pause();
    playback.setProgress(0);
    setIndex(next);
    setAnswer(null);
    setBoardAnswer(null);
    setFeedback(null);
    setQuizAnswer("");
    setComplete(false);
    if (autoplay) {
      const nextSegment = snapshot.segments[next];
      void playback.play(nextSegment.narration, nextSegment.duration_seconds);
    }
  };

  const continueLesson = () => {
    if (quiz) {
      setAnswered((old) => (old.includes(quiz.id) ? old : [...old, quiz.id]));
    }
    setFeedback(null);
    if (index + 1 < snapshot.segments.length) {
      changeSegment(index + 1, true);
    } else if (!snapshot.generating) {
      setComplete(true);
    }
  };

  const ask = async (
    message = question,
    fromVoice = false,
    captured?: WhiteboardContext | null,
  ) => {
    const text = message.trim();
    if (
      !text ||
      !segment ||
      questionBusy.current ||
      (!fromVoice && (startingRecording || recording || transcribing))
    ) {
      return;
    }
    playback.pause();
    questionBusy.current = true;
    setAsking(true);
    setError("");
    setAnswer(null);
    activeRequest.current?.abort();
    const controller = new view.AbortController();
    activeRequest.current = controller;
    const timeout = view.setTimeout(() => controller.abort(), 180000);
    try {
      const retry =
        captured === undefined &&
        pendingQuestion.current?.message === text &&
        pendingQuestion.current.segment_id === segment.id;
      let body = retry ? pendingQuestion.current! : null;
      if (!body) {
        if (!boardEditor.current) {
          throw new Error(
            "The whiteboard is still loading. Try your question again in a moment.",
          );
        }
        const whiteboard =
          captured === undefined
            ? await boardEditor.current.capture(controller.signal)
            : captured;
        body = {
          request_id: view.crypto.randomUUID(),
          message: text,
          segment_id: segment.id,
          whiteboard,
        };
        pendingQuestion.current = body;
      }
      const result = await lessonRequest<TutorAnswer>(
        view,
        `lessons/${snapshot.session_id}/questions`,
        body,
        controller.signal,
      );
      if (!mounted.current || controller.signal.aborted) {
        return;
      }
      setMessages((old) => [
        ...old.slice(-18),
        { role: "student", text },
        { role: "tutor", text: result.reply },
      ]);
      setAnswer(result);
      if (!result.board_used) {
        setBoardAnswer(result.elements.length ? result : null);
      } else {
        try {
          if (!boardEditor.current) {
            throw new Error("Whiteboard unavailable");
          }
          boardEditor.current.explain(result, body.whiteboard);
        } catch {
          setError(
            "Your answer is ready, but it could not be added to the board. You can still read or replay it below.",
          );
        }
      }
      setQuestion("");
      pendingQuestion.current = null;
      void playback.play(
        result.narration,
        Math.max(5, result.narration.split(/\s+/).length / 2.4),
        "reply",
      );
    } catch (failure) {
      if (mounted.current) {
        setError(
          controller.signal.aborted
            ? "Your question timed out. Send it again to retry."
            : failure instanceof Error
            ? failure.message
            : "Could not answer your question.",
        );
      }
    } finally {
      view.clearTimeout(timeout);
      questionBusy.current = false;
      if (mounted.current) {
        setAsking(false);
      }
    }
  };

  const grade = async (value: string) => {
    if (!quiz || !value.trim() || grading) {
      return;
    }
    playback.pause();
    setGrading(true);
    setQuizAnswer(value);
    setError("");
    const body =
      pendingGrade.current?.question_id === quiz.id &&
      pendingGrade.current.answer === value
        ? pendingGrade.current
        : {
            request_id: view.crypto.randomUUID(),
            question_id: quiz.id,
            answer: value,
          };
    pendingGrade.current = body;
    const controller = new view.AbortController();
    activeRequest.current = controller;
    const timeout = view.setTimeout(() => controller.abort(), 30000);
    try {
      const result = await lessonRequest<QuizFeedback>(
        view,
        `lessons/${snapshot.session_id}/answers`,
        body,
        controller.signal,
      );
      if (mounted.current && !controller.signal.aborted) {
        setFeedback(result);
        pendingGrade.current = null;
      }
    } catch (failure) {
      if (mounted.current) {
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not check your answer.",
        );
      }
    } finally {
      view.clearTimeout(timeout);
      if (mounted.current) {
        setGrading(false);
      }
    }
  };

  const attach = async (files: FileList | null) => {
    if (!files?.length) {
      return;
    }
    playback.pause();
    setUploading(true);
    setError("");
    try {
      if (snapshot.materials.length + files.length > 5) {
        throw new Error("You can use up to five source files per lesson.");
      }
      const materials = [];
      for (const file of Array.from(files)) {
        materials.push(await uploadMaterial(view, file));
      }
      await lessonRequest(view, `lessons/${snapshot.session_id}/materials`, {
        materials,
      });
      refresh();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The file could not be uploaded.",
      );
    } finally {
      if (mounted.current) {
        setUploading(false);
      }
      if (uploadRef.current) {
        uploadRef.current.value = "";
      }
    }
  };

  const toggleRecording = async () => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
      return;
    }
    if (voiceBusy.current || questionBusy.current || transcribing) {
      return;
    }
    playback.pause();
    setError("");
    if (!view.navigator.mediaDevices?.getUserMedia || !view.MediaRecorder) {
      setError(
        "Voice input requires a browser with microphone recording support on HTTPS or localhost.",
      );
      return;
    }
    voiceBusy.current = true;
    setStartingRecording(true);
    let prepared = false;
    try {
      if (!boardEditor.current) {
        throw new Error(
          "The whiteboard is still loading. Try again in a moment.",
        );
      }
      const captureController = new view.AbortController();
      activeRequest.current = captureController;
      const captured = await boardEditor.current.capture(
        captureController.signal,
      );
      prepared = true;
      if (!mounted.current || captureController.signal.aborted) {
        return;
      }
      const stream = await view.navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (!mounted.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const recorder = new view.MediaRecorder(stream);
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      const started = view.performance.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size) {
          chunks.push(event.data);
        }
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        view.clearInterval(recordingTimer.current);
        recorderRef.current = null;
        if (!mounted.current) {
          return;
        }
        setRecording(false);
        setTranscribing(true);
        void (async () => {
          let audioContext: AudioContext | null = null;
          const controller = new view.AbortController();
          activeRequest.current = controller;
          const timeout = view.setTimeout(() => controller.abort(), 60000);
          try {
            audioContext = new view.AudioContext();
            const blob = new view.Blob(chunks, { type: recorder.mimeType });
            const decoded = await audioContext.decodeAudioData(
              await blob.arrayBuffer(),
            );
            const channels = Array.from(
              { length: decoded.numberOfChannels },
              (_, channel) => decoded.getChannelData(channel),
            );
            const wav = encodeWav(channels, decoded.sampleRate);
            const language = speechLanguage(
              segment.narration + " " + snapshot.prompt,
            );
            const response = await view.fetch(
              `/api/tutor/speech/stt${
                language === "en-IN" ? "" : `?language=${language}`
              }`,
              {
                method: "POST",
                headers: { "Content-Type": "audio/wav" },
                body: wav,
                signal: controller.signal,
              },
            );
            if (!response.ok) {
              throw new Error(await readableError(response));
            }
            const result = await response.json();
            if (!result.text?.trim()) {
              throw new Error(
                "No speech was detected. Please try recording again.",
              );
            }
            if (mounted.current) {
              setQuestion(result.text);
              setTranscribing(false);
              void ask(result.text, true, captured);
            }
          } catch (failure) {
            if (mounted.current) {
              setError(
                failure instanceof Error
                  ? failure.message
                  : "Could not transcribe your recording.",
              );
            }
          } finally {
            view.clearTimeout(timeout);
            await audioContext?.close().catch(() => {});
            if (mounted.current) {
              setTranscribing(false);
            }
          }
        })();
      };
      recorder.onerror = () => {
        setError("Microphone recording failed. Please try again.");
        if (recorder.state === "recording") {
          recorder.stop();
        }
      };
      recorder.start();
      setRecording(true);
      setRecordingSeconds(0);
      recordingTimer.current = view.setInterval(() => {
        const seconds = Math.floor((view.performance.now() - started) / 1000);
        setRecordingSeconds(seconds);
        if (seconds >= 29 && recorder.state === "recording") {
          recorder.stop();
        }
      }, 250);
    } catch (failure) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
      view.clearInterval(recordingTimer.current);
      setRecording(false);
      setError(
        failure instanceof Error && failure.name === "NotAllowedError"
          ? "Microphone access was denied. Allow it in your browser, or type your question below."
          : !prepared && failure instanceof Error
          ? failure.message
          : "The microphone could not be opened. Check your device and try again.",
      );
    } finally {
      voiceBusy.current = false;
      if (mounted.current) {
        setStartingRecording(false);
      }
    }
  };

  const download = () => {
    const notes = [
      `# ${snapshot.title}`,
      `\nLearning request: ${snapshot.prompt}`,
      ...snapshot.segments.flatMap((part, partIndex) => [
        `\n## ${partIndex + 1}. ${part.title}`,
        part.objective,
        `\n${part.narration}`,
        ...part.elements
          .filter((element) => element.text)
          .map((element) =>
            element.type === "code"
              ? `\n\`\`\`${element.language}\n${element.text}\n\`\`\``
              : `\n${element.text}`,
          ),
        ...(part.quiz
          ? [
              `\nPractice: ${part.quiz.prompt}`,
              ...part.quiz.choices.map((choice) => `- ${choice}`),
            ]
          : []),
      ]),
      "\n---\nCreated with TarsTutor",
    ].join("\n");
    const url = view.URL.createObjectURL(
      new view.Blob([notes], { type: "text/markdown;charset=utf-8" }),
    );
    const anchor = mainRef.current!.ownerDocument.createElement("a");
    anchor.href = url;
    anchor.download = `${
      snapshot.title.replace(/[^a-z0-9 -]/gi, "").slice(0, 65) ||
      "TarsTutor lesson"
    }.md`;
    anchor.click();
    view.setTimeout(() => view.URL.revokeObjectURL(url), 1000);
  };

  const endLesson = () => {
    playback.pause();
    persist();
    if (snapshot.generating) {
      void lessonRequest(
        view,
        `lessons/${snapshot.session_id}/cancel`,
        {},
      ).catch(() => {});
    }
    onNavigate("/");
  };

  if (!segment) {
    return (
      <main className="tc-empty">
        <h1>Your classroom is getting ready</h1>
        <button
          onClick={() =>
            onNavigate(`/lesson/generating/${snapshot.session_id}`)
          }
        >
          View lesson progress
        </button>
      </main>
    );
  }

  return (
    <main
      ref={mainRef}
      data-theme={theme}
      className={`tc-classroom${sidebar ? " tc-classroom--sidebar" : ""}`}
    >
      <input
        ref={uploadRef}
        type="file"
        accept=".pdf,.docx,.pptx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp"
        multiple
        hidden
        onChange={(event) => {
          void attach(event.currentTarget.files);
        }}
      />
      {sidebar && (
        <aside className="tc-source" aria-label="Course source">
          <div className="tc-source-head">
            <div>
              <h2>Materials</h2>
            </div>
            <button
              className="tc-circle"
              aria-label="Close materials sidebar"
              onClick={() => setSidebar(false)}
            >
              <Icon name="close" />
            </button>
          </div>
          <div className="tc-instructions">
            <h3>Lesson prompt</h3>
            <p>{snapshot.prompt}</p>
          </div>
          <div className="tc-upload-zone">
            <div className="tc-upload-icon">
              <Icon name="upload" size={26} />
            </div>
            <strong>
              {snapshot.materials.length
                ? "Your lesson sources"
                : "Add study materials"}
            </strong>
            <p>
              {snapshot.materials.length
                ? "Used throughout this lesson."
                : "PDFs, images, documents or notes."}
            </p>
            <button
              className="tc-dark-button"
              disabled={uploading}
              onClick={() => uploadRef.current?.click()}
            >
              {uploading ? "Reading files…" : "Upload files"}
            </button>
          </div>
          {snapshot.materials.map((material, materialIndex) => (
            <details
              className="tc-material"
              key={`${material.name}-${materialIndex}`}
            >
              <summary>
                <Icon name="file" size={17} />
                <span>{material.name}</span>
              </summary>
              {material.text ? (
                <p>
                  {material.text.slice(0, 1400)}
                  {material.text.length > 1400 ? "…" : ""}
                </p>
              ) : (
                <p>Image attached as lesson context.</p>
              )}
            </details>
          ))}
          <div className="tc-lesson-outline">
            <span className="tc-eyebrow">CHAPTERS</span>
            {snapshot.segments.map((part, partIndex) => (
              <button
                className={partIndex === index ? "active" : ""}
                key={part.id}
                onClick={() => changeSegment(partIndex)}
              >
                <span>
                  {answered.includes(part.quiz?.id || "") ? (
                    <Icon name="check" size={13} />
                  ) : (
                    partIndex + 1
                  )}
                </span>
                {part.title}
              </button>
            ))}
            {snapshot.generating && (
              <p className="tc-small-loading">
                <i />
                Preparing the next chapter…
              </p>
            )}
          </div>
          <a
            className="tc-editor-link"
            href="/board"
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="pen" size={16} />
            Open freeform whiteboard ↗
          </a>
          <div className="tc-source-brand">
            <span>t</span>
            <strong>TarsTutor</strong>
            <small>A little clearer, every step.</small>
          </div>
        </aside>
      )}

      <section className="tc-teaching-space" aria-label="Interactive classroom">
        <header className="tc-topbar">
          <div className="tc-topbar-left">
            {!sidebar && (
              <button
                className="tc-pill"
                aria-label="Materials"
                title="Materials"
                onClick={() => setSidebar(true)}
              >
                <Icon name="book" size={17} />
                <span>Materials</span>
              </button>
            )}
            <div className="tc-header-heading">
              <span className="tc-header-brand">TarsTutor</span>
              <span className="tc-header-divider" />
              <span className="tc-header-title" title={snapshot.title}>
                {snapshot.title}
              </span>
            </div>
          </div>
          <div className="tc-topbar-actions">
            <ThemeToggle view={view} compact />
            <div className="tc-speed-control">
              <label>
                <span className="tc-sr-only">Playback speed</span>
                <select
                  value={speed}
                  onChange={(event) =>
                    setSpeed(Number(event.currentTarget.value))
                  }
                >
                  <option value="0.75">0.75× Speed</option>
                  <option value="1">1.0× Speed</option>
                  <option value="1.25">1.25× Speed</option>
                  <option value="1.5">1.5× Speed</option>
                  <option value="2">2.0× Speed</option>
                </select>
              </label>
              <button
                aria-label="Download lesson notes"
                title="Download lesson notes"
                onClick={download}
              >
                <Icon name="download" />
              </button>
            </div>
            <button className="tc-pill tc-end" onClick={endLesson}>
              <span className="tc-stop-square">■</span>
              <span>End lesson</span>
            </button>
          </div>
        </header>

        <div className="tc-board-viewport tc-board-viewport--editor">
          <ClassroomBoard
            key={
              boardAnswer?.elements.length
                ? `${snapshot.session_id}-reply-${boardAnswer.request_id}`
                : `${snapshot.session_id}-${segment.id}`
            }
            ref={boardEditor}
            sceneId={
              boardAnswer?.elements.length
                ? `${snapshot.session_id}-reply-${boardAnswer.request_id}`
                : `${snapshot.session_id}-${segment.id}`
            }
            view={view}
            title={
              boardAnswer?.elements.length
                ? "Let’s look at it another way"
                : segment.title
            }
            objective={
              boardAnswer?.elements.length
                ? "Your question, explained step by step"
                : segment.objective
            }
            elements={
              boardAnswer?.elements.length
                ? boardAnswer.elements
                : segment.elements
            }
            progress={
              boardAnswer?.elements.length
                ? answer?.request_id === boardAnswer.request_id
                  ? playback.replyProgress
                  : 1
                : playback.progress
            }
            legacyStrokes={boardAnswer ? [] : strokes[segment.id] || []}
            onInteract={playback.pause}
            onToolChange={setDrawing}
            onReady={presentation?.onBoardReady}
          />
        </div>

        {(error || playback.error || snapshot.error) && (
          <div className="tc-notice" role="alert">
            <span>{error || playback.error || snapshot.error}</span>
            {playback.error && (
              <>
                <button onClick={playLesson}>Retry audio</button>
                <button
                  onClick={() => {
                    playback.setSilent(true);
                  }}
                >
                  Continue silently
                </button>
              </>
            )}
            {snapshot.error && !error && !playback.error && (
              <button
                onClick={() => {
                  void lessonRequest(
                    view,
                    `lessons/${snapshot.session_id}/retry`,
                    {},
                  )
                    .then(refresh)
                    .catch((failure: Error) => setError(failure.message));
                }}
              >
                Retry generation
              </button>
            )}
            {error && (
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <Icon name="close" size={15} />
              </button>
            )}
          </div>
        )}

        {transcript && (
          <aside className="tc-transcript" aria-label="Lesson transcript">
            <div>
              <strong>Lesson conversation</strong>
              <button
                className="tc-circle"
                aria-label="Close transcript"
                onClick={() => setTranscript(false)}
              >
                <Icon name="close" size={17} />
              </button>
            </div>
            <article>
              <span>TARS · CURRENT CHAPTER</span>
              <p>{segment.narration}</p>
            </article>
            {messages.map((message, messageIndex) => (
              <article
                key={messageIndex}
                className={message.role === "student" ? "student" : ""}
              >
                <span>{message.role === "student" ? "YOU" : "TARS"}</span>
                <p>{message.text}</p>
              </article>
            ))}
          </aside>
        )}

        {showQuiz && (
          <section className="tc-quiz" aria-labelledby="tc-quiz-heading">
            <div className="tc-quiz-label">
              <span>✦</span> A QUICK CHECK-IN
            </div>
            <h2 id="tc-quiz-heading">{quiz.prompt}</h2>
            {quiz.kind === "choice" ? (
              <div className="tc-choices">
                {quiz.choices.map((choice, choiceIndex) => (
                  <button
                    key={choiceIndex}
                    className={
                      quizAnswer === String(choiceIndex) ? "selected" : ""
                    }
                    disabled={grading || !!feedback}
                    onClick={() => {
                      void grade(String(choiceIndex));
                    }}
                  >
                    <span>{String.fromCharCode(65 + choiceIndex)}</span>
                    {choice}
                  </button>
                ))}
              </div>
            ) : (
              <form
                className="tc-answer-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void grade(quizAnswer);
                }}
              >
                <input
                  value={quizAnswer}
                  onChange={(event) => setQuizAnswer(event.currentTarget.value)}
                  inputMode={quiz.kind === "numeric" ? "decimal" : "text"}
                  placeholder={
                    quiz.kind === "numeric"
                      ? "Enter your answer"
                      : "Explain in a few words"
                  }
                  aria-label="Your quiz answer"
                  disabled={grading || !!feedback}
                />
                <button disabled={!quizAnswer.trim() || grading || !!feedback}>
                  {grading ? "Checking…" : "Check answer"}
                </button>
              </form>
            )}
            {grading && (
              <p className="tc-small-loading">
                <i />
                Checking your answer…
              </p>
            )}
            {feedback && (
              <div
                className={`tc-feedback ${feedback.correct ? "correct" : ""}`}
                role="status"
              >
                <strong>
                  {feedback.correct
                    ? "You’ve got it!"
                    : feedback.correct === false
                    ? "Let’s work through this."
                    : "Here’s some feedback."}
                </strong>
                <p>{feedback.explanation}</p>
              </div>
            )}
            <div className="tc-quiz-footer">
              <span>
                {feedback
                  ? "Every attempt builds understanding."
                  : "Take your time. This is how learning sticks."}
              </span>
              <button onClick={continueLesson} disabled={grading}>
                {feedback ? "Continue lesson →" : "Skip"}
              </button>
            </div>
          </section>
        )}

        {answer && (
          <section className="tc-tutor-answer" aria-label="Tutor answer">
            <span className="tc-eyebrow">
              {answer.board_used
                ? "TARS EXPLAINS YOUR DRAWING"
                : "TARS EXPLAINS"}
            </span>
            <p>{answer.reply}</p>
            <div>
              <button
                onClick={() => {
                  void playback.play(answer.narration, 20, "reply");
                }}
                disabled={playback.loading}
              >
                Replay answer
              </button>
              <button
                className="tc-dark-button"
                onClick={() => {
                  playback.pause();
                  setAnswer(null);
                  setBoardAnswer(null);
                  void playback.play(
                    segment.narration,
                    segment.duration_seconds,
                  );
                }}
              >
                Resume lesson <Icon name="play" size={13} />
              </button>
            </div>
          </section>
        )}

        {asking && (
          <div className="tc-thinking" role="status">
            <span className="tc-tutor-orb small">t</span>
            <div>
              <strong>Let’s unpack that…</strong>
              <span>Your lesson is paused while Tars answers.</span>
            </div>
            <span className="tc-thinking-dots">•••</span>
          </div>
        )}

        {complete && (
          <section className="tc-complete">
            <div className="tc-complete-star">✦</div>
            <span className="tc-eyebrow">ONE TOPIC CLEARER</span>
            <h2>Look how far you’ve come.</h2>
            <p>
              You’ve explored {snapshot.segments.length} chapters of{" "}
              {snapshot.title}. Keep your notes, try another example, or learn
              something new.
            </p>
            <div>
              <button className="tc-dark-button" onClick={download}>
                Download your notes
              </button>
              <button onClick={endLesson}>Start a new lesson →</button>
            </div>
            <button
              className="tc-text-button"
              onClick={() => setComplete(false)}
            >
              Back to the whiteboard
            </button>
          </section>
        )}

        <footer ref={controlsRef} className="tc-controls">
          <div className="tc-lesson-dock">
            <div className="tc-player">
              <button
                className={`tc-circle${transcript ? " active" : ""}`}
                title="Lesson transcript"
                aria-label="Toggle lesson transcript"
                aria-pressed={transcript}
                onClick={() => setTranscript((old) => !old)}
              >
                <Icon name="chat" />
              </button>
              <button
                className="tc-circle tc-play"
                title={
                  playback.playing || playback.loading
                    ? "Pause lesson"
                    : "Play lesson"
                }
                aria-label={
                  playback.playing || playback.loading
                    ? "Pause lesson"
                    : "Play lesson"
                }
                disabled={
                  asking || startingRecording || recording || transcribing
                }
                onClick={() => {
                  if (playback.playing || playback.loading) {
                    playback.pause();
                    persist();
                  } else if (answer) {
                    void playback.play(answer.narration, 20, "reply");
                  } else {
                    playLesson();
                  }
                }}
              >
                <Icon name={playback.playing ? "pause" : "play"} />
              </button>
              <button
                className="tc-circle"
                title={muted ? "Unmute" : "Mute"}
                aria-label={muted ? "Unmute narration" : "Mute narration"}
                onClick={() => setMuted((old) => !old)}
              >
                <Icon name={muted ? "mute" : "volume"} />
              </button>
            </div>
            <div className="tc-progress-row">
              <button
                aria-label="Previous chapter"
                disabled={index === 0 || asking}
                onClick={() => changeSegment(index - 1)}
              >
                <Icon name="back" size={14} />
              </button>
              <span>
                {index + 1} / {snapshot.segments.length}
                {snapshot.generating ? "+" : ""}
              </span>
              <input
                type="range"
                min="0"
                max="1000"
                step="1"
                value={Math.round(playback.progress * 1000)}
                aria-label="Lesson playback position"
                disabled={!!answer || asking}
                onChange={(event) => {
                  playback.pause();
                  playback.setProgress(
                    Number(event.currentTarget.value) / 1000,
                  );
                }}
              />
              <button
                title={
                  snapshot.generating && index === snapshot.segments.length - 1
                    ? "Next chapter is being prepared"
                    : "Next chapter"
                }
                aria-label="Next chapter"
                disabled={
                  asking ||
                  (snapshot.generating &&
                    index === snapshot.segments.length - 1)
                }
                onClick={continueLesson}
              >
                <Icon name="next" size={14} />
              </button>
              <button
                aria-label="Replay this chapter"
                title="Replay this chapter"
                disabled={asking}
                onClick={() => {
                  playback.pause();
                  playback.setProgress(0);
                  setFeedback(null);
                  setAnswer(null);
                  setBoardAnswer(null);
                  void playback.play(
                    segment.narration,
                    segment.duration_seconds,
                  );
                }}
              >
                <Icon name="replay" size={14} />
              </button>
            </div>
            <div className="tc-status-row">
              <button
                className="tc-follow"
                onClick={() => boardEditor.current?.follow()}
              >
                <Icon name="focus" size={15} />
                Follow tutor
              </button>
              <span aria-live="polite">
                {recording
                  ? `Listening · ${recordingSeconds}s / 29s`
                  : startingRecording
                  ? "Preparing your drawing..."
                  : transcribing
                  ? "Transcribing your question…"
                  : playback.loading
                  ? "Preparing narration…"
                  : playback.silent
                  ? "Silent playback · estimated timing"
                  : playback.playing
                  ? playback.isReply
                    ? "Tars is answering your question"
                    : "Tars is explaining"
                  : ended
                  ? "A moment to reflect"
                  : "Press play when you’re ready"}
              </span>
              {playback.silent && (
                <button
                  className="tc-text-button"
                  onClick={() => playback.setSilent(false)}
                >
                  Enable voice
                </button>
              )}
            </div>
          </div>
          <QuestionComposer
            value={question}
            onChange={(value) => {
              playback.pause();
              setQuestion(value);
            }}
            onAsk={() => {
              void ask();
            }}
            onDraw={() => boardEditor.current?.draw()}
            onAttach={() => uploadRef.current?.click()}
            onRecord={() => {
              void toggleRecording();
            }}
            drawing={drawing}
            uploading={uploading}
            asking={asking}
            recording={recording}
            startingRecording={startingRecording}
            transcribing={transcribing}
            voiceReady={voiceReady}
            recordingSeconds={recordingSeconds}
          />
        </footer>
      </section>
    </main>
  );
}

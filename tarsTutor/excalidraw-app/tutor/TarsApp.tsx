import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  LessonAPIError,
  lessonRequest,
  uploadMaterial,
} from "../../shared/classroom";
import type {
  ClassroomWindow,
  LessonMaterial,
  LessonSnapshot,
} from "../../shared/classroom";
import { ThemeToggle, useTutorTheme } from "./useTutorTheme";
import "./tars-app.scss";
import "./tars-polish.scss";

const OriginalBoard = lazy(() => import("../App"));
const Classroom = lazy(() => import("./Classroom"));
const ProductDemo = lazy(() => import("./ProductDemo"));
const ACCEPT = ".txt,.md,.csv,.pdf,.docx,.pptx,.png,.jpg,.jpeg,.webp";
const stages = [
  "Understanding your learning request",
  "Planning your personalized lesson",
  "Generating explanations and examples",
  "Preparing whiteboard visuals",
  "Creating interactive quizzes",
  "Preparing AI tutor narration",
  "Starting your interactive lesson",
];

export function TarsMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`tars-brand ${small ? "tars-brand-small" : ""}`}>
      <span className="tars-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path
            d="M9 8H6v7M23 24h3v-7M11 10h12M17 10l-3 12m-4-1c2 2 5 2 7-1"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="m24 5 1 2 2 1-2 1-1 2-1-2-2-1 2-1z" fill="currentColor" />
        </svg>
      </span>
      TarsTutor<span className="tars-brand-dot">.</span>
    </span>
  );
}

function Paperclip() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l10-10m-6 13 9-9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LessonPreview({ kind }: { kind: string }) {
  return (
    <svg className="tars-preview-svg" viewBox="0 0 300 170" aria-hidden="true">
      <defs>
        <pattern
          id={`dots-${kind}`}
          width="18"
          height="18"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="3" cy="3" r=".7" fill="#d5d9d2" />
        </pattern>
      </defs>
      <rect width="300" height="170" fill={`url(#dots-${kind})`} />
      {kind === "regression" ? (
        <>
          <text x="23" y="28" className="preview-hand" fill="#008d61">
            Finding the best fit
          </text>
          <path d="M43 50v87h215" stroke="#8c98a3" fill="none" />
          <path
            d="m56 128 177-65"
            stroke="#1682f4"
            strokeWidth="2.5"
            fill="none"
          />
          {[
            [65, 113],
            [90, 120],
            [112, 97],
            [137, 105],
            [159, 83],
            [190, 91],
            [218, 61],
            [238, 72],
          ].map(([x, y]) => (
            <circle key={x} cx={x} cy={y} r="4" fill="#1582f4" />
          ))}
          <text x="174" y="154" className="preview-hand" fontSize="16">
            ŷ = mx + b
          </text>
        </>
      ) : kind === "geometry" ? (
        <>
          <text x="49" y="27" className="preview-hand">
            The Pythagorean theorem
          </text>
          <path
            d="M72 125V47l135 78Z"
            fill="#e5f2ff"
            stroke="#3388dc"
            strokeWidth="2"
          />
          <path d="M72 111h14v14" stroke="#8796a4" fill="none" />
          <text x="51" y="91" className="preview-hand">
            a
          </text>
          <text x="133" y="143" className="preview-hand">
            b
          </text>
          <text x="148" y="78" className="preview-hand" fill="#1682f4">
            c
          </text>
          <text x="94" y="164" className="preview-hand">
            a² + b² = c²
          </text>
        </>
      ) : kind === "python" ? (
        <>
          <rect
            x="24"
            y="30"
            width="252"
            height="113"
            rx="9"
            fill="#fff"
            stroke="#dce2e8"
          />
          <circle cx="39" cy="43" r="3" fill="#f1a1a4" />
          <circle cx="49" cy="43" r="3" fill="#e8c568" />
          <circle cx="59" cy="43" r="3" fill="#81c6a1" />
          <text
            x="40"
            y="72"
            fontFamily="monospace"
            fontSize="13"
            fill="#8247bd"
          >
            for <tspan fill="#263b4f">i </tspan>in{" "}
            <tspan fill="#247fbe">range(3):</tspan>
          </text>
          <text
            x="58"
            y="94"
            fontFamily="monospace"
            fontSize="13"
            fill="#263b4f"
          >
            print(i)
          </text>
          <text
            x="40"
            y="124"
            fontFamily="monospace"
            fontSize="12"
            fill="#16906a"
          >
            → 0 1 2
          </text>
        </>
      ) : (
        <>
          <text x="53" y="27" className="preview-hand">
            Energy is everywhere
          </text>
          <path d="M27 105h246" stroke="#a6b8c6" />
          <path
            d="M29 105c16-74 34-74 51 0s34 74 51 0 34-74 51 0 34 74 51 0 25-55 38-32"
            fill="none"
            stroke="#1582f4"
            strokeWidth="2.5"
          />
          <path
            d="M81 50h102m-102 0 6-4m-6 4 6 4m96-4-6-4m6 4-6 4"
            fill="none"
            stroke="#41586b"
          />
          <text x="119" y="44" className="preview-hand">
            λ
          </text>
          <rect x="172" y="136" width="98" height="22" rx="8" fill="#e5f2ff" />
          <text x="181" y="151" fontSize="11" fill="#0475d4">
            v = frequency × λ
          </text>
        </>
      )}
    </svg>
  );
}

const examples = [
  {
    kind: "regression",
    tag: "MATHEMATICS",
    title: "Make sense of the data",
    detail: "Linear regression, one step at a time.",
    prompt:
      "Teach me linear regression from scratch with a scatter plot, a best-fit line, a prediction example and a short quiz.",
  },
  {
    kind: "geometry",
    tag: "GEOMETRY",
    title: "See why the formula works",
    detail: "Bring the Pythagorean theorem to life.",
    prompt:
      "Explain the Pythagorean theorem from basics using a triangle diagram, a worked example and a quiz.",
  },
  {
    kind: "python",
    tag: "PROGRAMMING",
    title: "Turn code into understanding",
    detail: "Python loops with practical examples.",
    prompt:
      "Teach me Python loops as a beginner using practical code examples, trace tables and a quiz.",
  },
  {
    kind: "science",
    tag: "PHYSICS",
    title: "Find your wavelength",
    detail: "Explore waves, frequency and energy.",
    prompt:
      "Teach me waves, wavelength and frequency with diagrams, numerical examples and a quiz.",
  },
];

export function Landing({
  view,
  navigate,
  begin,
  initialPrompt = "",
  initialMaterials = [],
}: {
  view: ClassroomWindow;
  navigate: (path: string) => void;
  begin: (prompt: string, materials: LessonMaterial[]) => void;
  initialPrompt?: string;
  initialMaterials?: LessonMaterial[];
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [materials, setMaterials] = useState<LessonMaterial[]>(initialMaterials);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<{ session_id: string; title: string }[]>(
    [],
  );
  const input = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const uploadController = useRef<AbortController | null>(null);
  useEffect(() => {
    try {
      setRecent(
        JSON.parse(view.localStorage.getItem("tars-recent-lessons") || "[]"),
      );
    } catch {
      /* storage optional */
    }
    return () => uploadController.current?.abort();
  }, [view]);
  const attach = async (selected: FileList | null) => {
    if (!selected?.length || uploading) {
      return;
    }
    if (materials.length + selected.length > 5) {
      setError("You can attach up to 5 study materials per lesson.");
      return;
    }
    setUploading(true);
    setError("");
    const controller = new view.AbortController();
    uploadController.current = controller;
    try {
      for (const file of Array.from(selected)) {
        const material = await uploadMaterial(view, file, controller.signal);
        setMaterials((current) => [...current, material]);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(
          err instanceof Error
            ? err.message
            : "The file could not be uploaded.",
        );
      }
    } finally {
      setUploading(false);
      if (files.current) {
        files.current.value = "";
      }
    }
  };
  return (
    <div className="tars-home">
      <header className="tars-nav">
        <a
          href="/"
          onClick={(event) => {
            event.preventDefault();
            navigate("/");
          }}
          aria-label="TarsTutor home"
        >
          <TarsMark />
        </a>
        <nav aria-label="Main navigation">
          <a href="#subjects">Explore subjects</a>
          <a href="#how-it-works">How it works</a>
          <a
            href="/board"
            onClick={(event) => {
              event.preventDefault();
              navigate("/board");
            }}
          >
            Open whiteboard <span aria-hidden="true">↗</span>
          </a>
        </nav>
        <ThemeToggle view={view} />
        <span className="tars-nav-note">
          <span /> A little curiosity goes a long way
        </span>
      </header>
      <main className="tars-home-main">
        <section className="tars-hero">
          <div className="tars-eyebrow">
            <span>✧</span> YOUR NEXT AHA MOMENT STARTS HERE
          </div>
          <h1>
            Your personal AI tutor.
            <br />
            Teaching live on a{" "}
            <span>
              whiteboard
              <svg
                viewBox="0 0 450 14"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path
                  d="M3 10Q195-4 447 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            .
          </h1>
          <p>
            See every step. Hear the explanation. Ask anything.
            <br className="desktop-break" /> Make the tricky stuff click with a
            lesson built just for you.
          </p>
        </section>
        <form
          className="tars-prompt-card"
          onSubmit={(event) => {
            event.preventDefault();
            if (prompt.trim() && !uploading) {
              begin(prompt.trim(), materials);
            }
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void attach(event.dataTransfer.files);
          }}
        >
          <label className="tars-sr" htmlFor="learning-prompt">
            What would you like to learn today?
          </label>
          <textarea
            ref={input}
            id="learning-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            maxLength={4000}
            placeholder="What would you like to learn today?"
            required
          />
          <div className="tars-attachments">
            {materials.map((material, index) => (
              <span key={`${material.name}-${index}`}>
                <Paperclip />
                {material.name}
                <button
                  type="button"
                  aria-label={`Remove ${material.name}`}
                  onClick={() =>
                    setMaterials((items) => items.filter((_, i) => i !== index))
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="tars-prompt-actions">
            <input
              ref={files}
              className="tars-sr"
              type="file"
              multiple
              accept={ACCEPT}
              aria-label="Attach study materials"
              onChange={(event) => void attach(event.target.files)}
            />
            <button
              className="tars-attach"
              type="button"
              disabled={uploading}
              onClick={() => files.current?.click()}
            >
              <Paperclip />
              {uploading ? "Reading your materials…" : "Add files or images"}
            </button>
            <span className="tars-prompt-hint">Your curiosity. Your pace.</span>
            <button
              className="tars-primary"
              type="submit"
              disabled={!prompt.trim() || uploading}
            >
              Start lesson <span aria-hidden="true">↗</span>
            </button>
          </div>
          {error && (
            <div role="alert" className="tars-error">
              {error}
            </div>
          )}
        </form>
        <div className="tars-try">
          <span>Need a spark?</span>
          {[
            "Explain linear regression",
            "Teach me Python loops",
            "How does photosynthesis work?",
          ].map((text) => (
            <button
              key={text}
              onClick={() => {
                setPrompt(text);
                input.current?.focus();
              }}
            >
              {text} <span>↗</span>
            </button>
          ))}
        </div>
        <section className="tars-explore" id="subjects">
          <div className="tars-section-heading">
            <div>
              <span className="tars-kicker">
                LESS COMPLEXITY. MORE CLARITY.
              </span>
              <h2>A whole world of “I get it.”</h2>
            </div>
            <span>One whiteboard. Endless possibilities.</span>
          </div>
          <div className="tars-preview-grid">
            {examples.map((example) => (
              <button
                className="tars-topic-card"
                key={example.kind}
                onClick={() => {
                  setPrompt(example.prompt);
                  input.current?.focus();
                  input.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                  });
                }}
              >
                <div className={`tars-topic-art tars-topic-${example.kind}`}>
                  <LessonPreview kind={example.kind} />
                  <span className="tars-topic-open">↗</span>
                </div>
                <div className="tars-topic-copy">
                  <span>{example.tag}</span>
                  <h3>{example.title}</h3>
                  <p>{example.detail}</p>
                </div>
              </button>
            ))}
          </div>
        </section>
        {recent.length > 0 && (
          <section className="tars-recent">
            <h2>Pick up where you left off</h2>
            <div>
              {recent.map((item) => (
                <button
                  key={item.session_id}
                  onClick={() => navigate(`/lesson/${item.session_id}`)}
                >
                  <span>▤</span>
                  {item.title}
                  <span>Continue ↗</span>
                </button>
              ))}
            </div>
          </section>
        )}
        <section className="tars-how" id="how-it-works">
          <div>
            <span className="tars-kicker">LEARNING, MADE PERSONAL</span>
            <h2>
              From a question
              <br />
              to a little more confidence.
            </h2>
            <p>
              Bring a topic, your notes, or that one thing that just won’t
              click. We’ll work through it together.
            </p>
          </div>
          <ol>
            <li>
              <span>01</span>
              <div>
                <h3>Follow your curiosity</h3>
                <p>Tell your tutor what you want to learn, at any level.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Watch it come together</h3>
                <p>
                  Follow a spoken lesson as examples unfold on your whiteboard.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Make it your own</h3>
                <p>
                  Ask questions, pause for thought, and try a little practice.
                </p>
              </div>
            </li>
          </ol>
        </section>
      </main>
      <footer className="tars-footer">
        <TarsMark small />
        <span>A space to ask. A way to understand.</span>
        <span>Made for curious minds.</span>
      </footer>
    </div>
  );
}

export function Generating({
  view,
  snapshot,
  error,
  prompt,
  retry,
  cancel,
  navigate,
}: {
  view: ClassroomWindow;
  snapshot: LessonSnapshot | null;
  error: string;
  prompt: string;
  retry: () => void;
  cancel: () => void;
  navigate: (path: string) => void;
}) {
  const activeStages = snapshot?.stages?.length
    ? snapshot.stages
    : stages.map((label, index) => ({
        id: String(index),
        label,
        status: index === 0 ? "active" : "pending",
      }));
  const completed = activeStages.filter(
    (stage) => stage.status === "completed",
  ).length;
  const failure =
    error ||
    snapshot?.error ||
    (snapshot?.status === "cancelled"
      ? "Lesson preparation was cancelled. You can continue preparing it whenever you’re ready."
      : "");
  return (
    <div className="tars-generation">
      <div className="tars-generation-theme">
        <ThemeToggle view={view} />
      </div>
      <aside className="tars-generation-nav">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          <TarsMark />
        </a>
        <nav>
          <button onClick={() => navigate("/")}>
            ⌂ <span>Home</span>
          </button>
          <button className="active">
            ▤ <span>AI Whiteboard</span>
          </button>
          <button onClick={() => navigate("/board")}>
            ✎ <span>Freeform board</span>
          </button>
        </nav>
        <div className="tars-sidebar-note">
          <span>✧</span>
          <h3>Understanding takes a moment.</h3>
          <p>Your tutor is connecting the dots, so you can too.</p>
        </div>
        <div className="tars-sidebar-bottom">
          <span className="tars-user-icon">Y</span>Your learning space
        </div>
      </aside>
      <main>
        <button className="tars-back" onClick={() => navigate("/")}>
          ‹ &nbsp; Back to home
        </button>
        <section className="tars-generation-card">
          <div className="tars-generation-art">
            <span className="tars-art-label">
              A LESSON THAT’S UNIQUELY YOURS
            </span>
            <div className="tars-floating-paper">
              <LessonPreview kind="geometry" />
              <div className="tars-preview-caption">
                Small steps. Big understanding.
              </div>
            </div>
            <div className="tars-generation-art-copy">
              <span className="tars-art-spark">✧</span>
              <h2>Your very own whiteboard.</h2>
              <p>Learn as your tutor brings ideas to life.</p>
            </div>
            <span className="tars-art-dot one" />
            <span className="tars-art-dot two" />
          </div>
          <div className="tars-generation-progress">
            <span className="tars-kicker">LET’S MAKE IT CLICK</span>
            <div className="tars-generation-title">
              <h1>
                {failure ? "Let’s try that again." : "Creating your lesson…"}
              </h1>
              <span>
                {completed}/{activeStages.length}
              </span>
            </div>
            <progress
              max={activeStages.length}
              value={completed}
              aria-label="Completed lesson preparation stages"
            />
            <p className="tars-generation-topic">
              “{snapshot?.prompt || prompt || "Your personalized lesson"}”
            </p>
            <ol aria-live="polite">
              {activeStages.map((stage) => (
                <li key={stage.id} className={`stage-${stage.status}`}>
                  <span className="tars-stage-indicator" aria-hidden="true">
                    {stage.status === "completed"
                      ? "✓"
                      : stage.status === "failed"
                      ? "!"
                      : ""}
                  </span>
                  {stage.label}
                </li>
              ))}
            </ol>
            {failure ? (
              <div className="tars-generation-error" role="alert">
                <p>{failure}</p>
                <button className="tars-primary" onClick={retry}>
                  Retry lesson ↻
                </button>
              </div>
            ) : (
              <div className="tars-generation-foot">
                <span>
                  We’ll open your lesson as soon as the first part is ready.
                </span>
                <button onClick={cancel}>Cancel preparation</button>
              </div>
            )}
          </div>
        </section>
        <p className="tars-generation-tip">
          Made around your topic. Taught at your pace.
        </p>
      </main>
    </div>
  );
}

type Draft = {
  session_id: string;
  prompt: string;
  materials: LessonMaterial[];
};

export default function TarsApp({ view }: { view: ClassroomWindow }) {
  useTutorTheme(view);
  const [path, setPath] = useState(view.location.pathname);
  const [hash, setHash] = useState(view.location.hash);
  const [snapshot, setSnapshot] = useState<LessonSnapshot | null>(null);
  const [error, setError] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);
  const draft = useRef<Draft | null>(null);
  const submitted = useRef(new Set<string>());
  const navigate = useCallback(
    (next: string) => {
      if (next === "/") {
        draft.current = null;
      }
      view.history.pushState({}, "", next);
      setPath(next);
      setHash(view.location.hash);
    },
    [view],
  );
  useEffect(() => {
    const pop = () => {
      setPath(view.location.pathname);
      setHash(view.location.hash);
    };
    view.addEventListener("popstate", pop);
    view.addEventListener("hashchange", pop);
    return () => {
      view.removeEventListener("popstate", pop);
      view.removeEventListener("hashchange", pop);
    };
  }, [view]);
  useEffect(() => {
    view.document.title =
      snapshot?.title && path.startsWith("/lesson/")
        ? `${snapshot.title} — TarsTutor`
        : "TarsTutor — Your Personal AI Whiteboard Tutor";
  }, [path, snapshot?.title, view]);
  const match = path.match(
    /^\/lesson\/(?:generating\/)?([A-Za-z0-9_-]{1,100})\/?$/,
  );
  const sessionId = match?.[1];
  const isGenerating = path.startsWith("/lesson/generating/");
  useEffect(() => {
    if (!sessionId) {
      return;
    }
    let alive = true;
    let timer = 0;
    const controller = new view.AbortController();
    setError("");
    setSnapshot((current) =>
      current?.session_id === sessionId ? current : null,
    );
    const poll = async () => {
      try {
        let result: LessonSnapshot;
        if (
          draft.current?.session_id === sessionId &&
          !submitted.current.has(sessionId)
        ) {
          submitted.current.add(sessionId);
          try {
            result = await lessonRequest<LessonSnapshot>(
              view,
              "lessons",
              draft.current,
              controller.signal,
            );
          } catch (err) {
            submitted.current.delete(sessionId);
            throw err;
          }
        } else {
          try {
            result = await lessonRequest<LessonSnapshot>(
              view,
              `lessons/${sessionId}`,
              undefined,
              controller.signal,
            );
          } catch (err) {
            if (err instanceof LessonAPIError && err.status === 404) {
              let saved: Draft | null = null;
              try {
                saved = JSON.parse(
                  view.sessionStorage.getItem(`tars-draft-${sessionId}`) ||
                    "null",
                );
              } catch {
                /* unavailable */
              }
              if (saved?.session_id === sessionId) {
                result = await lessonRequest<LessonSnapshot>(
                  view,
                  "lessons",
                  saved,
                  controller.signal,
                );
              } else {
                throw new Error(
                  "This lesson could not be found. Return home to start a new lesson.",
                );
              }
            } else {
              throw err;
            }
          }
        }
        if (!alive) {
          return;
        }
        setSnapshot(result);
        setError("");
        if (result.segments.length) {
          try {
            const recent = JSON.parse(
              view.localStorage.getItem("tars-recent-lessons") || "[]",
            ) as { session_id: string; title: string }[];
            view.localStorage.setItem(
              "tars-recent-lessons",
              JSON.stringify(
                [
                  { session_id: sessionId, title: result.title },
                  ...recent.filter((item) => item.session_id !== sessionId),
                ].slice(0, 6),
              ),
            );
            view.sessionStorage.removeItem(`tars-draft-${sessionId}`);
          } catch {
            /* optional persistence */
          }
          if (isGenerating) {
            navigate(`/lesson/${sessionId}`);
            return;
          }
        }
        if (result.generating) {
          timer = view.setTimeout(() => void poll(), 1500);
        }
      } catch (err) {
        if (alive && !controller.signal.aborted) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to prepare your lesson.",
          );
        }
      }
    };
    void poll();
    return () => {
      alive = false;
      controller.abort();
      view.clearTimeout(timer);
    };
  }, [sessionId, isGenerating, refreshCount, view, navigate]);
  const begin = (prompt: string, materials: LessonMaterial[]) => {
    const session_id = view.crypto.randomUUID();
    draft.current = { session_id, prompt, materials };
    try {
      view.sessionStorage.setItem(
        `tars-draft-${session_id}`,
        JSON.stringify(draft.current),
      );
    } catch {
      /* uploads may exceed browser storage; in-memory draft still works */
    }
    setSnapshot(null);
    setError("");
    navigate(`/lesson/generating/${session_id}`);
  };
  const retry = async () => {
    if (!sessionId) {
      return;
    }
    setError("");
    if (snapshot?.status === "failed" || snapshot?.status === "cancelled") {
      try {
        setSnapshot(
          await lessonRequest<LessonSnapshot>(
            view,
            `lessons/${sessionId}/retry`,
            {},
          ),
        );
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not retry lesson.",
        );
        return;
      }
    }
    setRefreshCount((count) => count + 1);
  };
  const cancel = async () => {
    if (!sessionId) {
      return;
    }
    try {
      setSnapshot(
        await lessonRequest<LessonSnapshot>(
          view,
          `lessons/${sessionId}/cancel`,
          {},
        ),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not cancel preparation.",
      );
    }
  };
  if (import.meta.env.DEV && path === "/__video") {
    return <Suspense fallback={<div className="tars-route-loading">Preparing product screen…</div>}><ProductDemo view={view} /></Suspense>;
  }
  if (
    path === "/board" ||
    path.startsWith("/board/") ||
    path === "/excalidraw-plus-export" ||
    path === "/web-share-target" ||
    (path === "/" &&
      (/^#(?:room|json|url|addLibrary)=/.test(hash) ||
        new view.URLSearchParams(view.location.search).has("id") ||
        new view.URLSearchParams(view.location.search).has("addLibrary")))
  ) {
    return (
      <Suspense
        fallback={
          <div className="tars-route-loading">Opening your whiteboard…</div>
        }
      >
        <OriginalBoard />
      </Suspense>
    );
  }
  if (sessionId) {
    if (
      !isGenerating &&
      snapshot?.session_id === sessionId &&
      snapshot.segments.length
    ) {
      return (
        <Suspense
          fallback={
            <div className="tars-route-loading">Opening your classroom…</div>
          }
        >
          <Classroom
            snapshot={{ ...snapshot, error: error || snapshot.error }}
            autoplay={draft.current?.session_id === sessionId}
            view={view}
            onNavigate={navigate}
            refresh={() => setRefreshCount((count) => count + 1)}
          />
        </Suspense>
      );
    }
    return (
      <Generating
        view={view}
        snapshot={snapshot}
        error={error}
        prompt={draft.current?.prompt || ""}
        retry={() => void retry()}
        cancel={() => void cancel()}
        navigate={navigate}
      />
    );
  }
  if (path !== "/") {
    return (
      <div className="tars-route-loading">
        <TarsMark />
        <h1>This page isn’t on the board.</h1>
        <button className="tars-primary" onClick={() => navigate("/")}>
          Back to learning
        </button>
      </div>
    );
  }
  return <Landing view={view} navigate={navigate} begin={begin} />;
}

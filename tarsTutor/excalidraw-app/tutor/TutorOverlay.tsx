import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { getCommonBounds } from "@excalidraw/element";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { Theme } from "@excalidraw/element/types";

import { showGeneratedLesson, showSampleLesson } from "./boardController";
import { playGeneratedLesson, WRITING_SPEEDS } from "./lessonPlayback";

import { useLLM } from "./llm";
import { getBoardContext } from "./context";

import type { LessonPlayback } from "./lessonPlayback";
import type { CSSProperties } from "react";

import type { TutorResponse } from "../../shared/agent";

const iconPaths = {
  chat: "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 1v-9.5A8.5 8.5 0 0 1 11.5 3h1a8.5 8.5 0 0 1 8.5 8.5ZM8 9h8m-8 5h5",
  pause: "M9 5v14M15 5v14",
  play: "m9 5 10 7-10 7V5Z",
  stop: "M8 8h8v8H8z",
  close: "m6 6 12 12M6 18 18 6",
  focus:
    "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  arrow: "M12 19V5m-6 6 6-6 6 6",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z",
  speed: "m13 2-9 11h7l-1 9 10-12h-7l0-8Z",
};

const TutorIcon = ({ name }: { name: keyof typeof iconPaths }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.65"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={iconPaths[name]} />
  </svg>
);

const TypedReply = ({
  text,
  active,
  paused,
  speed,
}: {
  text: string;
  active: boolean;
  paused: boolean;
  speed: number;
}) => {
  const characters = useMemo(() => Array.from(text), [text]);
  const [visible, setVisible] = useState(active ? 0 : characters.length);
  const complete = visible >= characters.length;
  const node = useRef<HTMLSpanElement>(null);
  const wasActive = useRef(active);

  useLayoutEffect(() => {
    if (active && !wasActive.current) {
      setVisible(0);
    }
    wasActive.current = active;
  }, [active]);

  useEffect(() => {
    if (!active) {
      setVisible(characters.length);
      return;
    }
    if (paused || complete) {
      return;
    }
    const view = node.current?.ownerDocument.defaultView;
    if (!view) {
      setVisible(characters.length);
      return;
    }
    if (view.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setVisible(characters.length);
      return;
    }
    let lastTick = view.performance.now();
    let timeCredit = 0;
    const timer = view.setInterval(() => {
      const now = view.performance.now();
      timeCredit += Math.min(now - lastTick, 200);
      lastTick = now;
      setVisible((previous) => {
        let next = previous;
        while (next < characters.length) {
          const prior = characters[next - 1] || "";
          const cost =
            1000 / WRITING_SPEEDS[speed].charactersPerSecond +
            (/[.!?]/.test(prior) ? 105 : /[,;:]/.test(prior) ? 55 : 0);
          if (timeCredit < cost) {
            break;
          }
          timeCredit -= cost;
          next++;
        }
        return next;
      });
    }, 40);
    return () => view.clearInterval(timer);
  }, [active, paused, speed, characters, complete]);

  return (
    <>
      <span className="tutor-sr-only">{text}</span>
      <span ref={node} aria-hidden="true">
        {characters.slice(0, visible).join("")}
      </span>
    </>
  );
};

type TutorOverlayProps = {
  excalidrawAPI: ExcalidrawImperativeAPI;
  theme: Theme;
  autoLoadDemo: boolean;
};

export const TutorOverlay = ({
  excalidrawAPI,
  theme,
  autoLoadDemo,
}: TutorOverlayProps) => {
  const [draft, setDraft] = useState("");
  const [conversationOpen, setConversationOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [ended, setEnded] = useState(false);
  const [following, setFollowing] = useState(true);
  const [notice, setNotice] = useState("");
  const [writingSpeed, setWritingSpeed] = useState(2);
  const [liveTurnId, setLiveTurnId] = useState<string | null>(null);
  const playback = useRef<LessonPlayback | null>(null);
  const conversationButton = useRef<HTMLButtonElement>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const {
    turns,
    isLoading,
    isRestoring,
    sessionError,
    activeQuestion,
    submit,
    retry,
    cancel,
    reset,
  } = useLLM(composerInput);
  const [answer, setAnswer] = useState("");
  const disabled =
    isLoading || isRestoring || paused || ended || !!sessionError;
  const conversationEnd = useRef<HTMLDivElement>(null);
  const lastFocusedStep = useRef("");
  const conversationId = useId();
  const conversationTitleId = useId();
  const inputId = useId();
  const hintId = useId();
  const demoInitialized = useRef(false);

  useEffect(() => {
    const view = composerInput.current?.ownerDocument.defaultView;
    try {
      const stored = view?.localStorage.getItem("tars-writing-speed");
      const saved = Number(stored);
      if (
        stored !== null &&
        stored !== undefined &&
        Number.isInteger(saved) &&
        saved >= 0 &&
        saved < WRITING_SPEEDS.length
      ) {
        setWritingSpeed(saved);
      }
    } catch {
      // The control still works when storage is unavailable.
    }
    return () => playback.current?.finish();
  }, []);

  useEffect(() => {
    playback.current?.setSpeed(writingSpeed);
  }, [writingSpeed]);

  useEffect(() => {
    playback.current?.setPaused(paused);
  }, [paused]);

  useEffect(() => {
    if (!autoLoadDemo || demoInitialized.current) {
      return;
    }
    const initialize = () => {
      if (excalidrawAPI.getAppState().isLoading || demoInitialized.current) {
        return;
      }
      demoInitialized.current = true;
      if (!excalidrawAPI.getSceneElements().length) {
        showSampleLesson(excalidrawAPI);
      }
    };
    const unsubscribe = excalidrawAPI.onChange(initialize);
    initialize();
    return unsubscribe;
  }, [autoLoadDemo, excalidrawAPI]);

  useEffect(() => {
    const input = composerInput.current;
    if (input) {
      input.style.height = "24px";
      input.style.height = `${Math.min(input.scrollHeight, 104)}px`;
    }
  }, [draft]);

  useEffect(() => {
    if (conversationOpen) {
      conversationEnd.current?.scrollIntoView?.({ block: "nearest" });
    }
  }, [conversationOpen, turns, isLoading]);

  useEffect(() => {
    if (!following || paused || ended) {
      lastFocusedStep.current = "";
      return;
    }

    // Each response arrives as a complete lesson. Fit all its content together.
    const focusTutor = () => {
      const elements = excalidrawAPI
        .getSceneElements()
        .filter((element) => element.customData?.source === "tars-tutor");
      if (!elements.length) {
        return;
      }
      const lessonId = elements[elements.length - 1].customData?.lessonId;
      const currentLesson = elements.filter(
        (element) => element.customData?.lessonId === lessonId,
      );
      const version = `${lessonId}:${conversationOpen}`;
      if (version !== lastFocusedStep.current) {
        lastFocusedStep.current = version;
        excalidrawAPI.setViewport({
          target: getCommonBounds(currentLesson),
          fit: "scale-down",
          animation: true,
          offsets: {
            ui: true,
            top: 100,
            bottom: 200,
            left: 24,
            right:
              conversationOpen && excalidrawAPI.getAppState().width >= 900
                ? 400
                : 24,
          },
        });
      }
    };

    focusTutor();
    return excalidrawAPI.onChange(focusTutor);
  }, [excalidrawAPI, following, paused, ended, conversationOpen]);

  const closeConversation = () => {
    setConversationOpen(false);
    conversationButton.current?.focus();
  };

  const showResponse = (response: TutorResponse | null) => {
    if (!response) {
      return;
    }
    setLiveTurnId(response.turn_id);
    if (response.lesson) {
      playback.current?.finish();
      const view = composerInput.current?.ownerDocument.defaultView;
      if (view) {
        if (following) {
          lastFocusedStep.current = `${response.lesson.lessonId}:true`;
        }
        playback.current = playGeneratedLesson(
          excalidrawAPI,
          response.lesson,
          view,
          writingSpeed,
          following,
          () => {},
        );
        playback.current.setPaused(paused || ended);
      } else {
        showGeneratedLesson(excalidrawAPI, response.lesson, following);
      }
    }
    setConversationOpen(true);
  };

  const answerQuestion = async (value: string, ownerDocument: Document) => {
    if (disabled || !activeQuestion || !value.trim()) {
      return;
    }
    const response = await submit(value, ownerDocument, {
      questionId: activeQuestion.id,
      context: getBoardContext(excalidrawAPI),
    });
    if (response) {
      setAnswer("");
    }
    showResponse(response);
  };

  return (
    <div
      className="tutor-overlay"
      data-theme={theme}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && conversationOpen) {
          event.preventDefault();
          closeConversation();
        }
      }}
      onWheel={(event) => event.stopPropagation()}
    >
      <header className="tutor-header">
        <div className="tutor-brand" aria-label="TarsTutor whiteboard">
          <span className="tutor-brand__mark" aria-hidden="true">
            <TutorIcon name="spark" />
          </span>
          <span>
            Tars<span className="tutor-brand__light">Tutor</span>
          </span>
        </div>
        <div className="tutor-writing-speed">
          <TutorIcon name="speed" />
          <div className="tutor-writing-speed__body">
            <div className="tutor-writing-speed__labels">
              <label htmlFor="tutor-writing-speed">Writing speed</label>
              <strong>{WRITING_SPEEDS[writingSpeed].label}</strong>
            </div>
            <input
              id="tutor-writing-speed"
              type="range"
              min="0"
              max={WRITING_SPEEDS.length - 1}
              step="1"
              value={writingSpeed}
              aria-label="Writing speed"
              aria-valuetext={WRITING_SPEEDS[writingSpeed].label}
              style={
                {
                  "--speed-progress": `${
                    (writingSpeed / (WRITING_SPEEDS.length - 1)) * 100
                  }%`,
                } as CSSProperties
              }
              onChange={(event) => {
                const next = Number(event.target.value);
                setWritingSpeed(next);
                try {
                  event.currentTarget.ownerDocument.defaultView?.localStorage.setItem(
                    "tars-writing-speed",
                    String(next),
                  );
                } catch {
                  // Keep the in-memory setting.
                }
              }}
            />
          </div>
        </div>
        <nav className="tutor-session-controls" aria-label="Lesson controls">
          <button
            ref={conversationButton}
            type="button"
            className="tutor-control tutor-chat"
            aria-label="Conversation"
            title="Conversation"
            aria-expanded={conversationOpen}
            aria-controls={conversationId}
            onClick={() => setConversationOpen((open) => !open)}
          >
            <TutorIcon name="chat" />
            <span className="tutor-control__label">Conversation</span>
            {turns.length > 0 && (
              <span className="tutor-count">{turns.length}</span>
            )}
          </button>
          {!ended && (
            <button
              type="button"
              className="tutor-control tutor-pause"
              aria-label={paused ? "Resume lesson" : "Pause lesson"}
              title={paused ? "Resume lesson" : "Pause lesson"}
              aria-pressed={paused}
              onClick={() => {
                setPaused((value) => !value);
                cancel();
                setNotice("");
              }}
            >
              <TutorIcon name={paused ? "play" : "pause"} />
            </button>
          )}
          <span className="tutor-controls-divider" aria-hidden="true" />
          <button
            type="button"
            className="tutor-control tutor-end"
            aria-label={ended ? "Reopen lesson" : "End lesson"}
            title={ended ? "Reopen lesson" : "End lesson"}
            onClick={() => {
              setEnded((value) => !value);
              cancel();
              playback.current?.finish();
              setPaused(false);
              setFollowing(false);
              setNotice("");
            }}
          >
            <TutorIcon name={ended ? "play" : "stop"} />
            <span>{ended ? "Reopen" : "End lesson"}</span>
          </button>
        </nav>
      </header>

      {conversationOpen && (
        <section
          id={conversationId}
          className="tutor-conversation"
          aria-labelledby={conversationTitleId}
        >
          <div className="tutor-conversation__header">
            <div className="tutor-conversation__title">
              <span className="tutor-conversation__symbol">
                <TutorIcon name="chat" />
              </span>
              <div>
                <h2 id={conversationTitleId}>Conversation</h2>
                <p>Your space to ask why.</p>
              </div>
            </div>
            <button
              type="button"
              className="tutor-control tutor-close"
              aria-label="Close conversation"
              title="Close conversation"
              onClick={closeConversation}
            >
              <TutorIcon name="close" />
            </button>
          </div>
          <div className="tutor-conversation__messages">
            {turns.length === 0 ? (
              <div className="tutor-empty">
                <div className="tutor-empty__icon">
                  <TutorIcon name="spark" />
                </div>
                <h3>It starts with a question.</h3>
                <p>
                  Ask your tutor to explain a concept. Its reply will appear
                  here and as an editable lesson on your board.
                </p>
              </div>
            ) : (
              <ol aria-label="Lesson conversation" aria-live="polite">
                {turns.map((turn, index) => (
                  <li key={turn.id} className="tutor-question">
                    <span className="tutor-question__author">
                      You
                      <span className="tutor-question__number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                    </span>
                    <p>{turn.prompt}</p>
                    {turn.response && (
                      <div className="tutor-llm-reply">
                        <span className="tutor-llm-reply__label">
                          Tutor · {turn.response.model}
                        </span>
                        <p>
                          <TypedReply
                            text={turn.response.reply}
                            active={turn.id === liveTurnId && !ended}
                            paused={paused}
                            speed={writingSpeed}
                          />
                        </p>
                        {turn.response.feedback && (
                          <p className="tutor-feedback" role="status">
                            {turn.response.feedback.correct === true
                              ? "Correct"
                              : turn.response.feedback.correct === false
                              ? "Try again"
                              : "Check answer format"}
                            : {turn.response.feedback.message}
                          </p>
                        )}
                        {turn.response.lesson && (
                          <button
                            type="button"
                            className="tutor-llm-board"
                            onClick={() => {
                              playback.current?.finish();
                              setFollowing(false);
                              setConversationOpen(false);
                              showGeneratedLesson(
                                excalidrawAPI,
                                turn.response!.lesson!,
                              );
                            }}
                          >
                            View lesson on board
                          </button>
                        )}
                      </div>
                    )}
                    {turn.error && (
                      <div className="tutor-llm-error" role="alert">
                        {turn.error}
                        <button
                          type="button"
                          className="tutor-llm-board"
                          disabled={disabled}
                          onClick={async (event) => {
                            showResponse(
                              await retry(
                                turn,
                                event.currentTarget.ownerDocument,
                              ),
                            );
                          }}
                        >
                          Retry request
                        </button>
                      </div>
                    )}
                    {!turn.response && !turn.error && isLoading && (
                      <div className="tutor-llm-pending" role="status">
                        Your tutor is preparing a response. This may take a
                        minute.
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {sessionError && (
              <div className="tutor-llm-error" role="alert">
                {sessionError}
              </div>
            )}
            {activeQuestion && (
              <section
                className="tutor-practice"
                aria-label="Practice question"
              >
                <h3>Quick check</h3>
                <p>{activeQuestion.prompt}</p>
                {activeQuestion.kind === "choice" ? (
                  activeQuestion.choices.map((choice, index) => (
                    <button
                      key={index}
                      type="button"
                      className="tutor-llm-board"
                      disabled={disabled}
                      onClick={(event) => {
                        void answerQuestion(
                          String(index),
                          event.currentTarget.ownerDocument,
                        );
                      }}
                    >
                      {choice}
                    </button>
                  ))
                ) : (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void answerQuestion(
                        answer,
                        event.currentTarget.ownerDocument,
                      );
                    }}
                  >
                    <label htmlFor={`${inputId}-answer`}>Your answer</label>
                    <input
                      id={`${inputId}-answer`}
                      inputMode="decimal"
                      value={answer}
                      onChange={(event) => setAnswer(event.target.value)}
                      disabled={disabled}
                      maxLength={100}
                    />
                    <button
                      type="submit"
                      className="tutor-llm-board"
                      disabled={disabled || !answer.trim()}
                    >
                      Check answer
                    </button>
                  </form>
                )}
              </section>
            )}
            <div ref={conversationEnd} />
          </div>
          <div className="tutor-conversation__footer">
            <span className="tutor-status-dot" aria-hidden="true" />
            <span>
              {isRestoring
                ? "Restoring conversation…"
                : "Your tutor remembers this conversation."}
            </span>
            <button
              type="button"
              className="tutor-llm-board"
              disabled={isLoading || isRestoring}
              onClick={() => {
                reset();
                setLiveTurnId(null);
                setAnswer("");
                setNotice(
                  "New conversation started. Your drawings are still on the board.",
                );
              }}
            >
              New conversation
            </button>
          </div>
        </section>
      )}

      <div className="tutor-dock">
        <nav className="tutor-sample-nav" aria-label="Sample lesson">
          <button
            type="button"
            className="tutor-sample-nav__title"
            onClick={() => {
              setFollowing(false);
              showSampleLesson(excalidrawAPI, "all");
            }}
            title="Load or fit the sample lesson"
          >
            <TutorIcon name="spark" />
            <span>Logistic regression</span>
            <span className="tutor-sample-nav__badge">Demo</span>
          </button>
          <span className="tutor-controls-divider" aria-hidden="true" />
          {[
            ["idea", "The idea"],
            ["curve", "The sigmoid curve"],
            ["practice", "Worked example"],
          ].map(([id, label], index) => (
            <button
              key={id}
              type="button"
              className="tutor-control"
              aria-label={`View ${label.toLowerCase()}`}
              title={label}
              onClick={() => {
                setFollowing(false);
                showSampleLesson(excalidrawAPI, id);
              }}
            >
              {index + 1}
            </button>
          ))}
        </nav>
        <div className="tutor-dock__status" role="status">
          {(ended || paused || notice || isLoading) && (
            <span className="tutor-status-pill">
              <span
                className="tutor-status-dot"
                data-inactive={paused || ended}
              />
              {ended
                ? "Lesson ended. Your board is saved."
                : paused
                ? "Paused. Take your time."
                : isLoading
                ? "Your tutor is preparing a response…"
                : notice}
            </span>
          )}
        </div>
        <div className="tutor-dock__row">
          <button
            type="button"
            className="tutor-follow"
            aria-label="Follow tutor"
            title="Follow tutor"
            aria-pressed={following}
            disabled={paused || ended}
            onClick={() => {
              setFollowing((value) => !value);
              setNotice(following ? "" : "Following new tutor writing");
            }}
          >
            <TutorIcon name="focus" />
            <span>Follow tutor</span>
          </button>
          <form
            className="tutor-composer"
            aria-label="Ask your tutor"
            onSubmit={async (event) => {
              event.preventDefault();
              const question = draft.trim();
              if (!question || disabled) {
                return;
              }
              const ownerDocument = event.currentTarget.ownerDocument;
              setDraft("");
              setConversationOpen(true);
              setNotice("");
              showResponse(
                await submit(question, ownerDocument, {
                  context: getBoardContext(excalidrawAPI),
                }),
              );
            }}
          >
            <span className="tutor-composer__spark" aria-hidden="true">
              <TutorIcon name="spark" />
            </span>
            <label className="tutor-sr-only" htmlFor={inputId}>
              Your question
            </label>
            <textarea
              ref={composerInput}
              id={inputId}
              value={draft}
              rows={1}
              maxLength={4000}
              disabled={disabled}
              placeholder={
                ended
                  ? "Reopen the lesson to keep exploring"
                  : paused
                  ? "Ready when you are..."
                  : "Ask a question, explore an idea..."
              }
              aria-describedby={hintId}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button
              type="submit"
              className="tutor-send"
              aria-label="Send to tutor"
              title="Generate lesson"
              disabled={!draft.trim() || disabled}
            >
              <TutorIcon name="arrow" />
            </button>
          </form>
        </div>
        <div id={hintId} className="tutor-input-hint">
          <button
            type="button"
            className="tutor-review"
            disabled={disabled}
            onClick={async (event) => {
              const context = getBoardContext(excalidrawAPI);
              if (!context.selected_text.trim()) {
                setNotice(
                  "Select text on the board, then choose Review selected work.",
                );
                return;
              }
              setConversationOpen(true);
              showResponse(
                await submit(
                  "Review my selected work and explain any mistakes.",
                  event.currentTarget.ownerDocument,
                  { action: "review_work", context },
                ),
              );
            }}
          >
            Review selected work
          </button>
          <span className="tutor-input-hint__keyboard">
            Shift + Enter for a new line
          </span>
        </div>
      </div>
    </div>
  );
};

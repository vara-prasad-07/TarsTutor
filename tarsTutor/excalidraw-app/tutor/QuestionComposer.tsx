import { useEffect, useId, useRef } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onAsk: () => void;
  onDraw: () => void;
  onAttach: () => void;
  onRecord: () => void;
  drawing: boolean;
  uploading: boolean;
  asking: boolean;
  recording: boolean;
  startingRecording: boolean;
  transcribing: boolean;
  voiceReady: boolean | null;
  recordingSeconds: number;
};
function Glyph({
  name,
}: {
  name: "pen" | "attach" | "mic" | "send" | "stop" | "spark";
}) {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "pen" ? (
        <path d="m4 16 12-12 4 4L8 20l-5 1ZM14 6l4 4" />
      ) : name === "attach" ? (
        <path d="m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l10-10m-6 13 9-9" />
      ) : name === "mic" ? (
        <>
          <rect x="9" y="2" width="6" height="13" rx="3" />
          <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" />
        </>
      ) : name === "stop" ? (
        <rect
          x="6"
          y="6"
          width="12"
          height="12"
          rx="3"
          fill="currentColor"
          stroke="none"
        />
      ) : name === "spark" ? (
        <path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4ZM20 2v4m-2-2h4" />
      ) : (
        <path d="M12 20V4m-6 6 6-6 6 6" />
      )}
    </svg>
  );
}
export default function QuestionComposer(props: Props) {
  const { value, asking, recording, transcribing, startingRecording } = props;
  const input = useRef<HTMLTextAreaElement>(null);
  const help = useId();
  const busy = asking || startingRecording || recording || transcribing;
  const canSend = !!value.trim() && !busy;
  useEffect(() => {
    const field = input.current;
    if (field) {
      field.style.height = "auto";
      field.style.height = `${Math.min(
        104,
        Math.max(40, field.scrollHeight),
      )}px`;
    }
  }, [value]);
  return (
    <form
      className={`tc-question-form tc-composer${
        recording ? " is-recording" : ""
      }${asking || transcribing || startingRecording ? " is-busy" : ""}`}
      aria-label="Question composer"
      aria-busy={asking || transcribing || startingRecording}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) {
          props.onAsk();
        }
      }}
    >
      <textarea
        ref={input}
        rows={1}
        maxLength={4000}
        value={value}
        aria-label="Ask your tutor a question"
        aria-describedby={help}
        placeholder={
          recording
            ? "I'm listening. Click stop when you're ready…"
            : "Ask about your drawing…"
        }
        disabled={busy}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            if (canSend) {
              props.onAsk();
            }
          }
        }}
      />
      <div className="tc-composer-toolbar">
        <div className="tc-composer-tools">
          <button
            type="button"
            className={`tc-composer-tool${props.drawing ? " active" : ""}`}
            aria-label="Draw on the whiteboard"
            aria-pressed={props.drawing}
            onClick={props.onDraw}
            title="Draw on the whiteboard"
          >
            <Glyph name="pen" />
            <span>Draw</span>
          </button>
          <button
            type="button"
            className="tc-composer-tool"
            aria-label="Attach a source"
            disabled={props.uploading}
            onClick={props.onAttach}
            title="Add a file or image"
          >
            <Glyph name="attach" />
            <span>{props.uploading ? "Reading…" : "Attach"}</span>
          </button>
        </div>
        <span id={help} className="tc-sr-only">
          Enter to send <span>· Shift + Enter for a new line</span>
        </span>
        {busy && (
          <span className="tc-composer-context" aria-live="polite">
            {recording
              ? `Listening · ${props.recordingSeconds}s / 29s`
              : asking
              ? "Working on your answer"
              : transcribing
              ? "Transcribing…"
              : "Preparing microphone…"}
          </span>
        )}
        <div className="tc-composer-actions">
          <button
            type="button"
            className={`tc-mic${recording ? " recording" : ""}`}
            aria-label={recording ? "Stop recording" : "Record a question"}
            aria-pressed={recording}
            title={
              props.voiceReady === false
                ? "Speech is not configured on the backend"
                : recording
                ? "Stop recording and send your question"
                : "Ask with your voice"
            }
            disabled={
              asking ||
              startingRecording ||
              transcribing ||
              props.voiceReady === false
            }
            onClick={props.onRecord}
          >
            <Glyph name={recording ? "stop" : "mic"} />
          </button>
          <button
            type="submit"
            className="tc-composer-send"
            aria-label="Send question"
            disabled={!canSend}
          >
            {asking || transcribing || startingRecording ? (
              <i className="tc-composer-spinner" />
            ) : (
              <Glyph name="send" />
            )}
            <span className="tc-sr-only">{asking ? "Thinking" : "Send"}</span>
          </button>
        </div>
      </div>
    </form>
  );
}

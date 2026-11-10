import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import QuestionComposer from "./QuestionComposer";

afterEach(cleanup);
const ask = vi.fn();
function Composer({
  recording = false,
  asking = false,
}: {
  recording?: boolean;
  asking?: boolean;
}) {
  const [value, setValue] = useState("");
  return (
    <QuestionComposer
      value={value}
      onChange={setValue}
      onAsk={ask}
      onDraw={vi.fn()}
      onAttach={vi.fn()}
      onRecord={vi.fn()}
      drawing={false}
      uploading={false}
      asking={asking}
      recording={recording}
      startingRecording={false}
      transcribing={false}
      voiceReady={true}
      recordingSeconds={4}
    />
  );
}
describe("question composer", () => {
  it("sends with Enter while preserving multiline and IME typing", () => {
    ask.mockReset();
    render(<Composer />);
    const field = screen.getByRole("textbox", {
      name: "Ask your tutor a question",
    });
    expect(
      screen.getByRole("button", { name: "Send question" }),
    ).toBeDisabled();
    fireEvent.change(field, {
      target: { value: "Explain my drawing\nstep by step" },
    });
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(field, { key: "Enter", isComposing: true });
    expect(ask).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(field).toHaveValue("Explain my drawing\nstep by step");
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));
    expect(ask).toHaveBeenCalledTimes(2);
  });
  it("makes recording and thinking states visible and prevents competing sends", () => {
    const mounted = render(<Composer recording />);
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByText(/Listening · 4s/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Stop recording" }),
    ).toBeEnabled();
    mounted.rerender(<Composer asking />);
    expect(screen.getByText("Working on your answer")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send question" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Record a question" }),
    ).toBeDisabled();
  });
});

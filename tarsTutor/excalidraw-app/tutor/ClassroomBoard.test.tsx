import { createRef } from "react";
import { applyDarkModeFilter } from "@excalidraw/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  mockBoundingClientRect,
  restoreOriginalGetBoundingClientRect,
} from "../../packages/excalidraw/tests/test-utils";
import { UI } from "../../packages/excalidraw/tests/helpers/ui";
import type { LessonElement } from "../../shared/classroom";
import ClassroomBoard from "./ClassroomBoard";
import type { ClassroomBoardHandle } from "./ClassroomBoard";
import { readClassroomBoard } from "./classroomBoardStorage";

afterEach(() => {
  cleanup();
  restoreOriginalGetBoundingClientRect();
});

describe("original whiteboard tools in the classroom", () => {
  it("mounts the full toolbar and supports creating, undoing and redoing a shape", async () => {
    mockBoundingClientRect({ width: 1200, height: 760 });
    const onInteract = vi.fn(),
      onToolChange = vi.fn();
    const ref = createRef<ClassroomBoardHandle>();
    const visual = {
      id: "intro",
      type: "text",
      text: "A lesson you can edit",
      caption: "",
      x: 60,
      y: 160,
      width: 700,
      height: 100,
      reveal_at: 0,
      color: "ink",
    } as LessonElement;
    const editor = await render(
      <ClassroomBoard
        ref={ref}
        sceneId="native-tools-test"
        title="Editable lesson"
        objective="Try the drawing tools"
        elements={[visual]}
        progress={1}
        view={window}
        onInteract={onInteract}
        onToolChange={onToolChange}
      />,
    );
    await waitFor(() =>
      expect(
        screen.queryByText("Opening whiteboard tools…"),
      ).not.toBeInTheDocument(),
    );
    for (const type of [
      "hand",
      "selection",
      "rectangle",
      "diamond",
      "ellipse",
      "arrow",
      "line",
      "freedraw",
      "text",
      "stickynote",
      "eraser",
    ]) {
      expect(screen.getByTestId(`toolbar-${type}`)).toBeVisible();
    }
    fireEvent.click(screen.getByTestId("toolbar-freedraw"));
    expect(screen.getByTestId("toolbar-freedraw")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(onToolChange).toHaveBeenCalledWith(true);
    act(() => ref.current?.draw());
    expect(screen.getByTestId("toolbar-selection")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(onInteract).toHaveBeenCalled();
    const shape = UI.createElement("rectangle", {
      x: 800,
      y: 600,
      width: 70,
      height: 60,
    });
    const shapeId = shape.id;
    expect(
      window.h.elements.some((e) => e.id === shape.id && !e.isDeleted),
    ).toBe(true);
    const undo = screen.getByRole("button", { name: /Undo/ });
    fireEvent.click(undo);
    expect(
      window.h.elements.some((e) => e.id === shape.id && !e.isDeleted),
    ).toBe(false);
    expect(
      window.h.elements.some(
        (e) =>
          e.type === "text" &&
          e.text === "A lesson you can edit" &&
          !e.isDeleted,
      ),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Redo/ }));
    expect(
      window.h.elements.some((e) => e.id === shape.id && !e.isDeleted),
    ).toBe(true);
    act(() =>
      ref.current?.explain({
        request_id: "native-answer",
        board_used: true,
        reply: "Area = 70 × 60 = 4200 square units.",
        narration: "Multiply seventy by sixty.",
        elements: [],
      }),
    );
    const isAnswer = (e: typeof window.h.elements[number]) =>
      e.customData?.answerRequestId === "native-answer";
    await waitFor(() =>
      expect(
        window.h.elements.some(
          (e) =>
            isAnswer(e) &&
            e.type === "text" &&
            e.text.includes("4200") &&
            !e.isDeleted,
        ),
      ).toBe(true),
    );
    const answerIds = window.h.elements.filter(isAnswer).map((e) => e.id);
    fireEvent.click(undo);
    expect(window.h.elements.filter(isAnswer).every((e) => e.isDeleted)).toBe(
      true,
    );
    expect(
      window.h.elements.some((e) => e.id === shapeId && !e.isDeleted),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Redo/ }));
    expect(
      window.h.elements
        .filter(isAnswer)
        .filter((e) => !e.isDeleted)
        .map((e) => e.id),
    ).toEqual(answerIds);
    fireEvent.click(screen.getByRole("button", { name: "More tools" }));
    expect(await screen.findByTestId("toolbar-image")).toBeVisible();
    expect(screen.getByTestId("toolbar-laser")).toBeVisible();
    expect(screen.getByTestId("toolbar-frame")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "More tools" }));
    fireEvent.click(screen.getByTestId("main-menu-trigger"));
    fireEvent.click(await screen.findByTestId("toggle-dark-mode"));
    expect(editor.container.querySelector(".excalidraw")).toHaveClass(
      "theme--dark",
    );
    expect(window.document.documentElement.dataset.tarsTheme).toBe("dark");
    expect(window.h.state.viewBackgroundColor).toBe("#fafafa");
    expect(applyDarkModeFilter(window.h.state.viewBackgroundColor)).toBe(
      "#161616",
    );
    editor.unmount();
    const saved = await readClassroomBoard(window, "native-tools-test");
    expect(saved?.elements.some((e) => e.id === shapeId && !e.isDeleted)).toBe(
      true,
    );
    expect(saved?.appState?.theme).toBe("dark");
    expect(
      saved?.elements.some(
        (e) =>
          isAnswer(e) &&
          e.type === "text" &&
          e.text.includes("4200") &&
          !e.isDeleted,
      ),
    ).toBe(true);
  });
});

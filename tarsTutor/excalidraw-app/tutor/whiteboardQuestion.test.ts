import { beforeEach, describe, expect, it, vi } from "vitest";
import { convertToExcalidrawElements } from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import {
  captureWhiteboardQuestion,
  questionElements,
} from "./whiteboardQuestion";

const renderImage = vi.hoisted(() => vi.fn());
vi.mock("@excalidraw/excalidraw", () => ({ exportScene: renderImage }));
const scene = () =>
  convertToExcalidrawElements(
    [
      {
        id: "lesson",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        customData: { source: "tars-classroom" },
      },
      {
        id: "drawing",
        type: "rectangle",
        x: 700,
        y: 400,
        width: 200,
        height: 100,
      },
      { id: "label", type: "text", x: 770, y: 360, text: "3" },
      {
        id: "hidden",
        type: "rectangle",
        x: 700,
        y: 400,
        width: 50,
        height: 50,
      },
    ],
    { regenerateIds: false },
  ).map((element): ExcalidrawElement =>
    element.id === "hidden"
      ? { ...element, isDeleted: true }
      : element,
  );
const state = { selectedElementIds: {} } as AppState;
beforeEach(() => {
  renderImage
    .mockReset()
    .mockResolvedValue({
      size: 100,
      type: "image/png",
      arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
    });
});
describe("drawing questions", () => {
  it("focuses on student drawing and nearby labels, excluding deleted or distant lesson work", () => {
    const focused = questionElements(scene(), {}, []);
    expect(focused.scope).toBe("student_work");
    expect(focused.elements.map((e) => e.id)).toEqual(["drawing", "label"]);
    expect(focused.hasStudentWork).toBe(true);
  });
  it("prioritizes explicit selection and recognizes edits to tutor shapes", () => {
    expect(
      questionElements(scene(), { lesson: true }, []).elements.map((e) => e.id),
    ).toEqual(["lesson"]);
    const original = scene().filter((e) => e.id === "lesson");
    expect(questionElements(original, {}, []).scope).toBe("board");
    expect(questionElements(original, {}, ["lesson"]).scope).toBe(
      "student_work",
    );
  });
  it("exports native scene pixels with images and clean light background through the owner document", async () => {
    const files = {};
    const result = await captureWhiteboardQuestion(
      window,
      scene(),
      state,
      files,
      [],
    );
    expect(result).toMatchObject({
      scope: "student_work",
      has_student_work: true,
      element_count: 2,
      text: "3",
      data: "iVBORw==",
    });
    const request = renderImage.mock.calls[0][0];
    expect(request.data.elements.map((e: { id: string }) => e.id)).toEqual([
      "drawing",
      "label",
    ]);
    expect(request.data.files).toBe(files);
    expect(request.config.environment.document).toBe(window.document);
    expect(request.config).toMatchObject({
      theme: "light",
      canvasBackgroundColor: "#ffffff",
      maxWidthOrHeight: 1600,
    });
  });
  it("compresses large snapshots and rejects an oversized drawing rather than silently dropping it", async () => {
    renderImage
      .mockResolvedValueOnce({ size: 1_950_000 })
      .mockResolvedValueOnce({ size: 2_000_001 });
    await expect(
      captureWhiteboardQuestion(window, scene(), state, {}, []),
    ).rejects.toThrow("Select the part");
    expect(renderImage.mock.calls[1][0]).toMatchObject({
      type: "jpeg",
      config: { quality: 0.82 },
    });
  });
  it("does not export an empty or cancelled scene", async () => {
    expect(
      await captureWhiteboardQuestion(window, [], state, {}, []),
    ).toBeNull();
    const controller = new window.AbortController();
    controller.abort();
    await expect(
      captureWhiteboardQuestion(
        window,
        scene(),
        state,
        {},
        [],
        controller.signal,
      ),
    ).rejects.toThrow("cancelled");
    expect(renderImage).not.toHaveBeenCalled();
  });
});

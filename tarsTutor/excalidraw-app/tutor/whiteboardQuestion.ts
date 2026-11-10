import { exportScene } from "@excalidraw/excalidraw";
import { getCommonBounds } from "@excalidraw/element";
import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type {
  ClassroomWindow,
  WhiteboardContext,
} from "../../shared/classroom";

/** Focus on the student's work, retaining nearby handwritten labels and arrows. */
export function questionElements(
  elements: readonly ExcalidrawElement[],
  selected: AppState["selectedElementIds"],
  edited: readonly string[],
) {
  const visible = elements.filter(
    (e): e is NonDeletedExcalidrawElement => !e.isDeleted && e.opacity > 0,
  );
  const changed = new Set(edited);
  const student = visible.filter(
    (e) => e.customData?.source !== "tars-classroom" || changed.has(e.id),
  );
  const chosen = visible.filter((e) => selected[e.id]);
  const focus = chosen.length ? chosen : student;
  if (!focus.length) {
    return {
      elements: visible,
      scope: "board" as const,
      hasStudentWork: student.length > 0,
    };
  }
  const [left, top, right, bottom] = getCommonBounds(focus);
  const nearby = visible.filter((e) => {
    const [x1, y1, x2, y2] = getCommonBounds([e]);
    return (
      x2 >= left - 120 &&
      x1 <= right + 120 &&
      y2 >= top - 120 &&
      y1 <= bottom + 120
    );
  });
  return {
    elements: nearby,
    scope: chosen.length ? ("selection" as const) : ("student_work" as const),
    hasStudentWork: student.length > 0,
  };
}

export async function captureWhiteboardQuestion(
  view: ClassroomWindow,
  elements: readonly ExcalidrawElement[],
  state: AppState,
  files: BinaryFiles,
  edited: readonly string[],
  signal?: AbortSignal,
): Promise<WhiteboardContext | null> {
  const check = () => {
    if (signal?.aborted) {
      throw new Error("Reading the whiteboard was cancelled.");
    }
  };
  check();
  const focus = questionElements(elements, state.selectedElementIds, edited);
  if (!focus.elements.length) {
    return null;
  }
  const config = {
    maxWidthOrHeight: 1600,
    padding: 30,
    canvasBackgroundColor: "#ffffff",
    theme: "light" as const,
    environment: {
      document: view.document,
      createCanvas: () => view.document.createElement("canvas"),
      createImage: () => view.document.createElement("img"),
      createPath: (path: string) => new view.Path2D(path),
    },
  };
  const data = { elements: focus.elements, files };
  const render = async (type: "png" | "jpeg") => {
    let timer: number | undefined;
    try {
      return await Promise.race([
        exportScene({
          type,
          data,
          config: { ...config, ...(type === "jpeg" ? { quality: 0.82 } : {}) },
        }),
        new Promise<never>((_, reject) => {
          timer = view.setTimeout(
            () =>
              reject(
                new Error(
                  "Reading your drawing took too long. Select a smaller area and try again.",
                ),
              ),
            20000,
          );
        }),
      ]);
    } finally {
      view.clearTimeout(timer);
    }
  };
  let image = await render("png");
  check();
  if (image.size > 1_900_000) {
    image = await render("jpeg");
  }
  if (image.size > 2_000_000) {
    throw new Error(
      "This drawing is too detailed to send at once. Select the part you want to ask about and try again.",
    );
  }
  const bytes = new Uint8Array(await image.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 16384) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  }
  check();
  return {
    media_type: image.type === "image/jpeg" ? "image/jpeg" : "image/png",
    data: view.btoa(binary),
    scope: focus.scope,
    element_count: focus.elements.length,
    has_student_work: focus.hasStudentWork,
    selected_element_ids: focus.elements
      .filter((e) => state.selectedElementIds[e.id])
      .map((e) => e.id)
      .slice(0, 100),
    text: focus.elements
      .filter((e) => e.type === "text")
      .map((e) => e.text)
      .join("\n")
      .slice(0, 6000),
  };
}

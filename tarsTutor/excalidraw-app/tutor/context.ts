import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type { BoardContext } from "../../shared/agent";

/** Send selected readable work, never the whole canvas or raw strokes. */
export const getBoardContext = (api: ExcalidrawImperativeAPI): BoardContext => {
  const selection = api.getAppState().selectedElementIds;
  const selected = api
    .getSceneElements()
    .filter(
      (element) =>
        selection[element.id] ||
        (element.type === "text" &&
          !!element.containerId &&
          selection[element.containerId]),
    )
    .slice(0, 30);
  const source = selected.find((element) => element.customData?.lessonId);
  const validId = (value: unknown) =>
    typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value)
      ? value
      : undefined;
  return {
    selected_element_ids: selected
      .map((element) => element.id)
      .filter((id) => validId(id)),
    selected_text: selected
      .map((element) => (element.type === "text" ? element.text : ""))
      .filter(Boolean)
      .join("\n")
      .slice(0, 6000),
    lesson_id: validId(source?.customData?.lessonId),
    step_id: validId(source?.customData?.stepId),
  };
};

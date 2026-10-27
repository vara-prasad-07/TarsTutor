# Sample lesson format

`logisticRegression.ts` is the fixed teaching response used to preview the board before adding AI. Its types are in `shared/tutor.ts` at the project root.

Each lesson has a `lessonId`, `turnId`, `title`, `reply`, and `steps`. Each step has an ID, a title, an explanation, and content blocks. The explanation can later supply narration. Blocks contain teaching content and graph parameters; coordinates and editor styles belong to `boardController.ts`.

Supported preview blocks:

| Type       | Content                                                |
| ---------- | ------------------------------------------------------ |
| `text`     | Explanation with an optional muted or accent tone      |
| `formula`  | Formula text and a short caption                       |
| `pipeline` | Three labels connected by arrows                       |
| `sigmoid`  | Minimum and maximum score for a calculated curve       |
| `question` | Prompt, choices, correct answer index, and explanation |

The question is a static answer-revealed example. Its choices are editable drawing elements, not interactive HTML buttons.

The renderer uses the element skeleton API implemented in `packages/element/src/transform.ts`. The upstream [element skeleton documentation](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/excalidraw-element-skeleton) provides additional reference:

1. Build element skeletons, then call `convertToExcalidrawElements` before sending them to the editor.
2. Set `regenerateIds: false` and supply stable element IDs so reopening the preview does not duplicate it.
3. Store `source`, `lessonId`, `turnId`, `stepId`, and `blockId` in `customData`. Follow tutor uses that metadata.
4. Merge the lesson into the current scene with `updateScene` and an undoable capture. Preserve student work and position a newly added sample to its right.
5. Use this fork's `setViewport` API to fit the board or a selected section. Reserve space for editor UI and the floating composer.

An empty local board loads the sample automatically. An existing drawing stays in place; the Logistic regression demo control loads or focuses the sample. All text, formulas, graph segments, and cards are native elements and are included in normal board exports and browser autosave.

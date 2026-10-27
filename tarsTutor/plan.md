# TarsTutor: your AI whiteboard tutor

## 1. Idea

You cloned Excalidraw because it already provides the whiteboard: drawing, text, shapes, images, zoom, pan, and undo.

We will build your tutor on top of that board. The student asks a question, and the AI teaches by writing explanations, drawing examples, asking questions, and responding to the student's answers. Voice will let the student talk to the tutor while following the board.

Your reference image shows the target experience: notes on the canvas, interactive graphs, question cards, a message box, and tutor controls around the board.

## 2. Solution

We will add the tutor inside `excalidraw-app/`, using the editor that comes from `packages/excalidraw/`.

There are three connected parts:

1. **Tutor interface:** receives student input and shows the conversation and lesson controls.
2. **AI backend:** receives the question and lesson context, then returns an explanation and instructions for the board.
3. **Board controller:** converts those instructions into text, shapes, arrows, and highlights using the existing editor API.

```text
Student question
      |
      v
Tutor interface -> our backend -> AI model
      ^                              |
      |                              v
      +------ explanation + lesson steps
                             |
                             v
                     Board controller
                             |
                             v
                  Existing Excalidraw canvas
```

For example, "Teach me logistic regression" could produce an introduction, a formula, a graph, and a check question. The AI chooses the teaching content. Our application controls how those items are positioned and rendered.

## 3. Final objectives / outcomes

The completed tutor should let the student:

- Start a lesson with a typed question, a spoken question, or an uploaded question image.
- Watch explanations and diagrams appear step by step on the board.
- Ask follow-up questions and interrupt the tutor.
- Draw their own working and ask the tutor to review it.
- Answer question cards and explore supported interactive graphs.
- Follow the tutor's writing area or move around the canvas independently.
- Pause, end, and resume a saved lesson.

We will build the core interaction first: **ask a question -> AI explains on the board -> student responds -> AI continues**. Saved lessons, interactive widgets, voice, and uploads will extend that same flow.

## 4. Technical plan

All paths below are relative to the `tarsTutor/` project folder. Files described as new are proposed additions.

### Step 1: Add your tutor controls to the existing interface

**Status: implemented.** The question input, conversation drawer, Follow tutor toggle, and pause/end/reopen controls are in place. Questions are collected in this tab; AI replies will be connected in Steps 4–5.

**Existing files:** `excalidraw-app/index.tsx`, `excalidraw-app/App.tsx`, and `excalidraw-app/index.scss`.

`index.tsx` already renders `ExcalidrawApp`. Inside `App.tsx`, `ExcalidrawWrapper` renders the `<Excalidraw>` editor, and `useExcalidrawAPI()` provides access to its board.

We will add `excalidraw-app/tutor/TutorOverlay.tsx` alongside the editor inside that wrapper. It will receive the editor API and display the input box, conversation drawer, Follow tutor button, and lesson controls. Its styles will go in `tutor/tutor.scss`.

We will adjust the existing `AppMainMenu`, `AppWelcomeScreen`, and `renderTopRightUI` connections in `App.tsx` to make room for your tutor layout. The Jotai provider and `ExcalidrawAPIProvider` already wrap the app, so our tutor components can use them.

**Outcome:** the current whiteboard has your tutor interface around it.

### Step 2: Define the format of an AI teaching response

**Status: static preview implemented.** `shared/tutor.ts` defines the content format, and `excalidraw-app/tutor/lessons/logisticRegression.ts` contains the example response. Runtime validation will be added when connecting AI.

**New file:** `shared/tutor.ts`.

The frontend and backend need one agreed format. Each response will contain a reply and a list of teaching steps. Each step has a stable ID, an explanation, and board content.

For example:

```json
{
  "turnId": "turn-1",
  "reply": "Let's start with probability.",
  "steps": [
    {
      "id": "step-1",
      "explanation": "A probability is between zero and one.",
      "blocks": [
        { "id": "b1", "type": "heading", "text": "Probability" },
        { "id": "b2", "type": "text", "text": "0 <= p <= 1" }
      ]
    }
  ]
}
```

Initially, we will support headings, text, basic diagrams, and highlights. Formula, graph, and question blocks will extend the same format later.

The AI supplies content and relationships between items. Our renderer calculates coordinates, spacing, and font sizes. We will validate responses at runtime before rendering them, including supported types and maximum content sizes.

**Outcome:** the AI has a clear, limited way to tell our application what to teach.

### Step 3: Turn those teaching steps into Excalidraw elements

**Status: static preview implemented.** `boardController.ts` renders the sample as editable elements through the skeleton API. The sample control fits the whole board or one section while preserving existing student drawings.

**New file:** `excalidraw-app/tutor/boardController.ts`.

This module will use the editor API already available in `App.tsx`. It will calculate positions, convert blocks into element skeletons, and use the existing `convertToExcalidrawElements` export to create elements.

To add a step, it will read the latest scene with `getSceneElementsIncludingDeleted()`, merge in the new elements, and call `updateScene()`. Reading the latest scene matters because the student may have drawn something while waiting for the response.

Tutor elements will store lesson, turn, and block IDs in the existing `customData` field. These IDs identify tutor content and prevent duplicate elements when a request is retried. We will use `captureUpdate` to make each teaching step an appropriate undo operation.

A layout function will wrap text and allocate space for each step so explanations do not overlap. We will test it with a fixed response before connecting the AI.

**Outcome:** a teaching response becomes readable, editable content on the board.

### Step 4: Add the backend that talks to the AI

**New files:** `server/index.ts`, `server/tutor.ts`, and `server/tsconfig.json`.

The current frontend runs through Vite. We will add a small TypeScript Node server with a `POST /api/tutor/turn` endpoint. A proxy in `excalidraw-app/vite.config.mts` will forward local `/api` requests to it.

The endpoint will receive the student's message, recent conversation, lesson summary, and relevant board information. It will call an AI provider, validate the returned teaching response, and send it to the frontend.

The credential belongs in a server environment variable such as `AI_API_KEY`. It must not use a `VITE_` prefix because those variables can be exposed to browser code.

We will add a server command to the root `package.json` and a separate server typecheck. The current root `tsconfig.json` includes only `packages` and `excalidraw-app`.

The existing `components/AI.tsx` handles diagram-to-code and text-to-diagram through an upstream backend. Our tutor will use its own endpoint and response format.

**Outcome:** a local backend can return AI-generated teaching steps. Deployment will also need a Node backend; the current static frontend deployment settings alone do not run this server.

### Step 5: Connect student input to the backend and board

**New files:** `excalidraw-app/tutor/useTutor.ts` and `tutor/tutorState.ts`.

`useTutor.ts` will coordinate the interaction:

1. Record the student's message.
2. Send it to `/api/tutor/turn`.
3. Receive the accepted teaching response.
4. Add the tutor reply to the conversation.
5. Pass its steps to the board controller.

We will use the Jotai exports already provided by `excalidraw-app/app-jotai.ts` for the active lesson, conversation, current step, and tutor status.

The interface will show thinking, explaining, waiting for an answer, and error states. Stale requests must be cancelled or ignored, and retrying must preserve the student's message without duplicating board content.

**Outcome:** the student can ask a real question and watch the tutor explain it on the board.

### Step 6: Give follow-up questions the right context

**Existing connection:** `onChange(elements, appState, files)` in `excalidraw-app/App.tsx`.

We will use this callback to keep a current board reference. We will send context when the student submits a question, rather than requesting AI responses after every pen stroke.

Context will include recent conversation, a summary of previous teaching, the current exercise, and relevant text or selected elements from the board. This supports questions such as "Explain that arrow" or "Why did you divide by two?"

Freehand strokes are coordinates, so reviewing handwriting needs an image of the selected work. We will add an explicit "Review my work" action that exports the chosen area and sends it to a model that accepts images.

**Outcome:** the tutor understands the current lesson and can review selected student work.

### Step 7: Control teaching pace and camera movement

**New file:** `excalidraw-app/tutor/lessonPlayer.ts`.

The lesson player will reveal accepted steps in sequence and track which ones have already appeared. Pause stops upcoming steps; continue resumes from the saved position.

Follow tutor uses this fork's `setViewport({ target, fit: "scale-down", animation: true })` method to focus on the current explanation. Switching it off lets the student pan and zoom independently.

Each visible step already has an ID and explanation text. Later, the lesson player will use these to coordinate narration with board updates.

**Outcome:** the tutor teaches at a controlled pace instead of filling the canvas at once.

### Step 8: Save the conversation and board together

**Existing files:** `excalidraw-app/data/LocalData.ts`, `data/localStorage.ts`, and `data/TTDStorage.ts`.

The current code already saves the active scene and image files in the browser. We will add `data/TutorStorage.ts`, following the existing IndexedDB pattern in `TTDStorage.ts`, to store the lesson ID, conversation, accepted steps, playback position, and answers.

For resume, we will save a versioned checkpoint containing matching scene and tutor state. Images can remain in the existing file store, referenced by their IDs. The restore path in `App.tsx` must load that checkpoint before continuing the lesson.

We can start with one local lesson. Multiple saved lessons require an additional change: `clearObsoleteFiles()` in `LocalData.ts` currently considers only images used by the current canvas, so it must also preserve images referenced by saved lessons.

**Outcome:** refresh restores the matching explanation, board, and student progress.

### Step 9: Add the interactive parts from your reference image

**New components:** `tutor/widgets/QuestionCard.tsx`, `GraphWidget.tsx`, and `FormulaBlock.tsx`.

Buttons and sliders will be React components positioned over the canvas. We will store their positions in scene coordinates and use the existing `sceneCoordsToViewportCoords` helper to keep them aligned during pan and zoom, accounting for the app container's offset.

For the logistic-regression example, our graph component will calculate the sigmoid curve and update it when sliders move. The AI supplies supported parameters and teaching text; the component performs the calculations.

Formulas will use a math renderer for fractions and powers. Excalidraw export does not automatically capture React overlays, so exporting these widgets will require adding static rendered versions to the exported board.

Question selections will use the same tutor request flow. We can check known multiple-choice and numeric answers directly, then ask the AI to explain the feedback.

**Outcome:** your tutor can teach with interactive graphs, readable formulas, and answer cards.

### Step 10: Add voice to the working lesson flow

**New file:** `tutor/voice/useVoiceTutor.ts`, with corresponding server speech handlers.

We will connect microphone input to speech recognition, send the resulting text through `useTutor.ts`, and generate speech from each accepted step's explanation. The lesson player will coordinate each board reveal with that step's audio.

Mute controls recording. Pause stops playback. Interrupt stops the current audio and pending steps before accepting the next question. The transcript remains available.

This reuses the text tutor and board controller. If measured conversation delay is too high, we can replace the speech transport with a realtime voice connection while retaining the same lesson format.

**Outcome:** the student can speak naturally while the tutor explains on the board.

### Step 11: Add question uploads and verify the complete experience

We will add an attachment button for question images. The backend will send the image and student's request to an image-capable model, then return the same teaching response used for typed questions. PDF support can follow with a page extraction step.

We will verify a full lesson: ask a question, follow the explanation, draw working, request feedback, answer a question card, pause, and reload. We will check that student drawings survive tutor updates and retries do not duplicate steps.

Implementation checks will use the existing `yarn test:typecheck`, focused tests for the tutor integration, the new server typecheck, and `yarn build:app`.

**Outcome:** the student-to-AI-to-whiteboard flow works as one connected tutor.

**Our starting point:** build Steps 1–3 with a fixed teaching response, then connect the AI in Steps 4–5. That gives us the first usable version and a working foundation for the remaining features.

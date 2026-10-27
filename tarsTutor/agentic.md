# Agentic whiteboard tutor: implementation plan

## Goal and current baseline

Make each tutor turn responsive to the student's intent, prior lesson, and relevant board work. The tutor should decide whether to clarify, explain, assess an answer, review work, or use a tool; then it should check the result before showing it. This is an **agent loop**, but it does not require several autonomous agents for every prompt. One orchestrator with a small set of bounded tools is enough for the first reliable version.

Today, `excalidraw-app/tutor/llm.tsx` sends only the current prompt to `/api/tutor/gemini`. `excalidraw-app/server/gemini.ts` makes one Gemini call. `shared/llm.ts` validates a 1–3 step lesson containing text and formula blocks, and `boardController.ts` appends it without replacing student drawings. The conversation is in memory, each request is independent, and the endpoint exists only in Vite development. The plan below extends that path; it does not assume that follow-up memory, image understanding, or production hosting already exist.

## How a tutor turn runs

```text
Student input + current session + selected board context
                      |
                      v
             Normalize / classify intent
                      |
                      v
           Build a short teaching plan
                      |
                      v
       Need evidence or computation? -- yes --> Allowlisted tool --> Tool result
                      |                                  |             |
                      no <---------------------------------------------+
                      |
                      v
           Draft typed tutor response
                      |
                      v
       Validate format + teaching criteria
                 |                    |
               pass                 fail
                 |                    |
                 v           Repair once or ask for clarity
       Return response + board commands
                 |
                 v
       Client renders and records progress
```

The server owns the decisions and tool execution. The model proposes intent, plan, and content as structured data; application code checks every boundary. Tool calls are requests from the model, not authority to run arbitrary code. The browser owns Excalidraw rendering and sends a compact board snapshot with the request. Avoid sending all strokes or the whole canvas on every turn.

### Turn input

Define a `TutorTurnRequest` with `sessionId`, `turnId` (client-generated idempotency key), `message`, optional `answerToQuestionId`, and `boardContext`. Board context should contain selected element IDs, readable selected text, current lesson/step IDs, and optionally an image supplied by an explicit **Review my work** action. Include a compact server-held conversation summary plus the last few turns. Reject oversized or stale input and treat board text as student data, not instructions to the agent.

### Intent classifier

Use one structured classification call, or combine classification with the planning call once quality is measured. Suggested intents: `new_topic`, `follow_up`, `clarification`, `answer_submission`, `review_work`, `board_reference`, and `off_topic`. Include confidence and missing information. Prefer deterministic routing for explicit UI actions (`answerToQuestionId`, Review my work) before asking a model to classify. If the user says “what is this?” with no selected item, ask what they mean instead of guessing.

### Planner

Return a small typed plan: learning goal, assumed prior knowledge, 1–3 teaching steps, response mode, needed tool names, and acceptance criteria. Do not create a free-form chain of thought or expose hidden reasoning. A simple explanation can go straight from plan to draft. A worked calculation or student-answer check uses a deterministic tool. A request about a selected drawing may use board retrieval or image understanding. If the plan needs information the app does not have, ask one concise question.

### Bounded loop

Use a state machine such as `classify -> plan -> tool? -> draft -> validate -> done`. Set hard limits: at most 2 tool rounds, at most 1 repair draft, a per-turn deadline, bounded tokens and payload size, and cancellation via `AbortSignal`. Stop early when the answer passes checks. On timeout or exhausted repairs, return a small honest explanation or clarification; never render partially validated elements. Retry transient provider errors separately from quality repair, and do not retry side-effecting actions blindly.

## Checks before output

Use code for structural checks and a focused model review only where semantic judgement is needed. The validator should report specific failures that one repair call can address.

| Check | Required behavior |
| --- | --- |
| Contract | Parse on the server and again on the client; allow only supported block types, lengths, IDs, finite numbers, and bounded counts. Assign stable IDs in application code. |
| Intent | Answer the student's actual request and use the selected context. Ask for clarification when a reference is ambiguous. |
| Teaching | State the key idea accurately, show a relevant worked example when useful, use steps that build on each other, and include a short check for understanding when appropriate. |
| Math/answers | Run calculations and answer matching in deterministic code where possible. Check formula/units/steps before displaying them; a fluent explanation is not proof of correctness. |
| Board | Render only known semantic blocks. Check size and layout, preserve student elements, and avoid duplicate writes for the same `turnId`. |
| Evidence | Distinguish retrieved facts from the tutor's inference. Require a source for time-sensitive or externally fetched claims. |
| Safety/privacy | Never place keys in browser code or send unrelated board content to a provider. Treat uploaded text and tool results as untrusted content. |

`shared/llm.ts` already handles part of the contract check. Extend it rather than relying on the model's JSON mode as the sole validator. The present `TutorLesson` remains the board-rendering format; add a separate response envelope such as `{ intent, reply, lesson?, question?, feedback?, sources?, nextAction }`. A clarification or answer check should not be forced into a fake three-step lesson. When rendering is requested, `lesson` must still satisfy the existing board schema.

## Tools and boundaries

Start with a small typed tool registry on the server. Each tool has a name, input validator, output validator, timeout, and permission rule. The orchestrator dispatches only registered tools.

| Tool | Trigger | Result |
| --- | --- | --- |
| `get_board_context` | “this arrow,” “my work,” selected element | Selected element text/metadata or a user-approved crop; no canvas mutation. |
| `calculate` | Arithmetic, graph values, numeric answer checking | Deterministic numeric result with units/working where possible. Use constrained operations, not arbitrary `eval`. |
| `check_answer` | Question card or explicit student answer | Correctness and misconception tags from a stored answer key; model writes the explanation afterward. |
| `lookup_course_material` | A course or teacher-provided fact is needed | Retrieved snippets with document IDs for citation. Add after content is available. |
| `search_web` | Explicit research request or genuinely current fact | Trusted search results with URLs and dates; opt in for cost and grounding. |

The board controller itself is a **client renderer**, not a general model tool. The model never chooses Excalidraw coordinates, calls `updateScene`, executes JavaScript, or edits arbitrary student work. Later, a specific `highlight_elements` command can be added with element IDs checked against the current scene.

## Tech stack that fits this repo

- **Frontend:** keep React, TypeScript, Excalidraw, and the existing `TutorOverlay`. Replace `useLLM` with a turn client that sends context, supports cancellation, and applies accepted board commands once.
- **Backend:** move the tutor endpoint from the Vite-only plugin to a deployable Node TypeScript server or serverless handler. Keep `GEMINI_API_KEY` server-side. Give the orchestrator its own module and a provider adapter so the orchestration is not coupled to Gemini response shapes.
- **Model interface:** retain Gemini initially and its structured JSON response. Use function calling only for registered intermediate tools. Start with the current REST integration; adopt an SDK only if it materially simplifies tool-call history, streaming, or schema handling.
- **Schemas:** TypeScript types plus runtime validators for request, intent, plan, tool inputs/results, and final response. The existing parser can be refactored into these contracts; no orchestration framework is required at first.
- **State:** store session summary, recent turns, current exercise, accepted lesson IDs, and tool trace on the server. Store matching board/session checkpoints in the client until a production persistence choice is made. Use `turnId` for idempotency.
- **Tests/observability:** Vitest for routing and validation; mocked provider/tool tests for the loop; a small set of real teaching prompts for evaluation. Log state transitions, tool name, latency, token/cost estimates, validator failures, and final status without logging private board images by default.

Do not start a separate classifier, planner, teacher, critic, and renderer as independently running agents. Those roles are useful conceptual stages, but separate workers add latency, cost, and coordination failure. Split a specialist out only after evaluation shows one stage needs a different model, context, or permission boundary.

## Prompt-to-output example

Student: “Why does logistic regression use a sigmoid? If the score is 2, what probability do we get?” The current board contains a logistic regression lesson.

1. **Classify:** `follow_up`; context references the active logistic regression step.
2. **Plan:** explain that the sigmoid maps any real score into 0–1; compute `1 / (1 + exp(-2))`; show one formula and one short interpretation.
3. **Tool:** `calculate({ operation: "sigmoid", value: 2 })` returns about `0.8808`.
4. **Draft:** “The sigmoid turns a raw score into a number between 0 and 1. For z = 2, p = 1 / (1 + e^-2) ≈ 0.881, or about 88%. That is the model's predicted probability for the positive class, not a guarantee that this one case is positive.”
5. **Validate:** formula matches tool result; explanation addresses “why”; block count and lengths fit the schema; response points to the active lesson. If a criterion fails, repair once using the failure list.
6. **Output:** return a short chat reply plus a validated `TutorLesson` with text/formula blocks. The browser appends the new elements beside existing work and records `turnId` so a repeated response does not duplicate the board.

Example response shape (illustrative; define and validate the exact schema before implementation):

```json
{
  "turnId": "turn-42",
  "intent": "follow_up",
  "reply": "A sigmoid maps a raw score to 0–1. At z = 2, the probability is about 0.881.",
  "lesson": {
    "title": "Why the sigmoid?",
    "reply": "A sigmoid maps a raw score to 0–1. At z = 2, the probability is about 0.881.",
    "steps": [
      {
        "title": "Map score to probability",
        "explanation": "A score can be any real number; the sigmoid compresses it to the probability range.",
        "blocks": [
          {
            "type": "text",
            "text": "Higher scores give higher predicted probabilities.",
            "caption": ""
          },
          {
            "type": "formula",
            "text": "p = 1 / (1 + e^-2) ≈ 0.881",
            "caption": "About 88% for the positive class"
          }
        ]
      }
    ]
  },
  "nextAction": "ask_if_clear"
}
```

The server should generate lesson/step/block IDs and feed the nested lesson through `parseGeminiLesson` (or its provider-neutral successor) before returning it. The client should validate again before using `showGeneratedLesson`.

## Implementation order

1. Add provider-neutral request/response schemas and a session context builder. Send recent turns and a compact selected-board snapshot; keep the current endpoint working during migration.
2. Implement intent routing and planning in a bounded orchestrator. First support `new_topic`, `follow_up`, `clarification`, and `answer_submission` without external tools.
3. Add deterministic `calculate` and `check_answer` tools. Add semantic acceptance checks and a single repair attempt. Keep a regression prompt set covering math, ambiguity, follow-ups, wrong answers, cancellation, and duplicated requests.
4. Change `TutorOverlay`/`useLLM` to use turn IDs, session state, distinct response modes, and accepted lessons only. Check that retries preserve student drawings.
5. Move the endpoint into production hosting, add session persistence, then add explicit work review with image context. Add retrieval/web tools only for lessons that need them.

## Skills and MCP

A `skills.md` file is **optional for the running tutor**. Agent skills are instructions for development agents; they do not make the app agentic at runtime. If reusable contributor instructions become useful, create `skills.md` for prompt/schema conventions and test cases, or extend the existing `AGENTS.md`. The runtime contracts belong in TypeScript modules and tests.

MCP is also **optional initially**. The local calculator, answer checker, board context reader, and course-material retrieval can be normal typed server functions. Consider MCP when the tutor needs a separately maintained external tool service or a shared connector used by multiple applications. Put an allowlisted MCP adapter behind the same tool registry, with per-tool input validation and credentials on the server. Do not grant a tutor a general filesystem, browser, shell, or editor tool just to make it “agentic.”

## Reference documentation

- [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output): model JSON can follow a schema, but application validation remains necessary.
- [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling): the model requests a custom function; the application executes it and returns the result.
- [Gemini tools overview](https://ai.google.dev/gemini-api/docs/tools): distinguishes provider-managed tools from application-managed functions.

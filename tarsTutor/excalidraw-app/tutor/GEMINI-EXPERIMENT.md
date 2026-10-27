# Local Gemini experiment

> Archived workflow: the active frontend now uses the sibling FastAPI/LangGraph backend. Run `yarn dev:tutor` and configure `../tarsBe/.env`; see the project README. This original experiment handler is no longer registered in Vite.

1. Open `.env.local` at the project root (next to `package.json`).
2. Set `GEMINI_API_KEY=your_actual_key` and leave `GEMINI_MODEL=gemini-3.6-flash`, or use the exact model ID available to your key.
3. Restart `yarn start` from the project root after changing these settings.
4. Enter a prompt such as **Explain Newton's second law with an example** in the whiteboard input.

Gemini's validated lesson is appended beside existing drawings and brought into view. Open Conversation for the short reply, full Response JSON, and a button to view that lesson again. Each prompt is independent in this experiment; conversation history and the existing board are not sent to Gemini. Pause or End lesson cancels a pending request. The server retries an explicit Gemini HTTP 500/502/503/504 once, after a short delay. It does not automatically retry quota errors, network failures, or successful generations. Use **Use prompt again** after a failure to put your question back in the input.

The key stays in the Vite server process. `.env.local` is already ignored by Git. Never add a `VITE_` prefix to the key, paste it into chat, or put it in `llm.tsx`.

Files:

- `tutor/llm.tsx`: browser request, cancellation, and conversation state.
- `server/gemini.ts`: local POST handler at `/api/tutor/gemini` and Gemini request.
- `shared/llm.ts` at the project root: JSON schema and runtime validation.
- `tutor/boardController.ts`: converts accepted content to native editable elements.

This first experiment supports text and formula blocks, with up to three teaching steps. The existing logistic regression sample remains available separately. It is a local Vite development feature: `yarn build:app` alone does not deploy a Gemini backend.

If the key is missing, invalid, lacks model access, or exceeds quota, the conversation displays an error without changing the board. No real Gemini call has been verified until you supply a working key.

If Gemini returns HTTP 503, the provider is temporarily unavailable. The app preserves that status instead of relabeling it as a 502. After the single automatic retry, use **Use prompt again** to restore your question and try later. A working key can still receive a transient 503.

Implementation references: [Gemini 3.6 Flash model ID](https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.6), [generateContent endpoint](https://ai.google.dev/api/generate-content), and [structured output format](https://ai.google.dev/gemini-api/docs/generate-content/structured-output?hl=en).

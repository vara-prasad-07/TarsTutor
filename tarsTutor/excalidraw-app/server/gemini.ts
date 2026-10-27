import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { geminiLessonSchema, parseGeminiLesson } from "../../shared/llm";

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

type GeminiOptions = {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
};

const providerDetail = (value: unknown, apiKey: string) =>
  typeof value === "string"
    ? value
        .split(apiKey)
        .join("[redacted]")
        .replace(/AIza[\w-]+/g, "[redacted]")
        .slice(0, 500)
    : "";

const instruction = `You are TarsTutor, a concise whiteboard tutor. Answer the student's prompt as a small lesson. Use one to three clear teaching steps and one to four short blocks per step. Use text for explanations and formula for equations, with an explanatory caption. A text block must have caption set to an empty string. Keep formulas short and use readable Unicode or plain text, not LaTeX or Markdown. Do not output HTML, JavaScript, drawing coordinates, or Excalidraw properties. Show an illustrative worked example when appropriate. Do not invent a sigmoid graph for unrelated subjects. If the prompt is unclear, ask a clarifying question in one text block. Your output must follow the supplied JSON schema.`;

const send = (res: ServerResponse, status: number, body: unknown) => {
  if (res.destroyed || res.writableEnded) {
    return;
  }
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
};

/** Server-only handler: imported by vite.config.mts, never by browser modules. */
export const createGeminiHandler =
  ({ apiKey, model, fetchImpl = fetch }: GeminiOptions) =>
  async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      send(res, 405, { error: "Use POST for Gemini prompts." });
      return;
    }
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host) {
          send(res, 403, { error: "Only requests from this app are allowed." });
          return;
        }
      } catch {
        send(res, 403, { error: "Invalid request origin." });
        return;
      }
    }
    if (!req.headers["content-type"]?.startsWith("application/json")) {
      send(res, 415, { error: "Send a JSON prompt." });
      return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > 24000) {
          send(res, 413, { error: "Prompt is too large." });
          return;
        }
        chunks.push(buffer);
      }
    } catch {
      send(res, 400, { error: "Could not read the prompt." });
      return;
    }
    let prompt: string;
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (
        typeof body?.prompt !== "string" ||
        !body.prompt.trim() ||
        body.prompt.length > 4000
      ) {
        send(res, 400, {
          error: "Enter a prompt between 1 and 4000 characters.",
        });
        return;
      }
      prompt = body.prompt.trim();
    } catch {
      send(res, 400, { error: "Invalid JSON request." });
      return;
    }
    if (!apiKey || apiKey === "your_key_here") {
      send(res, 503, {
        error:
          "Add GEMINI_API_KEY to the project root .env.local file, then restart yarn start.",
      });
      return;
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(model)) {
      send(res, 503, {
        error: "GEMINI_MODEL must be a model ID such as gemini-3.6-flash.",
      });
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    const disconnect = () => {
      if (!res.writableEnded) {
        controller.abort();
      }
    };
    res.once("close", disconnect);
    let stage: "network" | "response" | "lesson" = "network";
    try {
      const makeRequest = () =>
        fetchImpl(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
            signal: controller.signal,
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: instruction }] },
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: {
                maxOutputTokens: 8192,
                responseFormat: {
                  text: {
                    mimeType: "APPLICATION_JSON",
                    schema: geminiLessonSchema,
                  },
                },
              },
            }),
          },
        );
      let upstream = await makeRequest();
      // Retry only explicit provider failures, never successful generations or quota errors.
      if ([500, 502, 503, 504].includes(upstream.status)) {
        await upstream.body?.cancel();
        await delay(750, undefined, { signal: controller.signal });
        upstream = await makeRequest();
      }
      if (!upstream.ok) {
        const failure = await upstream.json().catch(() => null);
        const detail = providerDetail(failure?.error?.message, apiKey);
        const message =
          upstream.status === 429
            ? "Gemini quota or rate limit reached. Wait before trying again."
            : upstream.status === 401 || upstream.status === 403
            ? "Gemini rejected the API key or model access. Check your key and account permissions."
            : upstream.status === 404
            ? `Gemini model ${model} was not found for this key. Check GEMINI_MODEL in .env.local.`
            : upstream.status === 400
            ? `Gemini rejected the request.${
                detail
                  ? ` ${detail}`
                  : " Check the configured model and request format."
              }`
            : upstream.status >= 500
            ? "Gemini is temporarily unavailable. Please retry your prompt in a moment."
            : `Gemini returned HTTP ${upstream.status}. Check the configured model and try again.`;
        send(
          res,
          upstream.status >= 400 && upstream.status <= 599
            ? upstream.status
            : 502,
          { error: message },
        );
        return;
      }
      stage = "response";
      const result = await upstream.json();
      const candidate = result.candidates?.[0];
      if (candidate?.finishReason !== "STOP") {
        send(res, 502, {
          error:
            candidate?.finishReason === "MAX_TOKENS"
              ? "Gemini's response was cut off. Try a shorter or more specific prompt."
              : "Gemini did not return a complete answer. Try rephrasing your prompt.",
        });
        return;
      }
      const output = candidate.content?.parts
        ?.filter(
          (part: { text?: string; thought?: boolean }) =>
            !part.thought && typeof part.text === "string",
        )
        .map((part: { text: string }) => part.text)
        .join("");
      if (!output || output.length > 30000) {
        send(res, 502, { error: "Gemini returned empty or oversized output." });
        return;
      }
      stage = "lesson";
      const lesson = parseGeminiLesson(
        JSON.parse(output),
        `gemini-${randomUUID()}`,
      );
      send(res, 200, { lesson, model });
    } catch (error) {
      send(res, controller.signal.aborted ? 504 : 502, {
        error: controller.signal.aborted
          ? "Gemini took too long to respond. Please try again."
          : stage === "lesson"
          ? error instanceof SyntaxError
            ? "Gemini returned invalid JSON. Retry the prompt to generate a complete lesson."
            : `Gemini's lesson could not be displayed. ${
                error instanceof Error
                  ? error.message
                  : "The output did not match the lesson format."
              }`
          : stage === "response"
          ? "Gemini returned an unreadable response. Please retry your prompt."
          : "Could not reach Gemini. Check your internet connection and try again.",
      });
    } finally {
      clearTimeout(timeout);
      res.off("close", disconnect);
    }
  };

export const geminiExperiment = (options: GeminiOptions): Plugin => ({
  name: "tars-tutor-gemini-experiment",
  apply: "serve",
  configureServer(server) {
    const handle = createGeminiHandler(options);
    server.middlewares.use((req, res, next) => {
      if (req.url?.split("?")[0] !== "/api/tutor/gemini") {
        next();
        return;
      }
      void handle(req, res);
    });
  },
});

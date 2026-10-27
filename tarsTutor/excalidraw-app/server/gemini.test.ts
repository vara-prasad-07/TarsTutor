import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { parseGeminiLesson } from "../../shared/llm";

import { createGeminiHandler } from "./gemini";

import type { IncomingMessage, ServerResponse } from "node:http";

const content = {
  title: "Newton's second law",
  reply: "Force changes motion.",
  steps: [
    {
      title: "Calculate force",
      explanation: "Multiply mass by acceleration.",
      blocks: [
        { type: "formula", text: "F = m × a", caption: "2 kg × 3 m/s² = 6 N" },
        {
          type: "text",
          text: "More mass needs more force for the same acceleration.",
          caption: "",
        },
      ],
    },
  ],
};

class ResponseCapture extends EventEmitter {
  statusCode = 0;
  body = "";
  writableEnded = false;
  destroyed = false;
  headers: Record<string, string> = {};
  setHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  writeHead(status: number, headers: Record<string, string>) {
    this.statusCode = status;
    Object.assign(this.headers, headers);
  }
  end(body: string) {
    this.body = body;
    this.writableEnded = true;
  }
}

const request = (
  body: unknown = { prompt: "Explain force" },
  origin = "http://localhost:3001",
) =>
  Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    method: "POST",
    headers: {
      host: "localhost:3001",
      origin,
      "content-type": "application/json",
    },
  }) as unknown as IncomingMessage;

const upstream = (text = JSON.stringify(content), status = 200) =>
  ({
    ok: status === 200,
    status,
    json: async () => ({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }],
    }),
    body: { cancel: vi.fn() },
  } as unknown as Response);

describe("local Gemini experiment", () => {
  it("returns setup instructions without making a request when the key is empty", async () => {
    const fetchImpl = vi.fn();
    const res = new ResponseCapture();
    await createGeminiHandler({
      apiKey: "",
      model: "gemini-3.6-flash",
      fetchImpl,
    })(request(), res as unknown as ServerResponse);
    expect(res.statusCode).toBe(503);
    expect(res.body).toContain("GEMINI_API_KEY");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the requested model, sends the key only upstream, and returns an accepted lesson", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(upstream());
    const res = new ResponseCapture();
    await createGeminiHandler({
      apiKey: "test-only-secret",
      model: "gemini-3.6-flash",
      fetchImpl,
    })(request(), res as unknown as ServerResponse);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
    );
    expect(fetchImpl.mock.calls[0][1].headers["x-goog-api-key"]).toBe(
      "test-only-secret",
    );
    const sent = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(sent.generationConfig.responseFormat.text.mimeType).toBe(
      "APPLICATION_JSON",
    );
    expect(sent.contents[0].parts[0].text).toBe("Explain force");
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("test-only-secret");
    const result = JSON.parse(res.body);
    expect(result.lesson.lessonId).toMatch(/^gemini-/);
    expect(
      parseGeminiLesson(result.lesson, result.lesson.lessonId).steps[0].blocks,
    ).toHaveLength(2);
  });

  it("blocks cross-origin calls and oversized prompts before contacting Gemini", async () => {
    const fetchImpl = vi.fn();
    const handle = createGeminiHandler({
      apiKey: "test",
      model: "gemini-3.6-flash",
      fetchImpl,
    });
    const crossOrigin = new ResponseCapture();
    await handle(
      request(undefined, "https://unrelated.example"),
      crossOrigin as unknown as ServerResponse,
    );
    expect(crossOrigin.statusCode).toBe(403);
    const tooLong = new ResponseCapture();
    await handle(
      request({ prompt: "x".repeat(4001) }),
      tooLong as unknown as ServerResponse,
    );
    expect(tooLong.statusCode).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports quota failure without returning provider data or a secret", async () => {
    const res = new ResponseCapture();
    await createGeminiHandler({
      apiKey: "test-only-secret",
      model: "gemini-3.6-flash",
      fetchImpl: vi
        .fn()
        .mockResolvedValue(upstream("secret provider error", 429)),
    })(request(), res as unknown as ServerResponse);
    expect(res.statusCode).toBe(429);
    expect(res.body).toContain("quota");
    expect(res.body).not.toContain("secret");
  });

  it("rejects malformed, truncated, and unsupported model responses", async () => {
    for (const response of [
      upstream("not json"),
      upstream(
        JSON.stringify({
          ...content,
          steps: [
            {
              ...content.steps[0],
              blocks: [{ type: "html", text: "<script/>", caption: "" }],
            },
          ],
        }),
      ),
      {
        ...upstream(),
        json: async () => ({ candidates: [{ finishReason: "MAX_TOKENS" }] }),
      },
    ]) {
      const res = new ResponseCapture();
      await createGeminiHandler({
        apiKey: "test",
        model: "gemini-3.6-flash",
        fetchImpl: vi.fn().mockResolvedValue(response),
      })(request(), res as unknown as ServerResponse);
      expect(res.statusCode).toBe(502);
      expect(JSON.parse(res.body).lesson).toBeUndefined();
    }
  });

  it("limits model content and rejects absent identifiers", () => {
    expect(() =>
      parseGeminiLesson(
        { ...content, steps: Array(4).fill(content.steps[0]) },
        "gemini-test",
      ),
    ).toThrow();
    expect(() =>
      parseGeminiLesson({ ...content, title: "x".repeat(71) }, "gemini-test"),
    ).toThrow();
    expect(() =>
      parseGeminiLesson(content, undefined as unknown as string),
    ).toThrow();
  });

  it("retries an explicit transient provider failure once", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(upstream("", 503))
      .mockResolvedValueOnce(upstream());
    const res = new ResponseCapture();
    await createGeminiHandler({
      apiKey: "test",
      model: "gemini-3.6-flash",
      fetchImpl,
    })(request(), res as unknown as ServerResponse);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(200);
  });

  it("preserves provider status and redacts credentials from request errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ...upstream("", 400),
      json: async () => ({
        error: { message: "Invalid field with test-only-secret" },
      }),
    });
    const res = new ResponseCapture();
    await createGeminiHandler({
      apiKey: "test-only-secret",
      model: "gemini-3.6-flash",
      fetchImpl,
    })(request(), res as unknown as ServerResponse);
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("Invalid field");
    expect(res.body).toContain("[redacted]");
    expect(res.body).not.toContain("test-only-secret");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports provider unavailability as 503 after exactly one retry", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(upstream("", 503));
    const res = new ResponseCapture();
    await createGeminiHandler({
      apiKey: "test",
      model: "gemini-3.6-flash",
      fetchImpl,
    })(request(), res as unknown as ServerResponse);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).error).toContain("temporarily unavailable");
  });

  it("distinguishes network failures, invalid JSON, and invalid lesson data", async () => {
    const cases = [
      {
        fetchImpl: vi.fn().mockRejectedValue(new Error("connection failed")),
        message: "Could not reach Gemini",
      },
      {
        fetchImpl: vi.fn().mockResolvedValue(upstream("not json")),
        message: "invalid JSON",
      },
      {
        fetchImpl: vi
          .fn()
          .mockResolvedValue(
            upstream(JSON.stringify({ ...content, title: "x".repeat(71) })),
          ),
        message: "missing or oversized lesson text",
      },
    ];
    for (const { fetchImpl, message } of cases) {
      const res = new ResponseCapture();
      await createGeminiHandler({
        apiKey: "test",
        model: "gemini-3.6-flash",
        fetchImpl,
      })(request(), res as unknown as ServerResponse);
      expect(res.body).toContain(message);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });
});

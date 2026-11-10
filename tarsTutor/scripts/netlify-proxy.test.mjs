import assert from "node:assert/strict";
import { test } from "node:test";
import tutor from "../netlify/functions/tutor.mjs";

test("proxy forwards JSON, query strings and only server credentials", async (t) => {
  const previous = process.env.TUTOR_BACKEND_API_TOKEN;
  process.env.TUTOR_BACKEND_API_TOKEN = "test-server-token";
  t.after(() => {
    if (previous === undefined) delete process.env.TUTOR_BACKEND_API_TOKEN;
    else process.env.TUTOR_BACKEND_API_TOKEN = previous;
  });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url.pathname, "/api/tutor/lessons");
    assert.equal(url.search, "?language=en-IN");
    assert.equal(options.headers.get("X-API-Key"), "test-server-token");
    assert.equal(options.headers.get("cookie"), null);
    assert.equal(options.method, "POST");
    assert.equal(
      new TextDecoder().decode(options.body),
      '{"prompt":"Algebra"}',
    );
    return Response.json({ session_id: "lesson-1" }, { status: 202 });
  });
  const response = await tutor(
    new Request("https://frontend.example/api/tutor/lessons?language=en-IN", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "untrusted",
        cookie: "private=1",
      },
      body: '{"prompt":"Algebra"}',
    }),
  );
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { session_id: "lesson-1" });
});

test("proxy preserves binary speech responses and upstream errors", async (t) => {
  const bytes = new Uint8Array([0, 255, 1, 128]);
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(bytes, {
        headers: { "Content-Type": "audio/wav" },
      }),
  );
  const response = await tutor(
    new Request("https://frontend.example/api/tutor/speech/tts"),
  );
  assert.equal(response.headers.get("content-type"), "audio/wav");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  globalThis.fetch.mock.mockImplementation(async () =>
    Response.json({ detail: "Invalid token" }, { status: 401 }),
  );
  const denied = await tutor(
    new Request("https://frontend.example/api/tutor/lessons/example"),
  );
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), { detail: "Invalid token" });
});

test("proxy returns useful errors without exposing connection details", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("private connection details");
  });
  const request = new Request(
    "https://frontend.example/api/tutor/lessons/example",
  );
  const unavailable = await tutor(request);
  assert.equal(unavailable.status, 502);
  assert.ok(!(await unavailable.text()).includes("private connection"));
  globalThis.fetch.mock.mockImplementation(async () => {
    throw new DOMException("expired", "TimeoutError");
  });
  assert.equal((await tutor(request)).status, 504);
});

test("proxy rejects unrelated routes and unsupported methods", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("must not fetch");
  });
  assert.equal(
    (await tutor(new Request("https://frontend.example/other"))).status,
    404,
  );
  assert.equal(
    (
      await tutor(
        new Request("https://frontend.example/api/tutor/lessons", {
          method: "DELETE",
        }),
      )
    ).status,
    405,
  );
  assert.equal(fetchMock.mock.callCount(), 0);
});

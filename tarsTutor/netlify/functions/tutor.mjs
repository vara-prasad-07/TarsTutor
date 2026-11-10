const DEFAULT_BACKEND = "https://tarstutor-backend.onrender.com";

const errorResponse = (status, detail) =>
  Response.json(
    { detail },
    { status, headers: { "Cache-Control": "no-store" } },
  );

/** Forward same-origin API calls; credentials are only read by the server. */
export default async function tutor(request) {
  const incoming = new URL(request.url);
  if (!incoming.pathname.startsWith("/api/tutor/")) {
    return errorResponse(404, "Unknown tutor API route.");
  }
  if (!["GET", "POST"].includes(request.method)) {
    return errorResponse(405, "Method not allowed.");
  }

  const target = new URL(process.env.TUTOR_BACKEND_URL || DEFAULT_BACKEND);
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  const headers = new Headers();
  for (const name of ["content-type", "accept"]) {
    if (request.headers.has(name)) {
      headers.set(name, request.headers.get(name));
    }
  }
  const token = process.env.TUTOR_BACKEND_API_TOKEN;
  if (token) {
    headers.set("X-API-Key", token);
  }

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "POST" ? await request.arrayBuffer() : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(55_000),
    });
    const responseHeaders = new Headers({ "Cache-Control": "no-store" });
    for (const name of ["content-type", "retry-after"]) {
      if (upstream.headers.has(name)) {
        responseHeaders.set(name, upstream.headers.get(name));
      }
    }
    // Consume the response inside the timeout/error boundary (including audio).
    const body = await upstream.arrayBuffer();
    return new Response(upstream.status === 204 ? null : body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    const timedOut =
      error.name === "TimeoutError" || error.name === "AbortError";
    return errorResponse(
      timedOut ? 504 : 502,
      timedOut
        ? "The tutor backend took too long to respond. Please retry."
        : "The tutor backend is unavailable. Please retry shortly.",
    );
  }
}

export const config = { path: "/api/tutor/*" };

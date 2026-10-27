import type { ProxyOptions } from "vite";

/** Both development and preview keep optional backend credentials on the server. */
export const tutorProxy = (target: string, token: string): ProxyOptions => ({
  target,
  changeOrigin: true,
  timeout: 200000,
  proxyTimeout: 195000,
  headers: token ? { "X-API-Key": token } : {},
  configure(proxy) {
    proxy.on("error", (_error, _req, res) => {
      if ("writeHead" in res && !res.headersSent) {
        res.writeHead(502, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(
          JSON.stringify({
            detail:
              "Tutor backend is unavailable. Start FastAPI on port 8000 and retry.",
          }),
        );
      }
    });
  },
});

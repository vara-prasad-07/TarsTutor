import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backend = path.resolve(root, "../tarsBe");
const python = path.join(
  backend,
  process.platform === "win32"
    ? ".venv/Scripts/python.exe"
    : ".venv/bin/python",
);
const children = [];
let stopping = false;
const stop = (code = 0) => {
  if (stopping) {
    return;
  }
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.pid) {
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
      } else {
        child.kill("SIGTERM");
      }
    }
  }
  process.exit(code);
};
const start = (command, args, cwd) => {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    windowsHide: true,
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) {
      stop(code || 0);
    }
  });
};
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

try {
  let running = false;
  try {
    const response = await fetch("http://127.0.0.1:8000/openapi.json", {
      signal: AbortSignal.timeout(2000),
    });
    running =
      response.ok &&
      (await response.json()).info?.title === "TarsTutor Backend";
  } catch {
    /* Start the local backend below. */
  }
  if (running) {
    console.log(
      "Using TarsTutor backend already running on port 8000. Restart it after backend code or .env changes.",
    );
  } else {
    if (!existsSync(python)) {
      throw new Error("Set up tarsBe/.venv first; see README.md.");
    }
    start(
      python,
      [
        "-m",
        "uvicorn",
        "app.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        "8000",
      ],
      backend,
    );
  }
  start(
    process.execPath,
    [path.join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1"],
    path.join(root, "excalidraw-app"),
  );
} catch (error) {
  console.error(error.message);
  stop(1);
}

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commands = [
  {
    cwd: root,
    args: [path.join(root, "node_modules/typescript/bin/tsc"), "--noEmit"],
  },
  {
    cwd: path.join(root, "excalidraw-app"),
    args: [path.join(root, "node_modules/vite/bin/vite.js"), "build"],
  },
  { cwd: root, args: [path.join(root, "scripts/check-client-secrets.mjs")] },
];
for (const command of commands) {
  const result = spawnSync(process.execPath, command.args, {
    cwd: command.cwd,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

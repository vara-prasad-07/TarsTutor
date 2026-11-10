/** Verify known local server credentials are absent from generated client files. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const credentials = [];
for (const folder of [root, path.resolve(root, "../tarsBe")]) {
  for (const filename of [
    ".env",
    ".env.local",
    ".env.production",
    ".env.production.local",
  ]) {
    const file = path.join(folder, filename);
    if (!fs.existsSync(file)) {
      continue;
    }
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(
        /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/,
      );
      if (!match || !/(KEY|TOKEN|SECRET|GNANI_API)/i.test(match[1])) {
        continue;
      }
      const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
      if (value.length >= 12) {
        credentials.push({ name: match[1], value });
      }
    }
  }
}
let checked = 0;
let leaked = false;
function scan(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      scan(file);
      continue;
    }
    if (!/\.(js|html|css|json|map)$/.test(entry.name)) {
      continue;
    }
    checked++;
    const content = fs.readFileSync(file, "utf8");
    for (const credential of credentials) {
      if (content.includes(credential.value)) {
        leaked = true;
        console.error(
          `Server credential ${credential.name} was found in ${path.relative(
            root,
            file,
          )}.`,
        );
      }
    }
  }
}
scan(path.join(root, "excalidraw-app/build"));
if (leaked) {
  process.exit(1);
}
console.log(
  `Client credential scan passed (${checked} generated files; no secret values printed).`,
);

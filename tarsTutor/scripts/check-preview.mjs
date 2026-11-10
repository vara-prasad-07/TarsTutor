/** HTTP-only verification of a built preview and its server-side API proxy. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv[2] || "http://127.0.0.1:4173";
let checked = 0;
for (const route of [
  "/",
  "/lesson/generating/test",
  "/lesson/test",
  "/board",
]) {
  const response = await fetch(new URL(route, base));
  const html = await response.text();
  if (!response.ok || !html.includes("TarsTutor")) {
    throw new Error(`Built route failed: ${route}`);
  }
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const asset = match[1];
    if (!asset.startsWith("/") || asset.startsWith("//")) {
      continue;
    }
    const result = await fetch(new URL(asset, base));
    if (!result.ok) {
      throw new Error(`Built asset failed: ${asset}`);
    }
    checked++;
  }
}
const speech = await fetch(new URL("/api/tutor/speech/status", base));
if (!speech.ok || !(await speech.json()).tts_configured) {
  throw new Error("Built preview speech proxy failed");
}
const folder = path.resolve(root, "../tarsBe/data/verification");
const flow = JSON.parse(
  fs.readFileSync(path.join(folder, "http-flow.json"), "utf8"),
);
const sid = new URL(flow.classroom).pathname.split("/").pop();
const lesson = await fetch(new URL(`/api/tutor/lessons/${sid}`, base));
const snapshot = await lesson.json();
if (
  !lesson.ok ||
  snapshot.status !== "completed" ||
  !snapshot.segments.length
) {
  throw new Error("Built preview lesson proxy failed");
}
const report = {
  status: "PASS",
  preview: base,
  routes: 4,
  assetRequests: checked,
  lessonProxy: true,
  speechProxy: true,
};
fs.writeFileSync(
  path.join(folder, "production-preview.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));

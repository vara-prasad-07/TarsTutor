/** Development-only render entry. Imports the actual product UI without a mock redesign. */
import { useCallback, useEffect, useState } from "react";
import { Fonts } from "@excalidraw/excalidraw/fonts";
import { FONT_FAMILY } from "@excalidraw/common";
import { Landing, Generating } from "./TarsApp";
import Classroom from "./Classroom";
import type { ClassroomProps } from "./Classroom";
import type { ClassroomWindow, LessonSnapshot, TutorAnswer } from "../../shared/classroom";
import englishData from "./demo-data/english.json";
import teluguData from "./demo-data/telugu.json";
import englishAnswer from "./demo-data/english-answer.json";
import teluguAnswer from "./demo-data/telugu-answer.json";
import teluguTranscript from "./demo-data/telugu-transcript.json";
import englishFeedback from "./demo-data/english-feedback.json";

export default function ProductDemo({ view }: { view: ClassroomWindow }) {
  const shot = new view.URLSearchParams(view.location.search).get("shot") || "home";
  const markReady = useCallback(() => {
    view.setTimeout(() => { void view.document.fonts.ready.then(() => view.parent.postMessage({ type: "tars-product-ready", shot }, "*")); }, 7500);
  }, [shot, view]);
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let alive = true;
    const faces = Fonts.registered.get(FONT_FAMILY.Excalifont)!.fontFaces;
    for (const face of faces) view.document.fonts.add(face.fontFace);
    void Promise.all(faces.map(face => face.fontFace.load())).then(() => { if (alive) setFontsReady(true); });
    return () => { alive = false; };
  }, [view]);
  useEffect(() => {
    if (!fontsReady) return;
    if (!["home", "prompt", "te-prompt", "materials", "generating"].includes(shot)) return;
    const timer = view.setTimeout(markReady, 1500);
    return () => view.clearTimeout(timer);
  }, [view, fontsReady, markReady, shot]);
  if (!fontsReady) return <div className="tars-route-loading">Loading product fonts…</div>;
  const params = new view.URLSearchParams(view.location.search);
  const language = shot.startsWith("te-") ? "te" : "en";
  const source = (language === "te" ? teluguData : englishData) as unknown as LessonSnapshot;
  // Separate render-only IDs avoid changing a student's saved classroom.
  const snapshot = { ...source, session_id: `video-render-${shot}-${params.get("capture") || "fresh"}` };
  view.localStorage.setItem("tars-theme", "light");
  const navigate = () => {};
  let ui;
  if (shot === "home" || shot === "prompt" || shot === "te-prompt" || shot === "materials") {
    ui = <Landing view={view} navigate={navigate} begin={() => {}} initialPrompt={shot === "home" ? "" : source.prompt} initialMaterials={shot === "materials" ? source.materials : []} />;
  } else if (shot === "generating") {
    const stages = snapshot.stages.map((stage, i) => ({ ...stage, status: i < 3 ? "completed" as const : i === 3 ? "active" as const : "pending" as const }));
    ui = <Generating view={view} snapshot={{ ...snapshot, stages, segments: [], generating: true, status: "generating" }} error="" prompt={snapshot.prompt} retry={navigate} cancel={navigate} navigate={navigate} />;
  } else {
    const chapter = shot.includes("prediction") ? 1 : shot.startsWith("quiz") ? snapshot.segments.length - 1 : 0;
    const progress = shot === "en-early" ? 0.1 : shot.startsWith("quiz") ? 1 : 0.97;
    view.localStorage.setItem(`tars-classroom-${snapshot.session_id}`, JSON.stringify({ segmentId: snapshot.segments[chapter].id, progress, answered: [], strokes: {}, speed: 1 }));
    const initial: ClassroomProps["initialPresentation"] = { sidebar: shot === "en-materials" || shot === "te-materials", transcript: shot === "en-transcript" || shot === "te-transcript", question: shot === "en-question" ? "What does the slope of six mean?" : shot === "te-question" ? teluguTranscript.text : "", answer: shot === "en-answer" ? englishAnswer as TutorAnswer : shot === "te-answer" ? teluguAnswer as TutorAnswer : undefined, recording: shot === "te-recording", complete: shot === "complete" };
    initial.onBoardReady = markReady;
    if (shot === "quiz-feedback") {
      initial.quizAnswer = "75";
      initial.feedback = englishFeedback;
    }
    ui = <Classroom snapshot={snapshot} view={view} onNavigate={navigate} refresh={navigate} initialPresentation={initial} />;
  }
  return ui;
}

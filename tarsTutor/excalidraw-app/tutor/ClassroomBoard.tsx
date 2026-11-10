import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import { useHandleLibrary } from "@excalidraw/excalidraw/data/library";
import {
  LibraryIndexedDBAdapter,
  LibraryLocalStorageMigrationAdapter,
} from "../data/LocalData";
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  getCommonBounds,
} from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";
import type { ExcalidrawElement } from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import type { ClassroomWindow, LessonElement } from "../../shared/classroom";
import type { TutorAnswer, WhiteboardContext } from "../../shared/classroom";
import {
  captureWhiteboardQuestion,
  questionElements,
} from "./whiteboardQuestion";
import { placeDrawingAnswer } from "./drawingAnswer";
import type { DrawingAnchor } from "./drawingAnswer";
import type { InkStroke } from "./WhiteboardView";
import {
  ClassroomBoardController,
  createClassroomBoard,
} from "./lessonBoardEngine";
import {
  readClassroomBoard,
  saveClassroomBoard,
} from "./classroomBoardStorage";
import type { SavedBoard } from "./classroomBoardStorage";
import "./classroom-board.scss";
import { useTutorTheme } from "./useTutorTheme";

export type ClassroomBoardHandle = {
  follow: () => void;
  restore: () => void;
  draw: () => void;
  capture: (signal?: AbortSignal) => Promise<WhiteboardContext | null>;
  explain: (answer: TutorAnswer, context?: WhiteboardContext | null) => void;
};
type Props = {
  sceneId: string;
  title: string;
  objective: string;
  elements: LessonElement[];
  progress: number;
  view: ClassroomWindow;
  legacyStrokes?: InkStroke[];
  onInteract: () => void;
  onToolChange: (drawing: boolean) => void;
  onReady?: () => void;
};

/** The original editor, with its complete toolbar, now lives inside the lesson. */
export default forwardRef<ClassroomBoardHandle, Props>(function ClassroomBoard(
  {
    sceneId,
    title,
    objective,
    elements,
    progress,
    view,
    legacyStrokes = [],
    onInteract,
    onToolChange,
    onReady,
  },
  ref,
) {
  const { theme, setTheme } = useTutorTheme(view);
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const controller = useRef<ClassroomBoardController | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const questionAnchor = useRef<DrawingAnchor | null>(null);
  const anchors = useRef(new WeakMap<WhiteboardContext, DrawingAnchor>());
  const followTarget = useRef<readonly [number, number, number, number]>([
    0, 0, 1000, 700,
  ]);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const [ready, setReady] = useState(false);
  const [editorAPI, setEditorAPI] = useState<ExcalidrawImperativeAPI | null>(
    null,
  );
  useHandleLibrary({
    excalidrawAPI: editorAPI,
    adapter: LibraryIndexedDBAdapter,
    migrationAdapter: LibraryLocalStorageMigrationAdapter,
  });
  const [storageError, setStorageError] = useState("");
  const latest = useRef<{
    elements: readonly ExcalidrawElement[];
    files: BinaryFiles;
    appState?: SavedBoard["appState"];
  } | null>(null);
  const restored = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const mounted = useRef(true);
  const callbacks = useRef({ onInteract, onToolChange });
  callbacks.current = { onInteract, onToolChange };
  const cues = useMemo(
    () => createClassroomBoard(sceneId, title, objective, elements),
    [sceneId, title, objective, elements],
  );

  const flush = useCallback(() => {
    if (!latest.current || !controller.current) {
      return;
    }
    const state = { ...latest.current, ...controller.current.snapshot() };
    void saveClassroomBoard(view, sceneId, state)
      .then(() => {
        if (mounted.current) {
          setStorageError("");
        }
      })
      .catch((failure: Error) => {
        if (mounted.current) {
          setStorageError(failure.message);
        }
      });
  }, [sceneId, view]);
  const initial = useMemo(
    () => async (): Promise<ExcalidrawInitialDataState> => {
      const saved = await readClassroomBoard(view, sceneId);
      restored.current = !!saved?.appState;
      controller.current = new ClassroomBoardController(
        cues,
        saved || undefined,
      );
      const migrated = saved
        ? []
        : legacyStrokes
            .filter((stroke) => stroke.points.length > 1)
            .flatMap((stroke, index) => {
              const [x, y] = stroke.points[0];
              return convertToExcalidrawElements(
                [
                  {
                    type: "line",
                    id: `${sceneId}-legacy-ink-${index}`,
                    x,
                    y,
                    points: stroke.points.map((p) =>
                      pointFrom(p[0] - x, p[1] - y),
                    ),
                    strokeColor: "#d87357",
                    strokeWidth: 2.4,
                    roughness: 0,
                  },
                ],
                { regenerateIds: false },
              );
            });
      return {
        elements: saved?.elements || migrated,
        files: saved?.files || {},
        appState: {
          currentItemStrokeColor: "#303b43",
          ...saved?.appState,
          viewBackgroundColor:
            !saved?.appState?.viewBackgroundColor ||
            saved.appState.viewBackgroundColor === "#fcfbf7"
              ? "#fafafa"
              : saved.appState.viewBackgroundColor,
        },
      };
      // Each chapter/reply mounts its own editor; the source scene is immutable.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [sceneId, view],
  );

  const follow = useCallback(() => {
    api.current?.setViewport({
      target: followTarget.current,
      fit: "scale-down",
      animation: true,
      offsets: { ui: true, top: 65, bottom: 45, left: 25, right: 25 },
    });
  }, []);
  useImperativeHandle(
    ref,
    () => ({
      follow,
      restore: () => {
        if (api.current && controller.current) {
          controller.current.restore(api.current, progressRef.current);
          follow();
        }
      },
      capture: async (signal) => {
        await new Promise<void>((resolve) =>
          view.requestAnimationFrame(() => resolve()),
        );
        const editor = api.current;
        if (!editor || !controller.current || editor.isDestroyed) {
          throw new Error(
            "The whiteboard is still loading. Try your question again in a moment.",
          );
        }
        const current = editor.getSceneElementsIncludingDeleted();
        controller.current.observe(current);
        const focused = questionElements(
          current,
          editor.getAppState().selectedElementIds,
          controller.current.snapshot().edited,
        ).elements;
        const captured = await captureWhiteboardQuestion(
          view,
          current,
          editor.getAppState(),
          editor.getFiles(),
          controller.current.snapshot().edited,
          signal,
        );
        questionAnchor.current = focused.length
          ? { ids: focused.map((e) => e.id), bounds: getCommonBounds(focused) }
          : null;
        if (captured && questionAnchor.current) {
          anchors.current.set(captured, questionAnchor.current);
        }
        return captured;
      },
      explain: (answer, context) => {
        const editor = api.current;
        if (!editor || editor.isDestroyed) {
          throw new Error("The whiteboard is not ready to draw the answer.");
        }
        const anchor = context
          ? anchors.current.get(context) || null
          : questionAnchor.current;
        const placed = placeDrawingAnswer(
          sceneId,
          answer,
          anchor,
          editor.getSceneElementsIncludingDeleted(),
        );
        if (!placed) {
          return;
        }
        editor.updateScene({
          elements: placed.elements,
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        latest.current = {
          elements: placed.elements,
          files: editor.getFiles(),
          appState: latest.current?.appState,
        };
        followTarget.current = placed.target;
        flush();
        editor.setViewport({
          target: placed.target,
          fit: "scale-down",
          animation: true,
          offsets: { ui: true, top: 65, bottom: 180, left: 30, right: 30 },
        });
      },
      draw: () => {
        const editor = api.current;
        if (!editor) {
          return;
        }
        callbacks.current.onInteract();
        editor.setActiveTool({
          type:
            editor.getAppState().activeTool.type === "freedraw"
              ? "selection"
              : "freedraw",
        });
        wrapper.current
          ?.querySelector<HTMLCanvasElement>("canvas.interactive")
          ?.focus();
      },
    }),
    [follow, view, sceneId, flush],
  );

  useEffect(() => {
    if (ready && api.current) {
      if (api.current.getAppState().viewBackgroundColor === "#fcfbf7") {
        api.current.updateScene({
          appState: { viewBackgroundColor: "#fafafa" },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }
      controller.current?.apply(api.current, progress);
    }
  }, [progress, ready]);
  useEffect(() => {
    mounted.current = true;
    view.addEventListener("pagehide", flush);
    return () => {
      mounted.current = false;
      view.clearTimeout(timer.current);
      flush();
      view.removeEventListener("pagehide", flush);
    };
  }, [flush, view]);

  const changed = useCallback(
    (
      next: readonly ExcalidrawElement[],
      state: AppState,
      files: BinaryFiles,
    ) => {
      if (!controller.current) {
        return;
      }
      controller.current.observe(next);
      latest.current = {
        elements: next,
        files,
        appState: {
          viewBackgroundColor: state.viewBackgroundColor,
          theme: state.theme,
          gridModeEnabled: state.gridModeEnabled,
          gridSize: state.gridSize,
          gridStep: state.gridStep,
          scrollX: state.scrollX,
          scrollY: state.scrollY,
          zoom: state.zoom,
        },
      };
      callbacks.current.onToolChange(state.activeTool.type === "freedraw");
      if (timer.current === undefined) {
        timer.current = view.setTimeout(() => {
          timer.current = undefined;
          flush();
        }, 1000);
      }
    },
    [flush, view],
  );
  // Audio ticks update the canvas imperatively, without rebuilding its toolbar.
  const editorUI = useMemo(
    () => (
      <Excalidraw
        theme={theme}
        onThemeChange={(next) => {
          if (next !== "system") {
            setTheme(next);
          }
        }}
        ownerDocument={view.document}
        initialData={initial}
        onInitialize={(editor) => {
          api.current = editor;
          controller.current?.apply(editor, progressRef.current);
          setReady(true);
          if (!restored.current) {
            follow();
          }
          onReady?.();
        }}
        onExcalidrawAPI={(editor) => {
          api.current = editor;
          setEditorAPI(editor);
        }}
        onChange={changed}
        handleKeyboardGlobally={false}
        name={`TarsTutor — ${title}`}
        aiEnabled={false}
        UIOptions={{
          tools: { image: true },
        }}
      >
        <MainMenu>
          <MainMenu.DefaultItems.LoadScene />
          <MainMenu.DefaultItems.SaveToActiveFile />
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.CommandPalette />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Preferences />
          <MainMenu.DefaultItems.ToggleTheme allowSystemTheme={false} />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
          <MainMenu.Separator />
          <MainMenu.Item
            onSelect={() => {
              const editor = api.current;
              if (editor) {
                controller.current?.restore(editor, progressRef.current);
                follow();
              }
            }}
          >
            Restore tutor drawing
          </MainMenu.Item>
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.DefaultItems.Help />
        </MainMenu>
      </Excalidraw>
    ),
    [view, initial, changed, follow, title, theme, setTheme, onReady],
  );
  return (
    <div
      ref={wrapper}
      className="tc-native-board"
      role="region"
      aria-label={`${title}. Interactive lesson whiteboard`}
      onPointerDownCapture={() => callbacks.current.onInteract()}
      onKeyDownCapture={(event) => {
        if (!["Tab", "Shift", "Control", "Alt", "Meta"].includes(event.key)) {
          callbacks.current.onInteract();
        }
      }}
    >
      {editorUI}
      {storageError && (
        <div className="tc-board-storage-error" role="status">
          {storageError}
        </div>
      )}
      {!ready && (
        <div className="tc-board-loading" role="status">
          Opening whiteboard tools…
        </div>
      )}
    </div>
  );
});

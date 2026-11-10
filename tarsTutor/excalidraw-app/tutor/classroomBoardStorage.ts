import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ClassroomWindow } from "../../shared/classroom";
import type { BoardOverrides } from "./lessonBoardEngine";

export type SavedBoard = BoardOverrides & {
  elements: readonly ExcalidrawElement[];
  files: BinaryFiles;
  appState?: Pick<
    AppState,
    | "viewBackgroundColor"
    | "gridModeEnabled"
    | "gridSize"
    | "gridStep"
    | "scrollX"
    | "scrollY"
    | "zoom"
    | "theme"
  >;
};
const connections = new WeakMap<ClassroomWindow, Promise<IDBDatabase>>();
function database(view: ClassroomWindow) {
  let existing = connections.get(view);
  if (existing) {
    return existing;
  }
  existing = new Promise<IDBDatabase>((resolve, reject) => {
    if (!view.indexedDB) {
      reject(new Error("Board storage is unavailable."));
      return;
    }
    const request = view.indexedDB.open("tars-classroom-whiteboards", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("boards");
    request.onsuccess = () => {
      const db = request.result;
      const forget = () => {
        if (connections.get(view) === existing) {
          connections.delete(view);
        }
      };
      db.onclose = forget;
      db.onversionchange = () => {
        forget();
        db.close();
      };
      resolve(db);
    };
    request.onerror = () => {
      if (connections.get(view) === existing) {
        connections.delete(view);
      }
      reject(new Error("Board storage could not be opened."));
    };
  });
  connections.set(view, existing);
  return existing;
}
async function withConnection<T>(
  view: ClassroomWindow,
  action: (db: IDBDatabase) => Promise<T>,
  retried = false,
): Promise<T> {
  const db = await database(view);
  try {
    return await action(db);
  } catch (error) {
    if (
      !retried &&
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "InvalidStateError"
    ) {
      connections.delete(view);
      db.close();
      return withConnection(view, action, true);
    }
    throw error;
  }
}
export async function readClassroomBoard(
  view: ClassroomWindow,
  id: string,
): Promise<SavedBoard | null> {
  try {
    return await withConnection<SavedBoard | null>(
      view,
      (db) =>
        new Promise((resolve, reject) => {
          const request = db
            .transaction("boards", "readonly")
            .objectStore("boards")
            .get(id);
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error);
        }),
    );
  } catch {
    return null;
  }
}
export async function saveClassroomBoard(
  view: ClassroomWindow,
  id: string,
  data: SavedBoard,
): Promise<void> {
  await withConnection(
    view,
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction("boards", "readwrite");
        tx.objectStore("boards").put(data, id);
        tx.oncomplete = () => resolve();
        tx.onerror = () =>
          reject(
            new Error(
              "Whiteboard edits could not be saved. Download your board to keep a copy.",
            ),
          );
        tx.onabort = () =>
          reject(
            new Error(
              "Whiteboard storage is full. Download your board to keep a copy.",
            ),
          );
      }),
  );
}

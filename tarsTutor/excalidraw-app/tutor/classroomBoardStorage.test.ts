import { describe, expect, it, vi } from "vitest";
import { convertToExcalidrawElements } from "@excalidraw/element";
import type { BinaryFiles, DataURL } from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/element/types";
import {
  readClassroomBoard,
  saveClassroomBoard,
} from "./classroomBoardStorage";

describe("classroom board persistence", () => {
  it("reopens a closing cached connection without losing the board update", async () => {
    const data = { elements: [], files: {}, edited: [], baseline: [] };
    await saveClassroomBoard(window, "initial-connection", data);
    const transaction = vi
      .spyOn(window.IDBDatabase.prototype, "transaction")
      .mockImplementationOnce(() => {
        throw new window.DOMException(
          "The database connection is closing.",
          "InvalidStateError",
        );
      });
    try {
      await saveClassroomBoard(window, "reconnected-board", data);
      expect(await readClassroomBoard(window, "reconnected-board")).toEqual(
        data,
      );
      expect(transaction.mock.calls.length).toBeGreaterThanOrEqual(3);
    } finally {
      transaction.mockRestore();
    }
  });
  it("saves native edits, image bytes and override metadata separately for each chapter", async () => {
    const elements = convertToExcalidrawElements(
      [
        {
          type: "text",
          id: "my-note",
          x: 20,
          y: 30,
          text: "My own explanation",
        },
      ],
      { regenerateIds: false },
    );
    const files: BinaryFiles = {
      "image-file": {
        id: "image-file" as FileId,
        mimeType: "image/png",
        dataURL: "data:image/png;base64,aGVsbG8=" as DataURL,
        created: 1,
      },
    };
    const data = {
      elements,
      files,
      edited: ["tutor-text"],
      baseline: [["tutor-text", 12] as [string, number]],
    };
    await saveClassroomBoard(window, "storage-chapter-one", data);
    expect(await readClassroomBoard(window, "storage-chapter-one")).toEqual(
      data,
    );
    expect(await readClassroomBoard(window, "storage-chapter-two")).toBeNull();
  });
});

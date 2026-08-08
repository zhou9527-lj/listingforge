import { describe, expect, it } from "vitest";
import { loadCanvasDocumentRecord, loadPersistedTasks, loadUiSettings, saveCanvasDocumentRecord, saveUiSettings, updatePersistedTask } from "../lib/database";

describe("local database boundary", () => {
  it("does not open SQLite in a browser-only preview", async () => {
    await expect(loadPersistedTasks()).resolves.toEqual([]);
    await expect(loadUiSettings()).resolves.toBeNull();
    await expect(loadCanvasDocumentRecord("poster")).resolves.toBeNull();
  });

  it("treats browser persistence calls as no-ops", async () => {
    await expect(saveUiSettings({ theme: "dark", locale: "zh-CN" })).resolves.toBeUndefined();
    await expect(updatePersistedTask("missing", { progress: 10 })).resolves.toBeUndefined();
    await expect(saveCanvasDocumentRecord("poster", "{}", 1000, 1000)).resolves.toBeUndefined();
  });
});

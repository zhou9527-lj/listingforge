import { describe, expect, it } from "vitest";
import { loadCanvasDocumentRecord, loadPersistedTasks, loadUiSettings, saveCanvasDocumentRecord, saveTaskRecord, saveUiSettings, updatePersistedTask } from "../lib/database";

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

  it("skips single-task persistence without a database", async () => {
    await expect(saveTaskRecord({
      id: "task-1",
      providerTaskId: "provider-task-1",
      title: "局部编辑 · 测试",
      provider: "GPT-Image-2",
      status: "queued",
      progress: 0,
      cost: "待结算",
      elapsed: "00:00:00",
      project: "当前项目",
    })).resolves.toBeUndefined();
  });
});

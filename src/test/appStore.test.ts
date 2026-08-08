import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../store/appStore";
import type { TaskItem } from "../types";

describe("app store", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState(useAppStore.getInitialState(), true);
  });

  it("keeps generation count within the supported range", () => {
    const typeId = useAppStore.getState().generationTypes[0].id;

    useAppStore.getState().setGenerationCount(typeId, 0);
    expect(useAppStore.getState().generationTypes[0].count).toBe(1);

    useAppStore.getState().setGenerationCount(typeId, 9);
    expect(useAppStore.getState().generationTypes[0].count).toBe(4);
  });

  it("adds a submitted task and applies provider progress updates", () => {
    const task: TaskItem = {
      id: "task-test",
      providerTaskId: "provider-123",
      title: "Test image",
      project: "Current project",
      provider: "GPT-Image-2",
      status: "queued",
      progress: 0,
      cost: "Pending",
      elapsed: "00:00:00",
    };

    useAppStore.getState().addTasks([task]);
    useAppStore.getState().updateTask(task.id, { status: "running", progress: 42 });

    expect(useAppStore.getState().tasks[0]).toMatchObject({
      id: task.id,
      providerTaskId: task.providerTaskId,
      status: "running",
      progress: 42,
    });
  });
});

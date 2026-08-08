import { describe, expect, it } from "vitest";
import { mapRemoteTaskStatus } from "../lib/taskPolling";

const current = { status: "running" as const, progress: 40, cost: "待结算" };

describe("task polling status mapping", () => {
  it("maps completed with a result URL", () => {
    const patch = mapRemoteTaskStatus(
      { status: "completed", progress: 100, cost: 0.05279, result: { images: [{ url: ["https://cdn.example/a.png"] }] } },
      current,
    );
    expect(patch.status).toBe("completed");
    expect(patch.progress).toBe(100);
    expect(patch.cost).toBe("¥0.0528");
    expect(patch.resultUrl).toBe("https://cdn.example/a.png");
  });

  it("maps failed with an error message", () => {
    const patch = mapRemoteTaskStatus({ status: "failed", error: { message: "内容审核未通过" } }, current);
    expect(patch.status).toBe("failed");
    expect(patch.error).toBe("内容审核未通过");
  });

  it("maps processing to running and keeps current progress when absent", () => {
    const patch = mapRemoteTaskStatus({ status: "processing" }, current);
    expect(patch.status).toBe("running");
    expect(patch.progress).toBe(40);
  });

  it("treats unknown status as queued without a result URL", () => {
    const patch = mapRemoteTaskStatus({ status: "submitted" }, current);
    expect(patch.status).toBe("queued");
    expect(patch.resultUrl).toBeUndefined();
  });

  it("keeps the previous cost label when the cloud cost is missing", () => {
    const patch = mapRemoteTaskStatus({ status: "completed" }, { status: "running", progress: 90, cost: "待结算" });
    expect(patch.cost).toBe("待结算");
  });
});

import { describe, expect, it } from "vitest";
import { estimateUnitPrice, formatYuan, parseCostValue } from "../lib/billing";
import type { TaskItem } from "../types";

const baseTask: TaskItem = {
  id: "t1",
  title: "白底主图",
  project: "示例项目",
  provider: "APIMart",
  dimensions: "1024x1024",
  progress: 100,
  status: "completed",
  cost: "",
  elapsed: "00:00:30",
};

describe("parseCostValue", () => {
  it("解析 ¥ 前缀数值", () => {
    expect(parseCostValue("¥0.1234")).toBe(0.1234);
    expect(parseCostValue("¥ 0.5")).toBe(0.5);
    expect(parseCostValue("¥12.34")).toBe(12.34);
  });

  it("无法解析时返回 null", () => {
    expect(parseCostValue("待结算")).toBeNull();
    expect(parseCostValue("本地")).toBeNull();
    expect(parseCostValue("")).toBeNull();
  });
});

describe("estimateUnitPrice", () => {
  it("只统计已完成任务的实际扣费均值", () => {
    const tasks: TaskItem[] = [
      { ...baseTask, cost: "¥0.1" },
      { ...baseTask, id: "t2", cost: "¥0.3" },
      { ...baseTask, id: "t3", status: "running", cost: "¥5" },
      { ...baseTask, id: "t4", status: "failed", cost: "¥9" },
      { ...baseTask, id: "t5", status: "completed", cost: "待结算" },
    ];
    expect(estimateUnitPrice(tasks)).toBeCloseTo(0.2, 10);
  });

  it("没有已完成扣费数据时返回 null", () => {
    expect(estimateUnitPrice([])).toBeNull();
    expect(estimateUnitPrice([{ ...baseTask, status: "queued", cost: "待结算" }])).toBeNull();
  });
});

describe("formatYuan", () => {
  it("按 4 位小数格式化", () => {
    expect(formatYuan(0.12345)).toBe("¥0.1235");
    expect(formatYuan(12.3)).toBe("¥12.3000");
  });
});

import type { TaskItem } from "../types";

/** 把任务消耗标签解析为数值（"¥0.1234" → 0.1234）；无法解析时返回 null。 */
export const parseCostValue = (costLabel: string): number | null => {
  const match = /¥\s*([0-9]+(?:\.[0-9]+)?)/.exec(costLabel);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
};

/** 按实际扣费回推单张单价：已完成任务的费用均值；无数据时返回 null。 */
export const estimateUnitPrice = (tasks: TaskItem[]): number | null => {
  const paid = tasks
    .filter((task) => task.status === "completed")
    .map((task) => parseCostValue(task.cost))
    .filter((value): value is number => value !== null && value > 0);
  if (paid.length === 0) return null;
  const total = paid.reduce((sum, value) => sum + value, 0);
  return total / paid.length;
};

export const formatYuan = (value: number, digits = 4) => `¥${value.toFixed(digits)}`;

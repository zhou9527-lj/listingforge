import type { TaskStatus } from "../types";

export interface RemoteTaskData {
  status?: string;
  progress?: number;
  cost?: number;
  error?: { message?: string };
  result?: { images?: Array<{ url?: string[] }> };
}

/** 把 APIMart 任务查询结果映射为本地任务补丁（纯函数，供任务中心轮询复用）。 */
export const mapRemoteTaskStatus = (
  data: RemoteTaskData,
  current: { status: TaskStatus; progress: number; cost: string },
): { status: TaskStatus; progress: number; cost: string; error?: string; resultUrl?: string } => {
  const status: TaskStatus =
    data.status === "completed" ? "completed"
    : data.status === "failed" ? "failed"
    : data.status === "processing" ? "running"
    : "queued";
  const remoteUrl = data.result?.images?.[0]?.url?.[0];
  return {
    status,
    progress: data.progress ?? current.progress,
    cost: typeof data.cost === "number" ? `¥${data.cost.toFixed(4)}` : current.cost,
    error: data.error?.message,
    resultUrl: remoteUrl,
  };
};

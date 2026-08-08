export type ScreenId = "projects" | "materials" | "generate" | "results" | "canvas" | "tasks" | "settings";

export type ThemeMode = "dark" | "light";
export type LocaleCode = "zh-CN" | "en";
export type TaskStatus = "running" | "analyzing" | "queued" | "local" | "completed" | "failed";
export type ProviderId = "apimart" | "deepseek" | "qwen";

export interface MaterialAsset {
  id: string;
  name: string;
  role: "product" | "logo" | "package" | "detail";
  src: string;
}

export interface GenerationType {
  id: string;
  label: string;
  ratio: "1:1" | "3:4" | "4:3" | "9:16";
  selected: boolean;
  count: number;
  preview: string;
}

export interface ResultItem {
  id: string;
  type: "white" | "scene" | "poster" | "detail";
  label: string;
  ratio: "1:1" | "3:4";
  src: string;
  selected?: boolean;
  favorite?: boolean;
  needsReview?: boolean;
}

export interface TaskItem {
  id: string;
  title: string;
  dimensions?: string;
  project: string;
  provider: string;
  status: TaskStatus;
  progress: number;
  cost: string;
  elapsed: string;
  thumbnail?: string;
  error?: string;
  providerTaskId?: string;
  resultUrl?: string;
}

export interface ProviderTestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
  balance?: number | null;
}

export interface SecretStatus {
  configured: boolean;
  maskedKey: string;
}

export interface ImageGenerationRequest {
  prompt: string;
  size: string;
  resolution: "1k" | "2k" | "4k";
  imageUrls: string[];
}

export interface ImageTaskSubmission {
  taskId: string;
  status: string;
}

export interface ApiProviderConfig {
  id: ProviderId;
  title: string;
  model: string;
  endpoint: string;
  maskedKey: string;
  status: "connected" | "untested" | "testing" | "failed";
}

export interface CanvasLayer {
  id: string;
  name: string;
  kind: "text" | "tag" | "image" | "light" | "background";
  visible: boolean;
  locked: boolean;
}

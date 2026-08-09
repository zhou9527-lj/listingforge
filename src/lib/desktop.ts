import type {
  ImageGenerationRequest,
  ImageTaskSubmission,
  ProviderId,
  ProviderTestResult,
  SecretStatus,
} from "../types";

export const hasTauriRuntime = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Tauri invoke 会直接 reject 字符串；统一保留后端给出的可操作错误信息。 */
export function desktopErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return fallback;
}

export async function windowAction(action: "minimize" | "toggleMaximize" | "close") {
  if (!hasTauriRuntime()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const appWindow = getCurrentWindow();
  if (action === "minimize") await appWindow.minimize();
  if (action === "toggleMaximize") await appWindow.toggleMaximize();
  if (action === "close") await appWindow.close();
}

export async function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasTauriRuntime()) throw new Error("该功能只能在 ListingForge 桌面应用中使用");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export const testApiProvider = (provider: ProviderId) =>
  invokeDesktop<ProviderTestResult>("test_api_provider", { provider });

export const saveApiSecret = (provider: ProviderId, secret: string) =>
  invokeDesktop<string>("save_api_secret", { provider, secret });

export const getApiSecretStatus = (provider: ProviderId) =>
  hasTauriRuntime()
    ? invokeDesktop<SecretStatus>("get_api_secret_status", { provider })
    : Promise.resolve({ configured: false, maskedKey: "" });

export const submitImageGeneration = (request: ImageGenerationRequest) =>
  invokeDesktop<ImageTaskSubmission>("submit_image_generation", { request });

export const getImageTask = (taskId: string) =>
  invokeDesktop<Record<string, unknown>>("get_image_task", { taskId });

export const downloadTaskResult = (taskId: string, url: string, projectPath: string) =>
  invokeDesktop<{ localPath: string; fileName: string; sizeBytes: number }>("download_task_result", { taskId, url, projectPath });

export const resolveDefaultProject = (parentPath: string) =>
  invokeDesktop<string>("resolve_default_project", { parentPath });

export const createProjectDirectory = (parentPath: string, name: string, platform: string, category: string) =>
  invokeDesktop<{ id: string; path: string }>("create_project", { request: { parentPath, name, platform, category } });

export const updateProjectManifest = (projectPath: string, name: string) =>
  invokeDesktop<string>("update_project_manifest", { projectPath, name });

export const deleteProjectDirectory = (projectPath: string) =>
  invokeDesktop<void>("delete_project_directory", { projectPath });

export const importAsset = (projectPath: string, sourcePath: string, role: string) =>
  invokeDesktop<{ path: string; sha256: string; mime: string }>("import_asset", { projectPath, sourcePath, role });

export const importGlobalAsset = (sourcePath: string) =>
  invokeDesktop<{ path: string; sha256: string; mime: string }>("import_global_asset", { sourcePath });

export const deleteGlobalAssetFile = (assetPath: string) =>
  invokeDesktop<void>("delete_global_asset_file", { assetPath });

export const deleteProjectResultFile = (projectPath: string, filePath: string) =>
  invokeDesktop<void>("delete_project_result_file", { projectPath, filePath });

export const segmentImage = (projectPath: string, imagePath: string) =>
  invokeDesktop<{ outputPath: string; width: number; height: number; modelSha256: string }>("segment_image", { projectPath, imagePath });

export const runDeepSeekAgent = (system: string, user: string) =>
  invokeDesktop<Record<string, unknown>>("run_deepseek_agent", { request: { system, user, history: [] } });

export interface AgentStreamEvent {
  event: "delta" | "usage" | "done" | "stopped";
  delta?: string | null;
  message?: string | null;
  usage?: Record<string, unknown> | null;
}

export const streamDeepSeekAgent = async (
  system: string,
  user: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  requestId: string,
  onMessage: (event: AgentStreamEvent) => void,
) => {
  if (!hasTauriRuntime()) throw new Error("该功能只能在 ListingForge 桌面应用中使用");
  const { Channel } = await import("@tauri-apps/api/core");
  const onEvent = new Channel<AgentStreamEvent>();
  onEvent.onmessage = onMessage;
  return invokeDesktop<void>("stream_deepseek_agent", { request: { system, user, history }, requestId, onEvent });
};

export const cancelDeepSeekAgent = (requestId: string) =>
  invokeDesktop<void>("cancel_deepseek_agent", { requestId });

export const analyzeProduct = (imageDataUrl: string, instructions: string) =>
  invokeDesktop<Record<string, unknown>>("analyze_product", { request: { imageDataUrl, instructions } });

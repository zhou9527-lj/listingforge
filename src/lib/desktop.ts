import type {
  ImageGenerationRequest,
  ImageTaskSubmission,
  ProviderId,
  ProviderTestResult,
  SecretStatus,
} from "../types";

export const hasTauriRuntime = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

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

export const segmentImage = (projectPath: string, imagePath: string) =>
  invokeDesktop<{ outputPath: string; width: number; height: number; modelSha256: string }>("segment_image", { projectPath, imagePath });

export const runDeepSeekAgent = (system: string, user: string) =>
  invokeDesktop<Record<string, unknown>>("run_deepseek_agent", { request: { system, user } });

export const analyzeProduct = (imageDataUrl: string, instructions: string) =>
  invokeDesktop<Record<string, unknown>>("analyze_product", { request: { imageDataUrl, instructions } });

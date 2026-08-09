import type { ApiProviderConfig, GenerationType } from "../types";

/**
 * 默认应用配置（无任何演示图片/任务/结果）。
 * 图片素材一律来自用户导入；任务与结果全部来自 SQLite 真实记录。
 */
export const generationTypes: GenerationType[] = [
  { id: "white", label: "白底主图", ratio: "1:1", selected: true, count: 1 },
  { id: "scene", label: "场景主图", ratio: "1:1", selected: true, count: 1 },
  { id: "poster", label: "卖点海报", ratio: "3:4", selected: true, count: 1 },
  { id: "detail", label: "细节长图", ratio: "3:4", selected: true, count: 1 },
];

export const apiProviders: ApiProviderConfig[] = [
  { id: "apimart", title: "图像生成 · APIMart", model: "gpt-image-2", endpoint: "https://api.apimart.ai/v1", maskedKey: "", status: "untested" },
  { id: "deepseek", title: "Agent · DeepSeek", model: "deepseek-v4-flash", endpoint: "https://api.deepseek.com", maskedKey: "", status: "untested" },
  { id: "qwen", title: "视觉理解 · 通义千问", model: "qwen3.6-flash", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1", maskedKey: "", status: "untested" },
];

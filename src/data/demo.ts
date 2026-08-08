import type { ApiProviderConfig, CanvasLayer, GenerationType, MaterialAsset, ResultItem, TaskItem } from "../types";

export const demoAssets = {
  white: "/assets/demo/product-white.png",
  lifestyle: "/assets/demo/product-lifestyle-orange.png",
  poster: "/assets/demo/product-poster.png",
  posterBackground: "/assets/demo/product-poster-background.png",
  detail: "/assets/demo/product-detail-blade.png",
} as const;

export const materialAssets: MaterialAsset[] = [
  { id: "main", name: "主产品图", role: "product", src: demoAssets.white },
  { id: "package-a", name: "包装正面", role: "package", src: demoAssets.poster },
  { id: "package-b", name: "包装背面", role: "package", src: demoAssets.detail },
  { id: "detail-a", name: "刀片细节", role: "detail", src: demoAssets.detail },
  { id: "detail-b", name: "杯盖与提绳", role: "detail", src: demoAssets.white },
  { id: "detail-c", name: "使用场景", role: "detail", src: demoAssets.lifestyle },
];

export const generationTypes: GenerationType[] = [
  { id: "white", label: "白底主图", ratio: "1:1", selected: true, count: 1, preview: demoAssets.white },
  { id: "scene", label: "场景主图", ratio: "1:1", selected: true, count: 1, preview: demoAssets.lifestyle },
  { id: "poster", label: "卖点海报", ratio: "3:4", selected: true, count: 1, preview: demoAssets.poster },
  { id: "detail", label: "细节长图", ratio: "3:4", selected: true, count: 1, preview: demoAssets.detail },
];

export const resultItems: ResultItem[] = [
  { id: "white-1", type: "white", label: "白底主图", ratio: "1:1", src: demoAssets.white, selected: true },
  { id: "scene-1", type: "scene", label: "场景主图", ratio: "1:1", src: demoAssets.lifestyle },
  { id: "poster-1", type: "poster", label: "卖点海报", ratio: "3:4", src: demoAssets.poster, selected: true, needsReview: true },
  { id: "detail-1", type: "detail", label: "细节长图", ratio: "3:4", src: demoAssets.detail },
  { id: "scene-2", type: "scene", label: "场景主图", ratio: "1:1", src: demoAssets.lifestyle, favorite: true },
  { id: "poster-2", type: "poster", label: "卖点海报", ratio: "3:4", src: demoAssets.poster },
  { id: "detail-2", type: "detail", label: "细节长图", ratio: "3:4", src: demoAssets.detail },
  { id: "white-2", type: "white", label: "白底主图", ratio: "1:1", src: demoAssets.white },
];

export const taskItems: TaskItem[] = [
  { id: "task-1", title: "场景主图 · 第 2/2 张", dimensions: "1920 × 1920", project: "便携榨汁杯", provider: "GPT-Image-2", status: "running", progress: 68, cost: "¥0.82", elapsed: "00:01:24", thumbnail: demoAssets.lifestyle },
  { id: "task-2", title: "卖点海报 · 文字修复", dimensions: "1080 × 1440", project: "便携榨汁杯", provider: "GPT-Image-2", status: "running", progress: 31, cost: "¥0.56", elapsed: "00:00:51", thumbnail: demoAssets.poster },
  { id: "task-3", title: "商品理解与卖点", project: "护肤精华液", provider: "qwen3.6-flash + deepseek-v4-flash", status: "analyzing", progress: 74, cost: "¥0.38", elapsed: "00:00:38" },
  { id: "task-4", title: "白底主图 · 本地抠图", dimensions: "2000 × 2000", project: "家用收纳盒", provider: "U²-Net ONNX", status: "queued", progress: 0, cost: "本地", elapsed: "—", thumbnail: demoAssets.white },
  { id: "task-5", title: "详情长图导出", dimensions: "800 × 3200", project: "便携榨汁杯", provider: "本地渲染", status: "completed", progress: 100, cost: "本地", elapsed: "00:01:02", thumbnail: demoAssets.poster },
  { id: "task-6", title: "场景主图 · 第 1/1 张", dimensions: "1920 × 1920", project: "便携榨汁杯", provider: "GPT-Image-2", status: "failed", progress: 0, cost: "¥0.00", elapsed: "00:01:17", thumbnail: demoAssets.lifestyle, error: "API 请求超时" },
];

export const apiProviders: ApiProviderConfig[] = [
  { id: "apimart", title: "图像生成 · APIMart", model: "gpt-image-2", endpoint: "https://api.apimart.ai/v1", maskedKey: "apimart-••••••••••••7K2", status: "connected" },
  { id: "deepseek", title: "Agent · DeepSeek", model: "deepseek-v4-flash", endpoint: "https://api.deepseek.com", maskedKey: "deepseek-••••••••••••9H3", status: "connected" },
  { id: "qwen", title: "视觉理解 · 通义千问", model: "qwen3.6-flash", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1", maskedKey: "", status: "untested" },
];

export const canvasLayers: CanvasLayer[] = [
  { id: "headline", name: "卖点文案", kind: "text", visible: true, locked: false },
  { id: "features", name: "参数标签", kind: "tag", visible: true, locked: false },
  { id: "product", name: "产品主体", kind: "image", visible: true, locked: true },
  { id: "orange", name: "橙子前景", kind: "image", visible: true, locked: true },
  { id: "lighting", name: "光影", kind: "light", visible: true, locked: true },
  { id: "background", name: "背景", kind: "background", visible: true, locked: true },
];


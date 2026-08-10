import type { ApiProviderConfig, GenerationType } from "../types";

/**
 * 默认应用配置（无任何演示图片/任务/结果）。
 * 图片素材一律来自用户导入；任务与结果全部来自 SQLite 真实记录。
 */
export const generationTypes: GenerationType[] = [
  {
    id: "white",
    label: "白底主图",
    ratio: "1:1",
    selected: true,
    count: 1,
    purpose: "电商白底展示主图：纯白背景上完整展示商品主体，用于平台主图位",
    promptRequirements: "纯白背景（#FFFFFF）无阴影或极淡接触阴影；商品居中完整可见、边缘不被裁切；顶部预留约 10% 安全边距；构图端正平视或轻微俯视；光线均匀、无强烈反光；不生成任何文字、水印或装饰物",
  },
  {
    id: "scene",
    label: "场景主图",
    ratio: "1:1",
    selected: true,
    count: 1,
    purpose: "使用场景氛围主图：把商品放入典型使用场景，突出使用情境与生活感",
    promptRequirements: "场景与商品品类/卖点匹配；商品主体完整清晰、约占画面 50-70% 且位于视觉中心；前景背景适度虚化突出商品；自然光或氛围光；画面干净无杂乱杂物；不生成画内文字",
  },
  {
    id: "poster",
    label: "卖点海报",
    ratio: "3:4",
    selected: true,
    count: 1,
    purpose: "竖版卖点海报：突出核心卖点与商品造型，供详情页/活动页使用",
    promptRequirements: "商品为主体；顶部与底部各留 20-30% 纯净留白区供后续排版（绝对不生成文字）；主体可呈 45° 或动态角度、构图有张力；背景用品牌色渐变或氛围色块；侧光/轮廓光塑造立体感；不生成画内文字",
  },
  {
    id: "detail",
    label: "细节长图",
    ratio: "3:4",
    selected: true,
    count: 1,
    purpose: "详情页竖长图：按多个卖点分区块展示商品细节，每区可独立切分",
    promptRequirements: "竖长幅面；按卖点分区排布（每区一个细节特写 + 大面积留白，区块之间留白均匀、可独立切分）；细节特写清晰（材质/纹理/工艺）；全图风格统一、色调一致；不生成画内文字",
  },
];

export const apiProviders: ApiProviderConfig[] = [
  { id: "apimart", title: "图像生成 · APIMart", model: "gpt-image-2", endpoint: "https://api.apimart.ai/v1", maskedKey: "", status: "untested" },
  { id: "deepseek", title: "Agent · DeepSeek", model: "deepseek-v4-flash", endpoint: "https://api.deepseek.com", maskedKey: "", status: "untested" },
  { id: "qwen", title: "视觉理解 · 通义千问", model: "qwen3.6-flash", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1", maskedKey: "", status: "untested" },
];

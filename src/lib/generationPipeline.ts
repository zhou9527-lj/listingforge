import { analyzeProduct, runDeepSeekAgent, submitImageGeneration } from "./desktop";
import type { GenerationType, TaskItem } from "../types";
import { createId } from "./ids";

interface PipelineInput {
  imageDataUrl: string;
  referenceImageDataUrls?: string[];
  platform: string;
  category: string;
  customBrief?: string;
  types: GenerationType[];
  targetDimensions?: Record<string, string>;
  concurrency: number;
  resolution: "1k" | "2k" | "4k";
}

interface PlannedPrompt {
  typeId: string;
  prompt: string;
}

export const readChatContent = (response: Record<string, unknown>) => {
  const choices = response.choices;
  if (!Array.isArray(choices)) throw new Error("模型未返回可用内容");
  const message = (choices[0] as { message?: { content?: unknown } } | undefined)?.message;
  if (typeof message?.content !== "string" || !message.content.trim()) throw new Error("模型返回内容为空");
  return message.content;
};

export const parseJson = <T>(value: string): T => {
  const normalized = value.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  return JSON.parse(normalized) as T;
};

const sizeForRatio = (ratio: GenerationType["ratio"]) => ratio;

export async function runGenerationPipeline(input: PipelineInput): Promise<TaskItem[]> {
  const profileResponse = await analyzeProduct(
    input.imageDataUrl,
    "你是电商商品视觉分析模型。仔细观察商品图片，只输出严格 JSON（不要输出任何 JSON 以外的文字）：" +
      "{\"category\":\"商品品类\",\"materials\":[\"材质，按可见程度排列\"],\"colors\":{\"primary\":\"主色（具体色名+近似HEX）\",\"secondary\":[\"辅色（具体色名+近似HEX）\"]},\"structure\":\"结构描述：部件构成、相对位置、形状轮廓、比例关系\",\"visibleText\":[\"画面中可见的文字/商标/Logo，逐字摘录\"],\"logoPosition\":\"商标/Logo 的位置与形态描述，无则 null\",\"sellingPoints\":[\"核心卖点\"],\"risks\":[\"生成时容易出错的点：复杂纹理、渐变、反光、镂空、商标变形等\"],\"consistencyAnchors\":[\"保持商品一致性的关键锚点，每条必须具体：颜色值、结构特征、商标位置、材质特性\"]}" +
      "只基于图片可见信息，不虚构不可见参数；不确定的字段写 null 而不是猜测。",
  );
  const profile = readChatContent(profileResponse);

  const selected = input.types.filter((type) => type.selected);
  const planResponse = await runDeepSeekAgent(
    "你是电商视觉规划 Agent，为 gpt-image-2 输出提示词。输入包含：平台、品类、商品视觉档案 productProfile（JSON 文本）和已选图片类型 selectedTypes（含 purpose 与 promptRequirements）。输出严格 JSON：{\"prompts\":[{\"typeId\":\"...\",\"prompt\":\"...\"}]}。规则：" +
      "1）每个已选 typeId 必须恰好出现一次。" +
      "2）一致性锚点：从 productProfile 的 consistencyAnchors/colors/structure/logoPosition 提取，在每条 prompt 开头完整重申商品结构、部件形态、商标位置与样式、主色与辅色（用档案中的具体色名或近似 HEX，禁止泛化词）；禁止改变商品颜色、结构、商标，禁止添加商品上没有的部件。" +
      "3）每条 prompt 按固定结构组织：[主体与一致性锚点] + [场景与背景] + [光线与材质] + [构图与镜头] + [风格基线] + [负面约束]。" +
      "4）风格与构图基线：依据该类型的 purpose 与 promptRequirements 确定构图类型（居中/三分法/俯拍/平拍/45° 等）、镜头距离（特写/近景/中景）、光线方向（柔光棚拍/侧逆光/窗光等）、背景基调（纯色/场景/渐变等）；同一批次所有 prompt 的摄影语言必须保持同一风格基线。" +
      "5）负面约束（每条 prompt 末尾）：不生成任何画内文字、商标以外的字母、水印或乱码；不改变商品原色与结构；不生成畸形商品、多余物品或遮挡商品的元素。" +
      "6）prompt 用简洁英文书写，商品名与关键材质中英双写；不使用任何密钥、URL 或本地路径。",
    JSON.stringify({
      platform: input.platform,
      category: input.category,
      customBrief: input.customBrief?.trim() || undefined,
      productProfile: profile,
      referenceImageCount: input.referenceImageDataUrls?.length ?? 0,
      selectedTypes: selected.map(({ id, label, ratio, purpose, promptRequirements }) => ({
        id,
        label,
        ratio,
        purpose,
        promptRequirements,
      })),
    }),
  );
  const plan = parseJson<{ prompts: PlannedPrompt[] }>(readChatContent(planResponse));
  if (!Array.isArray(plan.prompts)) throw new Error("Agent 生成方案格式无效");

  const queue = selected.flatMap((type) => {
    const planned = plan.prompts.find((item) => item.typeId === type.id);
    if (!planned?.prompt) throw new Error(`Agent 缺少 ${type.label} 的提示词`);
    return Array.from({ length: type.count }, (_, index) => ({ type, prompt: planned.prompt, index }));
  });

  const tasks: TaskItem[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(input.concurrency, 1), 4, queue.length) }, async () => {
    while (cursor < queue.length) {
      const item = queue[cursor++];
      const submission = await submitImageGeneration({
        prompt: item.prompt,
        size: sizeForRatio(item.type.ratio),
        resolution: input.resolution,
        imageUrls: [input.imageDataUrl, ...(input.referenceImageDataUrls ?? [])],
      });
      tasks.push({
        id: createId(),
        providerTaskId: submission.taskId,
        title: `${item.type.label} · 第 ${item.index + 1}/${item.type.count} 张`,
        dimensions: input.targetDimensions?.[item.type.id],
        project: "当前项目",
        provider: "GPT-Image-2",
        status: "queued",
        progress: 0,
        cost: "待结算",
        elapsed: "00:00:00",
      });
    }
  });
  await Promise.all(workers);
  return tasks;
}

export const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error("读取图片失败"));
  reader.readAsDataURL(file);
});

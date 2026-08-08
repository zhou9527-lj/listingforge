import { analyzeProduct, runDeepSeekAgent, submitImageGeneration } from "./desktop";
import type { GenerationType, TaskItem } from "../types";

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
    "分析商品品类、材质、颜色、结构、可见文字、核心卖点和风险点。只返回 JSON，不虚构不可见参数。",
  );
  const profile = readChatContent(profileResponse);

  const selected = input.types.filter((type) => type.selected);
  const planResponse = await runDeepSeekAgent(
    "你是电商视觉 Agent。根据商品视觉分析、平台和用户选择，输出严格 JSON：{\"prompts\":[{\"typeId\":\"...\",\"prompt\":\"...\"}]}。每个已选 typeId 必须恰好出现一次；提示词必须强调保持商品结构、商标与颜色一致，不生成画内文字。",
    JSON.stringify({
      platform: input.platform,
      category: input.category,
      customBrief: input.customBrief?.trim() || undefined,
      productProfile: profile,
      referenceImageCount: input.referenceImageDataUrls?.length ?? 0,
      selectedTypes: selected.map(({ id, label, ratio }) => ({ id, label, ratio })),
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
        id: crypto.randomUUID(),
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

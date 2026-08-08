/**
 * 语义分层 PSD 的分层规划。
 * 纯逻辑、不依赖 DOM，可在 jsdom 下单测。
 */

/** fabric 对象的必要字段（分层只用得到这些） */
export interface PsdObjectLike {
  name?: string;
  type?: string;
}

/** 一个 PSD 层的规划：层名 + 命中的对象在画布对象数组中的下标 */
export interface PsdLayerPlan {
  label: string;
  indices: number[];
}

/**
 * 对象 → 语义层分类。
 * 命名约定优先（headline/features/mask），未命名对象按 fabric 类型兜底。
 */
export function classifyPsdLayer(obj: PsdObjectLike): string {
  if (obj.name === "mask") return "蒙版标注";
  if (obj.name === "headline") return "主标题";
  if (obj.name === "features") return "特性内容";
  if (obj.type === "image") return "图片与Logo";
  if (obj.type === "text" || obj.type === "i-text" || obj.type === "textbox") return "其他文字";
  return "形状与装饰";
}

/** 蒙版标注层固定在最高层（作为编辑参考，不夹在内容中间） */
const TOP_LAYER = "蒙版标注";

/**
 * 把画布对象数组规划为 PSD 层。
 * - 层序自顶向下（与 ag-psd children 顺序一致：children[0] 为最顶层）；
 * - 组按对象从顶到底首次出现的顺序建立，保持 z 序；
 * - 蒙版标注层始终提到最顶。
 */
export function planPsdLayers(objects: PsdObjectLike[]): PsdLayerPlan[] {
  const groups = new Map<string, PsdLayerPlan>();
  const order: string[] = [];
  const total = objects.length;
  for (let i = total - 1; i >= 0; i--) {
    const label = classifyPsdLayer(objects[i]);
    const existing = groups.get(label);
    if (existing) {
      existing.indices.push(i);
    } else {
      groups.set(label, { label, indices: [i] });
      order.push(label);
    }
  }
  const maskIndex = order.indexOf(TOP_LAYER);
  if (maskIndex > 0) {
    const [mask] = order.splice(maskIndex, 1);
    order.unshift(mask);
  }
  return order.map((label) => groups.get(label)!);
}

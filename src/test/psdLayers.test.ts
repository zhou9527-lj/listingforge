import { describe, expect, it } from "vitest";
import { classifyPsdLayer, planPsdLayers } from "../lib/psdLayers";

describe("classifyPsdLayer", () => {
  it("classifies by naming convention first", () => {
    expect(classifyPsdLayer({ name: "mask", type: "path" })).toBe("蒙版标注");
    expect(classifyPsdLayer({ name: "headline", type: "textbox" })).toBe("主标题");
    expect(classifyPsdLayer({ name: "features", type: "circle" })).toBe("特性内容");
  });

  it("falls back to fabric type for unnamed objects", () => {
    expect(classifyPsdLayer({ type: "image" })).toBe("图片与Logo");
    expect(classifyPsdLayer({ type: "i-text" })).toBe("其他文字");
    expect(classifyPsdLayer({ type: "text" })).toBe("其他文字");
    expect(classifyPsdLayer({ type: "rect" })).toBe("形状与装饰");
    expect(classifyPsdLayer({})).toBe("形状与装饰");
  });
});

describe("planPsdLayers", () => {
  it("keeps z-order from top to bottom with first-appearance grouping", () => {
    // 数组下标 0 为最底：背景之上的文字在数组中靠后
    const objects = [
      { type: "circle", name: "features" }, // 底：特性圆环
      { type: "i-text", name: "headline" }, // 中：主标题
      { type: "i-text", name: "features" }, // 顶：特性文字
    ];
    const layers = planPsdLayers(objects);
    expect(layers.map((layer) => layer.label)).toEqual(["特性内容", "主标题"]);
    expect(layers[0].indices).toEqual([2, 0]);
    expect(layers[1].indices).toEqual([1]);
  });

  it("hoists the mask layer to the very top", () => {
    const objects = [
      { type: "i-text", name: "headline" },
      { type: "path", name: "mask" },
    ];
    const layers = planPsdLayers(objects);
    expect(layers[0].label).toBe("蒙版标注");
    expect(layers[0].indices).toEqual([1]);
  });

  it("returns empty plan for an empty canvas", () => {
    expect(planPsdLayers([])).toEqual([]);
  });

  it("separates unnamed images from text", () => {
    const objects = [
      { type: "i-text" },
      { type: "image" },
      { type: "rect" },
    ];
    const layers = planPsdLayers(objects);
    expect(layers.map((layer) => layer.label)).toEqual(["形状与装饰", "图片与Logo", "其他文字"]);
  });
});

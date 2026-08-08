import type { GenerationType } from "../types";

export const supportedPlatforms = ["淘宝 / 天猫", "京东", "拼多多", "抖音电商", "快手电商", "小红书", "微信小店", "1688"] as const;
export type SupportedPlatform = typeof supportedPlatforms[number];
type Ratio = GenerationType["ratio"];

export interface PlatformPreset {
  version: string;
  dimensions: Record<Ratio, string>;
}

const preset = (square: string, portrait: string, landscape: string, vertical: string): PlatformPreset => ({
  version: "2026.08-common",
  dimensions: { "1:1": square, "3:4": portrait, "4:3": landscape, "9:16": vertical },
});

export const platformPresets: Record<SupportedPlatform, PlatformPreset> = {
  "淘宝 / 天猫": preset("800 × 800", "750 × 1000", "1000 × 750", "1080 × 1920"),
  "京东": preset("800 × 800", "750 × 1000", "1000 × 750", "1080 × 1920"),
  "拼多多": preset("800 × 800", "600 × 800", "800 × 600", "1080 × 1920"),
  "抖音电商": preset("1080 × 1080", "1080 × 1440", "1440 × 1080", "1080 × 1920"),
  "快手电商": preset("1080 × 1080", "1080 × 1440", "1440 × 1080", "1080 × 1920"),
  "小红书": preset("1080 × 1080", "1080 × 1440", "1440 × 1080", "1080 × 1920"),
  "微信小店": preset("800 × 800", "1080 × 1440", "1440 × 1080", "1080 × 1920"),
  "1688": preset("750 × 750", "750 × 1000", "1000 × 750", "1080 × 1920"),
};

export const getPlatformDimensions = (platform: SupportedPlatform, ratio: Ratio) => platformPresets[platform].dimensions[ratio];

export interface CanvasSize {
  width: number;
  height: number;
}

/** 将 "800 × 800" 这类预设字符串解析为像素数字；格式不符时返回 null。 */
export const parseDimensionString = (value: string): CanvasSize | null => {
  const match = /^\s*(\d+)\s*[×x]\s*(\d+)\s*$/.exec(value);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  return { width, height };
};

/** 该平台指定比例的目标像素；格式不符时回退到 1:1 尺寸。 */
export const getPlatformSize = (platform: SupportedPlatform, ratio: Ratio): CanvasSize =>
  parseDimensionString(getPlatformDimensions(platform, ratio)) ?? parseDimensionString(platformPresets[platform].dimensions["1:1"]) ?? { width: 800, height: 800 };

/** 八个平台全部预设去重后的可选尺寸列表（用于画布/导出尺寸选择）。 */
export const getPresetSizeOptions = (): string[] => [
  ...new Set(Object.values(platformPresets).flatMap((preset) => Object.values(preset.dimensions))),
];

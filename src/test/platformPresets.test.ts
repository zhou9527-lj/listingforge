import { describe, expect, it } from "vitest";
import {
  getPlatformDimensions,
  getPlatformSize,
  getPresetSizeOptions,
  parseDimensionString,
  platformPresets,
  supportedPlatforms,
} from "../data/platformPresets";

describe("platform size presets", () => {
  it("contains a versioned preset for every selectable platform", () => {
    expect(Object.keys(platformPresets).sort()).toEqual([...supportedPlatforms].sort());
    expect(Object.values(platformPresets).every((item) => item.version.length > 0)).toBe(true);
  });

  it("maps a selected platform and generation ratio to target pixels", () => {
    expect(getPlatformDimensions("小红书", "3:4")).toBe("1080 × 1440");
    expect(getPlatformDimensions("淘宝 / 天猫", "1:1")).toBe("800 × 800");
  });

  it("parses preset dimension strings into numeric pixels", () => {
    expect(parseDimensionString("800 × 800")).toEqual({ width: 800, height: 800 });
    expect(parseDimensionString("1080x1920")).toEqual({ width: 1080, height: 1920 });
    expect(parseDimensionString("invalid")).toBeNull();
    expect(parseDimensionString("0 × 800")).toBeNull();
  });

  it("resolves a platform preset to a numeric canvas size", () => {
    expect(getPlatformSize("小红书", "3:4")).toEqual({ width: 1080, height: 1440 });
    expect(getPlatformSize("京东", "1:1")).toEqual({ width: 800, height: 800 });
  });

  it("exposes deduplicated size options across all platforms", () => {
    const options = getPresetSizeOptions();
    expect(new Set(options).size).toBe(options.length);
    expect(options).toContain("800 × 800");
    expect(options).toContain("1080 × 1920");
  });
});

import { describe, expect, it } from "vitest";
import { validateEditSubmit } from "../lib/canvasEdit";

describe("local AI edit validation", () => {
  it("rejects non-desktop submissions", () => {
    expect(validateEditSubmit({ desktop: false, prompt: "换色", hasMask: true })).toBe("局部编辑仅在桌面版可用");
  });

  it("requires an instruction", () => {
    expect(validateEditSubmit({ desktop: true, prompt: "   ", hasMask: true })).toBe("请输入编辑指令");
  });

  it("requires a drawn mask", () => {
    expect(validateEditSubmit({ desktop: true, prompt: "换色", hasMask: false })).toBe("请先绘制蒙版区域");
  });

  it("passes when desktop, instruction and mask are present", () => {
    expect(validateEditSubmit({ desktop: true, prompt: "换色", hasMask: true })).toBeNull();
  });
});

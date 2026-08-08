import { describe, expect, it, vi } from "vitest";
import { MAX_REFERENCE_COUNT, validateImageFileBasics, validateImageFiles } from "../lib/imageFiles";

const mockBitmap = (width: number, height: number) => ({ width, height, close: () => undefined });

describe("image file validation", () => {
  it("accepts the supported image MIME types", () => {
    expect(() => validateImageFileBasics(new File(["image"], "item.webp", { type: "image/webp" }))).not.toThrow();
  });

  it("rejects unsupported files before any cloud request", () => {
    expect(() => validateImageFileBasics(new File(["text"], "notes.txt", { type: "text/plain" }))).toThrow("PNG");
  });

  it("rejects a file over the configured byte limit", () => {
    expect(() => validateImageFileBasics(new File(["123456"], "large.png", { type: "image/png" }), 5)).toThrow("上限");
  });

  it("rejects a batch that exceeds the total reference image count", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => mockBitmap(800, 800)));
    const files = Array.from({ length: MAX_REFERENCE_COUNT + 1 }, (_, index) =>
      new File(["image"], `ref-${index}.png`, { type: "image/png" }),
    );
    await expect(validateImageFiles(files)).rejects.toThrow("最多引用");
    vi.unstubAllGlobals();
  });

  it("accounts for already selected reference images when counting", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => mockBitmap(800, 800)));
    const files = Array.from({ length: 3 }, (_, index) =>
      new File(["image"], `ref-${index}.png`, { type: "image/png" }),
    );
    await expect(validateImageFiles(files, 0, MAX_REFERENCE_COUNT - 2)).rejects.toThrow("当前已有");
    vi.unstubAllGlobals();
  });
});

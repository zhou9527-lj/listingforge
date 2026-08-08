import { describe, expect, it } from "vitest";
import { getApiSecretStatus, hasTauriRuntime, invokeDesktop, segmentImage } from "../lib/desktop";

describe("desktop boundary", () => {
  it("does not report a Tauri runtime in the browser test environment", () => {
    expect(hasTauriRuntime()).toBe(false);
  });

  it("rejects desktop commands instead of returning a fake success", async () => {
    await expect(invokeDesktop("test_command")).rejects.toThrow("ListingForge");
  });

  it("reports cloud credentials as unconfigured outside the desktop runtime", async () => {
    await expect(getApiSecretStatus("apimart")).resolves.toEqual({
      configured: false,
      maskedKey: "",
    });
  });

  it("rejects local cutout outside the desktop runtime", async () => {
    await expect(segmentImage("E:\\project", "E:\\image.png")).rejects.toThrow("ListingForge");
  });
});

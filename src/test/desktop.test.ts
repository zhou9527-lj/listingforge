import { describe, expect, it } from "vitest";
import { desktopErrorMessage, getApiSecretStatus, hasTauriRuntime, invokeDesktop, segmentImage } from "../lib/desktop";

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

  it("keeps string errors returned by Tauri commands", () => {
    expect(desktopErrorMessage("同名项目目录已存在", "创建项目失败")).toBe("同名项目目录已存在");
    expect(desktopErrorMessage(new Error("目录无写入权限"), "创建项目失败")).toBe("目录无写入权限");
    expect(desktopErrorMessage(null, "创建项目失败")).toBe("创建项目失败");
  });
});

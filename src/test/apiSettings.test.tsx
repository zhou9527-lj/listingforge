import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiSettings } from "../screens/ApiSettings";

vi.mock("../lib/desktop", () => ({
  hasTauriRuntime: () => true,
  getApiSecretStatus: vi.fn(async () => ({ configured: false, maskedKey: "" })),
  saveApiSecret: vi.fn(async () => "sk-****abcd"),
  testApiProvider: vi.fn(async () => ({ ok: true, latencyMs: 320, message: "ok", balance: 12.5 })),
}));

import { getApiSecretStatus, saveApiSecret, testApiProvider } from "../lib/desktop";

describe("ApiSettings screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads secret status for every provider on mount", async () => {
    render(<ApiSettings />);
    await waitFor(() => expect(getApiSecretStatus).toHaveBeenCalledTimes(3));
  });

  it("saves a key through the system credential store", async () => {
    render(<ApiSettings />);
    const inputs = screen.getAllByPlaceholderText("在本地填写 API Key");
    fireEvent.change(inputs[0], { target: { value: "sk-test-1234" } });
    fireEvent.click(screen.getAllByText("更新密钥")[0]);
    await waitFor(() => expect(saveApiSecret).toHaveBeenCalledWith("apimart", "sk-test-1234"));
  });

  it("refuses to save an empty key", async () => {
    render(<ApiSettings />);
    fireEvent.click(screen.getAllByText("更新密钥")[0]);
    expect(saveApiSecret).not.toHaveBeenCalled();
  });

  it("runs a connection test for a provider", async () => {
    render(<ApiSettings />);
    fireEvent.click(screen.getAllByText("测试连接")[0]);
    await waitFor(() => expect(testApiProvider).toHaveBeenCalledWith("apimart"));
  });
});

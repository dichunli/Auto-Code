import { describe, it, expect, vi, afterEach } from "vitest";
import { copyText } from "./copyText";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("copyText 复制到剪贴板", () => {
  it("clipboard API 可用时直接复制成功", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(copyText("测试文本")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("测试文本");
  });

  it("clipboard 被拒时回退 execCommand 复制（http 页面场景）", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;

    await expect(copyText("abc")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("clipboard 不存在且 execCommand 也失败时返回 false", async () => {
    vi.stubGlobal("navigator", {}); // http 非安全上下文没有 clipboard
    document.execCommand = vi.fn().mockReturnValue(false);

    await expect(copyText("abc")).resolves.toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

/* ============================================================
   capacitorEnv — 环境判定测试

   【这个 bug 极其隐蔽，必须有测试守住】
   2026-06-17 重大事故：原来用 `!!window.Capacitor` 判断是否 APP 环境。
   但浏览器里只要某个组件 import 了 @capacitor/core（如相机/视频上传组件），
   它就会在浏览器里创建 window.Capacitor「Web 垫片」，导致普通浏览器被误判成 APP，
   认证读错存储位置 → 保存请求不带 token → 所有写操作 401/42501 失败。

   修复：改用官方 Capacitor.isNativePlatform()，它能正确区分
   「真原生 APP」和「浏览器里的 Web 垫片」。

   本测试钉死：浏览器环境（isNativePlatform=false）必须判为「浏览器」，绝不能是「APP」。
   ============================================================ */

const mockIsNative = vi.fn();

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => mockIsNative(),
  },
}));

async function 加载模块() {
  vi.resetModules();
  return import("./capacitorEnv");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("是Capacitor环境", () => {
  it("浏览器（isNativePlatform=false）→ false，即使加载了 Capacitor 垫片", async () => {
    mockIsNative.mockReturnValue(false);
    const mod = await 加载模块();
    expect(mod.是Capacitor环境()).toBe(false);
  });

  it("真原生 APP（isNativePlatform=true）→ true", async () => {
    mockIsNative.mockReturnValue(true);
    const mod = await 加载模块();
    expect(mod.是Capacitor环境()).toBe(true);
  });

  it("isNativePlatform 抛异常 → 安全降级为 false（按浏览器处理）", async () => {
    mockIsNative.mockImplementation(() => {
      throw new Error("not available");
    });
    const mod = await 加载模块();
    expect(mod.是Capacitor环境()).toBe(false);
  });
});

describe("获取当前环境", () => {
  it("浏览器环境 → '浏览器'（关键：不能因 Capacitor 垫片误判成 APP）", async () => {
    mockIsNative.mockReturnValue(false);
    const mod = await 加载模块();
    expect(mod.获取当前环境()).toBe("浏览器");
  });

  it("真 APP → 'APP'", async () => {
    mockIsNative.mockReturnValue(true);
    const mod = await 加载模块();
    expect(mod.获取当前环境()).toBe("APP");
  });
});

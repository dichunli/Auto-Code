import { describe, it, expect, vi } from "vitest";

/* ============================================================
   Mock 外部依赖：诊断登录健康 是纯函数，但模块顶层会读取环境变量
   构造 storageKey，仍需 mock 掉 supabase-js 和 capacitorEnv
   ============================================================ */
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ mockSupabase: true })),
}));

vi.mock("@/lib/capacitorEnv", () => ({
  是Capacitor环境: () => false,
}));

import { 诊断登录健康 } from "./client";

/* ============================================================
   构造测试用 session 字符串
   ============================================================ */
/* 未来时间戳（秒）：保证不过期 */
const 未来 = Math.floor(Date.now() / 1000) + 3600;
/* 过去时间戳（秒）：保证已过期 */
const 过去 = Math.floor(Date.now() / 1000) - 3600;

function 完整Session(access = "access-1"): string {
  return JSON.stringify({
    access_token: access,
    refresh_token: "refresh-1",
    expires_at: 未来,
  });
}

function 缺RefreshSession(): string {
  return JSON.stringify({ access_token: "access-1", expires_at: 未来 });
}

function 过期Session(): string {
  return JSON.stringify({
    access_token: "access-1",
    refresh_token: "refresh-1",
    expires_at: 过去,
  });
}

/* ============================================================
   1. 健康场景
   ============================================================ */
describe("诊断登录健康 - 健康场景", () => {
  it("浏览器：localStorage 与 cookie 一致且字段齐全 → 健康", () => {
    const 结果 = 诊断登录健康("浏览器", 完整Session(), 完整Session());
    expect(结果.健康).toBe(true);
    expect(结果.问题).toHaveLength(0);
    expect(结果.详情.存储一致).toBe(true);
    expect(结果.详情.已过期).toBe(false);
  });

  it("APP：localStorage 字段齐全 → 健康（不检查 cookie 一致性）", () => {
    const 结果 = 诊断登录健康("APP", 完整Session(), null);
    expect(结果.健康).toBe(true);
    expect(结果.详情.存储一致).toBeNull();
  });

  it("未登录（两边都空）→ 健康，不报字段缺失", () => {
    const 结果 = 诊断登录健康("浏览器", null, null);
    expect(结果.健康).toBe(true);
    expect(结果.问题).toHaveLength(0);
    expect(结果.详情.有Session).toBe(false);
  });

  it("服务端：无存储 → 健康", () => {
    const 结果 = 诊断登录健康("服务端", null, null);
    expect(结果.健康).toBe(true);
    expect(结果.详情.存储一致).toBeNull();
  });
});

/* ============================================================
   2. 字段缺失场景（历史事故核心）
   ============================================================ */
describe("诊断登录健康 - 字段缺失", () => {
  it("缺 refresh_token（cookie 截断典型）→ 报问题", () => {
    const 结果 = 诊断登录健康("浏览器", 缺RefreshSession(), 缺RefreshSession());
    expect(结果.健康).toBe(false);
    expect(结果.详情.有RefreshToken).toBe(false);
    expect(结果.问题.some((p) => p.includes("refresh_token"))).toBe(true);
  });

  it("缺 access_token → 报问题", () => {
    const 无access = JSON.stringify({ refresh_token: "refresh-1" });
    const 结果 = 诊断登录健康("浏览器", 无access, 无access);
    expect(结果.健康).toBe(false);
    expect(结果.详情.有AccessToken).toBe(false);
    expect(结果.问题.some((p) => p.includes("access_token"))).toBe(true);
  });

  it("无效 JSON 但 cookie 字符串存在 → 视为有 session 但字段缺失", () => {
    const 结果 = 诊断登录健康("浏览器", "not-json", "not-json");
    expect(结果.健康).toBe(false);
    expect(结果.详情.有Session).toBe(true);
    expect(结果.详情.有AccessToken).toBe(false);
  });
});

/* ============================================================
   3. 过期场景
   ============================================================ */
describe("诊断登录健康 - token 过期", () => {
  it("access_token 已过期 → 报问题", () => {
    const 结果 = 诊断登录健康("浏览器", 过期Session(), 过期Session());
    expect(结果.健康).toBe(false);
    expect(结果.详情.已过期).toBe(true);
    expect(结果.问题.some((p) => p.includes("过期"))).toBe(true);
  });

  it("无 expires_at → 已过期为 null，不报过期问题", () => {
    const 无过期 = JSON.stringify({ access_token: "a", refresh_token: "r" });
    const 结果 = 诊断登录健康("浏览器", 无过期, 无过期);
    expect(结果.详情.已过期).toBeNull();
    expect(结果.问题.some((p) => p.includes("过期"))).toBe(false);
  });
});

/* ============================================================
   4. 存储不一致场景（半改不改典型）
   ============================================================ */
describe("诊断登录健康 - 存储一致性", () => {
  it("localStorage 与 cookie 的 access_token 不同 → 报不一致", () => {
    const 结果 = 诊断登录健康("浏览器", 完整Session("access-A"), 完整Session("access-B"));
    expect(结果.健康).toBe(false);
    expect(结果.详情.存储一致).toBe(false);
    expect(结果.问题.some((p) => p.includes("不一致"))).toBe(true);
  });

  it("只有 localStorage 有效、cookie 无效 → 报不一致（服务端读不到）", () => {
    const 结果 = 诊断登录健康("浏览器", 完整Session(), null);
    expect(结果.详情.存储一致).toBe(false);
    expect(结果.问题.some((p) => p.includes("不一致"))).toBe(true);
  });

  it("只有 cookie 有效、localStorage 空 → 报不一致", () => {
    const 结果 = 诊断登录健康("浏览器", null, 完整Session());
    expect(结果.详情.存储一致).toBe(false);
  });
});

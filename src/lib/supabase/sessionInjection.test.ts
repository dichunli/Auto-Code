import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

/* ============================================================
   确保有session / 确保会话就绪 — 登录态注入补丁函数测试

   这两个函数是历史事故的「兜底补丁」：
   - 确保有session：每次查询前，若内存里没 session 但本地存储有完整的，
     强行 setSession 注入，避免「登录后查询不带 token → RLS 过滤 → 数据空白」。
   - 确保会话就绪：进入应用时注入一次，避免「软跳转进列表页数据为空，
     刷新才出来」。

   它们的判断逻辑（本地无数据不注入 / 缺字段不注入 / 过期不注入 / 完整才注入）
   一旦写错，就会重现「数据空白」或「注入过期 token」事故。这些用例就是
   把这些判断钉死，复发即报警。
   ============================================================ */

const TEST_URL = "https://abc123.supabase.co";
const TEST_KEY = "test-anon-key";
const 认证Key = "sb-abc123-auth-token";

/* 可控的 supabase 客户端 mock：每次 createClient 都返回同一个实例，
   测试通过 mockState 控制 getSession 返回值、检查 setSession 调用 */
const mockState = {
  isCapacitor: false,
  /* getSession 返回的 session（null = 内存中无 session） */
  内存Session: null as unknown,
  setSession: vi.fn(async () => ({ data: {}, error: null })),
  getSession: vi.fn(async () => ({ data: { session: mockState.内存Session } })),
};

const mock客户端 = {
  auth: {
    getSession: (...args: unknown[]) => mockState.getSession(...args),
    setSession: (...args: unknown[]) => mockState.setSession(...args),
  },
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => mock客户端),
}));

vi.mock("@/lib/capacitorEnv", () => ({
  是Capacitor环境: () => mockState.isCapacitor,
}));

const 未来 = Math.floor(Date.now() / 1000) + 3600;
const 过去 = Math.floor(Date.now() / 1000) - 3600;

function 完整Session(): string {
  return JSON.stringify({
    access_token: "access-1",
    refresh_token: "refresh-1",
    expires_at: 未来,
  });
}

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = TEST_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = TEST_KEY;
});

beforeEach(() => {
  /* 重置模块：清掉 确保会话就绪 的模块级 Promise 缓存，保证用例间互不影响 */
  vi.resetModules();
  vi.clearAllMocks();
  mockState.isCapacitor = false;
  mockState.内存Session = null;
  window.localStorage.clear();
});

async function 加载模块() {
  return import("./client");
}

/* ============================================================
   确保有session
   ============================================================ */
describe("确保有session", () => {
  it("本地存储无数据 → 不注入（不调 setSession）", async () => {
    const mod = await 加载模块();
    await mod.确保有session();
    expect(mockState.setSession).not.toHaveBeenCalled();
  });

  it("本地有完整且未过期的 session → 注入（用正确的 token 调 setSession）", async () => {
    window.localStorage.setItem(认证Key, 完整Session());
    const mod = await 加载模块();
    await mod.确保有session();

    expect(mockState.setSession).toHaveBeenCalledTimes(1);
    expect(mockState.setSession).toHaveBeenCalledWith({
      access_token: "access-1",
      refresh_token: "refresh-1",
    });
  });

  it("本地 session 缺 refresh_token → 不注入（避免注入残缺登录态）", async () => {
    window.localStorage.setItem(
      认证Key,
      JSON.stringify({ access_token: "access-1", expires_at: 未来 })
    );
    const mod = await 加载模块();
    await mod.确保有session();
    expect(mockState.setSession).not.toHaveBeenCalled();
  });

  it("本地 session 已过期 → 不注入（避免注入过期 token）", async () => {
    window.localStorage.setItem(
      认证Key,
      JSON.stringify({
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_at: 过去,
      })
    );
    const mod = await 加载模块();
    await mod.确保有session();
    expect(mockState.setSession).not.toHaveBeenCalled();
  });

  it("本地数据是无效 JSON → 不崩溃、不注入", async () => {
    window.localStorage.setItem(认证Key, "not-valid-json{{{");
    const mod = await 加载模块();
    await expect(mod.确保有session()).resolves.toBeUndefined();
    expect(mockState.setSession).not.toHaveBeenCalled();
  });

  it("APP 环境 → 直接返回，不碰 session（APP 由 onAuthStateChange 自管）", async () => {
    mockState.isCapacitor = true;
    window.localStorage.setItem(认证Key, 完整Session());
    const mod = await 加载模块();
    await mod.确保有session();
    expect(mockState.setSession).not.toHaveBeenCalled();
  });
});

/* ============================================================
   确保会话就绪
   ============================================================ */
describe("确保会话就绪", () => {
  it("内存中已有 session → 不重复注入", async () => {
    mockState.内存Session = { access_token: "已在内存" };
    window.localStorage.setItem(认证Key, 完整Session());
    const mod = await 加载模块();
    await mod.确保会话就绪();
    expect(mockState.setSession).not.toHaveBeenCalled();
  });

  it("内存无 session 但本地有完整的 → 注入", async () => {
    mockState.内存Session = null;
    window.localStorage.setItem(认证Key, 完整Session());
    const mod = await 加载模块();
    await mod.确保会话就绪();

    expect(mockState.setSession).toHaveBeenCalledTimes(1);
    expect(mockState.setSession).toHaveBeenCalledWith({
      access_token: "access-1",
      refresh_token: "refresh-1",
    });
  });

  it("内存无 session、本地也无 → 不注入", async () => {
    mockState.内存Session = null;
    const mod = await 加载模块();
    await mod.确保会话就绪();
    expect(mockState.setSession).not.toHaveBeenCalled();
  });

  it("本地 session 缺字段 → 不注入", async () => {
    mockState.内存Session = null;
    window.localStorage.setItem(
      认证Key,
      JSON.stringify({ access_token: "access-1" })
    );
    const mod = await 加载模块();
    await mod.确保会话就绪();
    expect(mockState.setSession).not.toHaveBeenCalled();
  });

  it("结果被缓存：同一模块内多次调用只执行一次注入", async () => {
    mockState.内存Session = null;
    window.localStorage.setItem(认证Key, 完整Session());
    const mod = await 加载模块();
    await mod.确保会话就绪();
    await mod.确保会话就绪();
    await mod.确保会话就绪();
    /* 模块级 Promise 缓存 → setSession 只应被调一次 */
    expect(mockState.setSession).toHaveBeenCalledTimes(1);
  });

  it("APP 环境 → 直接 resolve，不注入", async () => {
    mockState.isCapacitor = true;
    window.localStorage.setItem(认证Key, 完整Session());
    const mod = await 加载模块();
    await mod.确保会话就绪();
    expect(mockState.setSession).not.toHaveBeenCalled();
  });
});

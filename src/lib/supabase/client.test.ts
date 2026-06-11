import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { stringFromBase64URL } from "@supabase/ssr";

/* ============================================================
   Mock 外部依赖
   ============================================================ */
const mockState = {
  createClient: vi.fn(() => ({ mockSupabase: true })),
  isCapacitor: false,
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => mockState.createClient(...args),
}));

vi.mock("@/lib/capacitorEnv", () => ({
  是Capacitor环境: () => mockState.isCapacitor,
}));

/* ============================================================
   常量
   ============================================================ */
const TEST_URL = "https://abc123.supabase.co";
const TEST_KEY = "test-anon-key";
const 认证Key = "sb-abc123-auth-token";
const APP认证Key = "sb-abc123-auth-token-app";

function 完整Session(): string {
  return JSON.stringify({
    access_token: "valid-access-token",
    refresh_token: "valid-refresh-token",
    expires_at: 1234567890,
  });
}

function 截断Session(): string {
  return JSON.stringify({
    access_token: "valid-access-token",
    // 缺少 refresh_token — 模拟 cookie 截断场景
  });
}

/* ============================================================
   Cookie 模拟（精确控制，不依赖 jsdom 内部实现）
   ============================================================ */
const cookieStore: Record<string, string> = {};

function 清理Cookie(): void {
  Object.keys(cookieStore).forEach((k) => delete cookieStore[k]);
}

/*
 * 用「服务端 @supabase/ssr 的读取方式」从模拟 cookie 中还原 session 明文。
 * 用于验证客户端写入的 cookie（base64- 编码 + 可能分段）能被服务端正确读回。
 * 单条优先，没有则拼接 key.0、key.1… 分段。
 */
function 从Cookie按服务端方式还原(key: string): string | null {
  let 编码值: string | null = null;
  if (cookieStore[key] !== undefined) {
    编码值 = cookieStore[key];
  } else {
    const chunks: string[] = [];
    for (let i = 0; cookieStore[`${key}.${i}`] !== undefined; i++) {
      chunks.push(cookieStore[`${key}.${i}`]);
    }
    if (chunks.length > 0) 编码值 = chunks.join("");
  }
  if (编码值 === null) return null;
  if (编码值.startsWith("base64-")) {
    return stringFromBase64URL(编码值.slice("base64-".length));
  }
  return 编码值;
}

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = TEST_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = TEST_KEY;

  Object.defineProperty(document, "cookie", {
    configurable: true,
    get() {
      return Object.entries(cookieStore)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join("; ");
    },
    set(val: string) {
      const parts = val.split(";");
      const [kv] = parts;
      const eqIdx = kv.indexOf("=");
      const key = kv.slice(0, eqIdx).trim();
      const rawValue = kv.slice(eqIdx + 1).trim();

      if (parts.some((p) => p.trim() === "max-age=0")) {
        delete cookieStore[key];
      } else {
        cookieStore[key] = decodeURIComponent(rawValue);
      }
    },
  });
});

/* ============================================================
   生命周期钩子
   ============================================================ */
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockState.createClient.mockClear();
  mockState.isCapacitor = false;
  window.localStorage.clear();
  清理Cookie();
});

/* ============================================================
   辅助函数
   ============================================================ */
async function 加载模块() {
  return import("./client");
}

function 提取存储(): Storage {
  const [, , options] = mockState.createClient.mock.calls[0] as [
    string,
    string,
    { auth: { storage: Storage } },
  ];
  return options.auth.storage;
}

/* ============================================================
   1. createClient 环境分支
   ============================================================ */
describe("createClient - 环境分支", () => {
  it("浏览器环境：使用自定义 storage 和正确 storageKey", async () => {
    const mod = await 加载模块();
    mockState.isCapacitor = false;
    mod.createClient();

    expect(mockState.createClient).toHaveBeenCalledTimes(1);
    const [, , options] = mockState.createClient.mock.calls[0] as [
      string,
      string,
      { auth: { storage: Storage; storageKey: string } },
    ];
    expect(options.auth.storageKey).toBe(认证Key);
    expect(typeof options.auth.storage).toBe("object");
  });

  it("APP 环境：使用 APP 存储和 APP storageKey", async () => {
    const mod = await 加载模块();
    mockState.isCapacitor = true;
    mod.createClient();

    expect(mockState.createClient).toHaveBeenCalledTimes(1);
    const [, , options] = mockState.createClient.mock.calls[0] as [
      string,
      string,
      { auth: { storage: Storage; storageKey: string } },
    ];
    expect(options.auth.storageKey).toBe(APP认证Key);
    expect(typeof options.auth.storage).toBe("object");
  });

  it("服务端环境：不使用自定义 storage", async () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error 测试中临时移除 window 模拟服务端
    globalThis.window = undefined;

    try {
      const mod = await 加载模块();
      mod.createClient();

      expect(mockState.createClient).toHaveBeenCalledTimes(1);
      const [, , options] = mockState.createClient.mock.calls[0] as [
        string,
        string,
        { auth: Record<string, unknown> },
      ];
      expect(options.auth.storageKey).toBe(认证Key);
      expect(options.auth.storage).toBeUndefined();
    } finally {
      globalThis.window = originalWindow;
    }
  });
});

/* ============================================================
   2. 浏览器存储 - getItem（核心：cookie 完整性校验）
   ============================================================ */
describe("浏览器存储 - getItem", () => {
  it("cookie 中有完整 session → 返回 cookie 值", async () => {
    const mod = await 加载模块();
    mockState.isCapacitor = false;
    mod.createClient();
    const storage = 提取存储();

    cookieStore[认证Key] = 完整Session();
    expect(storage.getItem(认证Key)).toBe(完整Session());
  });

  it("cookie 被截断（缺少 refresh_token）→ 回退 localStorage", async () => {
    const mod = await 加载模块();
    mockState.isCapacitor = false;
    mod.createClient();
    const storage = 提取存储();

    cookieStore[认证Key] = 截断Session();
    window.localStorage.setItem(认证Key, 完整Session());

    expect(storage.getItem(认证Key)).toBe(完整Session());
  });

  it("cookie 解析失败（无效 JSON）→ 回退 localStorage", async () => {
    const mod = await 加载模块();
    mockState.isCapacitor = false;
    mod.createClient();
    const storage = 提取存储();

    cookieStore[认证Key] = "not-valid-json";
    window.localStorage.setItem(认证Key, 完整Session());

    expect(storage.getItem(认证Key)).toBe(完整Session());
  });

  it("cookie 为空 → 回退 localStorage", async () => {
    const mod = await 加载模块();
    mockState.isCapacitor = false;
    mod.createClient();
    const storage = 提取存储();

    window.localStorage.setItem(认证Key, 完整Session());

    expect(storage.getItem(认证Key)).toBe(完整Session());
  });

  it("cookie 和 localStorage 都为空 → 返回 null", async () => {
    const mod = await 加载模块();
    mockState.isCapacitor = false;
    mod.createClient();
    const storage = 提取存储();

    expect(storage.getItem(认证Key)).toBeNull();
  });

  it("非认证 key → 直接读 localStorage", async () => {
    const mod = await 加载模块();
    mockState.isCapacitor = false;
    mod.createClient();
    const storage = 提取存储();

    window.localStorage.setItem("other-key", "other-value");
    expect(storage.getItem("other-key")).toBe("other-value");
  });
});

/* ============================================================
   3. 浏览器存储 - setItem
   ============================================================ */
describe("浏览器存储 - setItem", () => {
  it("认证 key → 同时写入 localStorage 和 cookie", async () => {
    const mod = await 加载模块();
    mockState.isCapacitor = false;
    mod.createClient();
    const storage = 提取存储();

    storage.setItem(认证Key, 完整Session());

    expect(window.localStorage.getItem(认证Key)).toBe(完整Session());
    /* cookie 以 base64- 编码写入，需按服务端方式还原后比对明文 */
    expect(从Cookie按服务端方式还原(认证Key)).toBe(完整Session());
  });

  it("非认证 key → 只写 localStorage", async () => {
    const mod = await 加载模块();
    mockState.isCapacitor = false;
    mod.createClient();
    const storage = 提取存储();

    storage.setItem("other-key", "other-value");

    expect(window.localStorage.getItem("other-key")).toBe("other-value");
    expect(cookieStore["other-key"]).toBeUndefined();
  });

  it("超大 session（>4KB）→ cookie 分段写入，服务端可完整还原", async () => {
    const mod = await 加载模块();
    mockState.isCapacitor = false;
    mod.createClient();
    const storage = 提取存储();

    /* 构造一个超过单段上限的大 session，强制触发 createChunks 分段 */
    const 大Session = JSON.stringify({
      access_token: "a".repeat(5000),
      refresh_token: "valid-refresh-token",
      expires_at: 1234567890,
    });
    storage.setItem(认证Key, 大Session);

    /* 单条 cookie 不应存在，应被切成 key.0、key.1… 分段 */
    expect(cookieStore[认证Key]).toBeUndefined();
    expect(cookieStore[`${认证Key}.0`]).toBeDefined();
    expect(cookieStore[`${认证Key}.1`]).toBeDefined();
    /* 服务端方式拼接还原后应等于原始明文 */
    expect(从Cookie按服务端方式还原(认证Key)).toBe(大Session);
  });

  it("重写较小 session → 清掉上次残留的多余分段", async () => {
    const mod = await 加载模块();
    mockState.isCapacitor = false;
    mod.createClient();
    const storage = 提取存储();

    /* 先写大 session 产生多段 */
    const 大Session = JSON.stringify({ access_token: "a".repeat(5000) });
    storage.setItem(认证Key, 大Session);
    expect(cookieStore[`${认证Key}.1`]).toBeDefined();

    /* 再写小 session，旧的第 1 段必须被清除，避免拼接出脏数据 */
    storage.setItem(认证Key, 完整Session());
    expect(cookieStore[`${认证Key}.1`]).toBeUndefined();
    expect(从Cookie按服务端方式还原(认证Key)).toBe(完整Session());
  });
});

/* ============================================================
   4. 浏览器存储 - removeItem
   ============================================================ */
describe("浏览器存储 - removeItem", () => {
  it("认证 key → 同时删除 localStorage 和 cookie", async () => {
    const mod = await 加载模块();
    mockState.isCapacitor = false;
    mod.createClient();
    const storage = 提取存储();

    window.localStorage.setItem(认证Key, 完整Session());
    cookieStore[认证Key] = 完整Session();

    storage.removeItem(认证Key);

    expect(window.localStorage.getItem(认证Key)).toBeNull();
    expect(cookieStore[认证Key]).toBeUndefined();
  });

  it("非认证 key → 只删 localStorage", async () => {
    const mod = await 加载模块();
    mockState.isCapacitor = false;
    mod.createClient();
    const storage = 提取存储();

    window.localStorage.setItem("other-key", "other-value");

    storage.removeItem("other-key");

    expect(window.localStorage.getItem("other-key")).toBeNull();
  });
});

/* ============================================================
   5. APP 存储
   ============================================================ */
describe("APP 存储", () => {
  it("getItem - APP认证Key → 读 localStorage", async () => {
    const mod = await 加载模块();
    mockState.isCapacitor = true;
    mod.createClient();
    const storage = 提取存储();

    window.localStorage.setItem(APP认证Key, 完整Session());
    expect(storage.getItem(APP认证Key)).toBe(完整Session());
  });

  it("getItem - 非 APP认证Key → 返回 null", async () => {
    const mod = await 加载模块();
    mockState.isCapacitor = true;
    mod.createClient();
    const storage = 提取存储();

    window.localStorage.setItem("other-key", "other-value");
    expect(storage.getItem("other-key")).toBeNull();
  });

  it("setItem - APP认证Key → 写 localStorage 和 cookie", async () => {
    const mod = await 加载模块();
    mockState.isCapacitor = true;
    mod.createClient();
    const storage = 提取存储();

    storage.setItem(APP认证Key, 完整Session());

    expect(window.localStorage.getItem(APP认证Key)).toBe(完整Session());
    // APP 存储的 setItem 同时写入浏览器 cookie（让服务端 @supabase/ssr 能读取）
    expect(从Cookie按服务端方式还原(认证Key)).toBe(完整Session());
  });

  it("removeItem - APP认证Key → 删 localStorage", async () => {
    const mod = await 加载模块();
    mockState.isCapacitor = true;
    mod.createClient();
    const storage = 提取存储();

    window.localStorage.setItem(APP认证Key, 完整Session());
    storage.removeItem(APP认证Key);

    expect(window.localStorage.getItem(APP认证Key)).toBeNull();
  });
});

/* ============================================================
   6. 获取当前环境
   ============================================================ */
describe("获取当前环境", () => {
  it("浏览器环境", async () => {
    const mod = await 加载模块();
    mockState.isCapacitor = false;
    expect(mod.获取当前环境()).toBe("浏览器");
  });

  it("APP 环境", async () => {
    const mod = await 加载模块();
    mockState.isCapacitor = true;
    expect(mod.获取当前环境()).toBe("APP");
  });

  it("服务端环境", async () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error 测试中临时移除 window 模拟服务端
    globalThis.window = undefined;

    try {
      const mod = await 加载模块();
      expect(mod.获取当前环境()).toBe("服务端");
    } finally {
      globalThis.window = originalWindow;
    }
  });
});

/* ============================================================
   7. 单例缓存
   ============================================================ */
describe("单例缓存", () => {
  it("浏览器环境多次调用只创建一次", async () => {
    const mod = await 加载模块();
    mockState.isCapacitor = false;
    mod.createClient();
    mod.createClient();
    expect(mockState.createClient).toHaveBeenCalledTimes(1);
  });

  it("APP 环境多次调用只创建一次", async () => {
    const mod = await 加载模块();
    mockState.isCapacitor = true;
    mod.createClient();
    mod.createClient();
    expect(mockState.createClient).toHaveBeenCalledTimes(1);
  });
});

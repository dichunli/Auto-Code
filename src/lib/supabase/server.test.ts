import { describe, it, expect, vi, beforeEach } from "vitest";

/* ============================================================
   Mock 外部依赖
   ============================================================ */
const mockCreateServerClient = vi.fn<(...args: unknown[]) => { mockServerClient: boolean }>(() => ({ mockServerClient: true }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => mockCreateServerClient(...args),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      getAll: vi.fn(() => [{ name: "test-cookie", value: "test-value" }]),
      set: vi.fn(),
    })
  ),
}));

/* 动态导入被测模块（确保 mock 先生效） */
async function 加载模块() {
  return import("./server");
}

/* ============================================================
   生命周期钩子
   ============================================================ */
beforeEach(() => {
  vi.clearAllMocks();
  mockCreateServerClient.mockClear();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
});

/* ============================================================
   测试
   ============================================================ */
describe("createClient", () => {
  it("缺少 NEXT_PUBLIC_SUPABASE_URL → 抛出错误", async () => {
    const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    try {
      const { createClient } = await 加载模块();
      await expect(createClient()).rejects.toThrow(
        "Missing env NEXT_PUBLIC_SUPABASE_URL"
      );
    } finally {
      if (originalUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    }
  });

  it("缺少 NEXT_PUBLIC_SUPABASE_ANON_KEY → 抛出错误", async () => {
    const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    try {
      const { createClient } = await 加载模块();
      await expect(createClient()).rejects.toThrow(
        "Missing env NEXT_PUBLIC_SUPABASE_ANON_KEY"
      );
    } finally {
      if (originalKey) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
    }
  });

  it("环境变量完整 → 成功创建客户端", async () => {
    const { createClient } = await 加载模块();
    const client = await createClient();

    expect(client).toEqual({ mockServerClient: true });
    expect(mockCreateServerClient).toHaveBeenCalledTimes(1);
  });

  it("创建时传入正确的 URL 和 Key", async () => {
    const { createClient } = await 加载模块();
    await createClient();

    expect(mockCreateServerClient).toHaveBeenCalledWith(
      "https://test.supabase.co",
      "test-anon-key",
      expect.any(Object)
    );
  });

  it("cookies.getAll 被正确调用", async () => {
    const { createClient } = await 加载模块();
    await createClient();

    const [, , options] = mockCreateServerClient.mock.calls[0] as unknown as [
      string,
      string,
      {
        cookies: {
          getAll: () => unknown;
          setAll: (_cookies: unknown[]) => void;
        };
      },
    ];

    // 调用 getAll 验证 cookie 读取逻辑
    const allCookies = options.cookies.getAll();
    expect(allCookies).toEqual([{ name: "test-cookie", value: "test-value" }]);
  });

  it("cookies.setAll 不会抛异常", async () => {
    const { createClient } = await 加载模块();
    await createClient();

    const [, , options] = mockCreateServerClient.mock.calls[0] as unknown as [
      string,
      string,
      {
        cookies: {
          getAll: () => unknown;
          setAll: (_cookies: unknown[]) => void;
        };
      },
    ];

    // setAll 在 Server Component 中调用会报错，但代码中捕获了异常
    expect(() =>
      options.cookies.setAll([
        { name: "x", value: "y", options: {} },
      ])
    ).not.toThrow();
  });
});

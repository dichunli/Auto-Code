import { describe, it, expect, vi, beforeEach } from "vitest";

/* 完整退出登录 测试：本地清除 + 服务端作废 Token 双轨 */

const mockSignOut = vi.fn(async () => ({}));
const mockGetSession = vi.fn(async () => ({
  data: { session: { access_token: "test-token-123" } },
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signOut: mockSignOut,
      getSession: mockGetSession,
    },
  }),
}));

const mockFetch = vi.fn(async () => new Response(null, { status: 204 }));
vi.stubGlobal("fetch", mockFetch);

import { 完整退出登录 } from "./logout";

describe("完整退出登录", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("本地清除走 scope:local（不调网络的登出）", async () => {
    await 完整退出登录();
    expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("有 session 时后台发起服务端作废请求（带 access_token）", async () => {
    await 完整退出登录();
    /* 后台 fetch 是异步的，等一拍让它发出 */
    await new Promise((r) => setTimeout(r, 50));
    expect(mockFetch).toHaveBeenCalled();
    const [url, init] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/auth/v1/logout");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token-123");
  });

  it("无 session 时只清本地，不发作废请求", async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } });
    await 完整退出登录();
    await new Promise((r) => setTimeout(r, 50));
    expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("本地清除报错也不影响流程（调用方照常跳转）", async () => {
    mockSignOut.mockRejectedValueOnce(new Error("存储异常"));
    await expect(完整退出登录()).resolves.toBeUndefined();
  });
});

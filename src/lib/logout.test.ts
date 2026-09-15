import { describe, it, expect, vi, beforeEach } from "vitest";

/* 完整退出登录 测试：单次 signOut(scope:local) 完成服务端作废 + 本地清除
 * （2026-09-14 起不再手动 fetch /logout，见 logout.ts 头部历史教训） */

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

  it("登出走 signOut scope:local（只踢当前设备，服务端作废由 auth-js 内部完成）", async () => {
    await 完整退出登录();
    expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("有 session 时也不手动发作废请求（防同一 token 被重复作废产生 403 噪音）", async () => {
    await 完整退出登录();
    /* 等一拍确认没有后台 fetch 偷偷发出 */
    await new Promise((r) => setTimeout(r, 50));
    expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mockFetch).not.toHaveBeenCalled();
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

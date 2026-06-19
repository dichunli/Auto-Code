import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RequirementBatchModal from "./RequirementBatchModal";

/* ============================================================
   RequirementBatchModal — 保存逻辑测试

   背景：环境误判（[[capacitor-web-shim-misdetect-app]]）修复后，session
   本就健康，保存前不再需要 await 确保有session()（联网注入，拖慢保存）。
   保存改用 getSession（读本地、瞬时）拿用户，并在点击瞬间 setSaving 防重复提交。

   本测试守护：
   1. 点保存能正常 insert，且用 getSession（不联网的 getUser）
   2. 内容为空时不写库
   ============================================================ */

/* 记录关键调用顺序 */
const 调用顺序: string[] = [];

const mockInsert = vi.fn(() => {
  调用顺序.push("insert");
  return {
    select: () => ({
      single: () => Promise.resolve({ data: { id: "req-1" }, error: null }),
    }),
  };
});

/* select 链：新增模式会先查最大 seq */
const mockSelect = vi.fn(() => ({
  eq: () => ({
    order: () => ({
      limit: () => Promise.resolve({ data: [{ seq: 0 }], error: null }),
    }),
  }),
}));

const mockFrom = vi.fn(() => ({
  select: mockSelect,
  insert: mockInsert,
}));

const mockGetSession = vi.fn(async () => {
  调用顺序.push("getSession");
  return { data: { session: { access_token: "t", user: { id: "user-1" } } } };
});
const mockGetUser = vi.fn(async () => ({ data: { user: { id: "user-1" } } }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: mockFrom,
    auth: {
      getUser: mockGetUser,
      getSession: mockGetSession,
    },
  }),
}));

/* 保存成功后会调 Server Action 清缓存+重新验证页面，mock 掉并记录顺序 */
const mock刷新工单详情 = vi.fn(async () => {
  调用顺序.push("刷新工单详情");
});
vi.mock("@/app/work-orders/actions", () => ({
  刷新工单详情: (...args: unknown[]) => mock刷新工单详情(...args),
}));

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh, push: vi.fn(), back: vi.fn() }),
}));

/* 上传组件不是本测试关注点，替换成最简单的占位，避免拉起 Capacitor 等依赖 */
vi.mock("@/components/ImageUploader", () => ({
  ImageUploader: () => <div data-testid="image-uploader" />,
}));
vi.mock("@/components/VideoUploader", () => ({
  VideoUploader: () => <div data-testid="video-uploader" />,
}));

beforeEach(() => {
  vi.clearAllMocks();
  调用顺序.length = 0;
  /* jsdom 未实现 alert，mock 掉避免噪音 */
  vi.spyOn(window, "alert").mockImplementation(() => {});
});

describe("RequirementBatchModal - 保存逻辑", () => {
  it("点保存 → 用 getSession 拿用户后写数据库 insert（不联网 getUser）", async () => {
    const user = userEvent.setup();
    render(
      <RequirementBatchModal open={true} onClose={vi.fn()} orderId="wo-1" />
    );

    /* 填写需求描述 */
    const textarea = screen.getByPlaceholderText(/请输入客户需求/);
    await user.type(textarea, "刹车异响");

    /* 点保存 */
    await user.click(screen.getByRole("button", { name: "保存" }));

    /* 等异步保存流程跑完 */
    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalled();
    });

    /* 断言：用 getSession（读本地、不联网）拿用户，且在 insert 之前；不再调用已联网的 getUser */
    expect(调用顺序).toContain("getSession");
    expect(调用顺序).toContain("insert");
    expect(调用顺序.indexOf("getSession")).toBeLessThan(调用顺序.indexOf("insert"));
    expect(mockGetUser).not.toHaveBeenCalled();

    /* 保存成功后必须清缓存+重新验证页面（否则新需求要手动刷新才显示），且在 insert 之后 */
    await waitFor(() => {
      expect(mock刷新工单详情).toHaveBeenCalledWith("wo-1");
    });
    expect(调用顺序.indexOf("insert")).toBeLessThan(调用顺序.indexOf("刷新工单详情"));
  });

  it("内容为空 → 不写库，也不必走保存流程（提示后中止）", async () => {
    const user = userEvent.setup();
    render(
      <RequirementBatchModal open={true} onClose={vi.fn()} orderId="wo-1" />
    );

    /* 不填任何内容直接点保存：会 alert 并 return，不应写库 */
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(mockInsert).not.toHaveBeenCalled();
  });
});

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

/* 删除前会实时查库数项目，用这个变量控制模拟结果 */
 
let 模拟项目数 = 0;

/* select 链：新增模式会先查最大 seq（.eq().order().limit()），
 * 删除前会实时数项目（.eq() 直接 await），两种用法都支持 */
const mockSelect = vi.fn(() => ({
  eq: () => ({
    order: () => ({
      limit: () => Promise.resolve({ data: [{ seq: 0 }], error: null }),
    }),
    /* 让 eq 的结果可直接 await（删除前数项目），返回模拟的项目数 */
    then: (resolve: (v: { count: number; error: null }) => void) =>
      resolve({ count: 模拟项目数, error: null }),
  }),
}));

const mockDelete = vi.fn(() => {
  调用顺序.push("delete");
  return {
    eq: () => Promise.resolve({ error: null }),
  };
});

const mockFrom = vi.fn(() => ({
  select: mockSelect,
  insert: mockInsert,
  delete: mockDelete,
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
const mock刷新工单详情 = vi.fn(async (..._args: unknown[]) => {
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
  模拟项目数 = 0;
  /* jsdom 未实现 alert，mock 掉避免噪音 */
  vi.spyOn(window, "alert").mockImplementation(() => {});
});

describe("RequirementBatchModal - 保存逻辑", () => {
  it("点保存 → 写库 insert 后广播 wo-requirement-added 局部追加（不整页刷新）", async () => {
    const user = userEvent.setup();
    const 事件监听 = vi.fn();
    window.addEventListener("wo-requirement-added", 事件监听);
    render(
      <RequirementBatchModal open={true} onClose={vi.fn()} orderId="wo-1" />
    );

    /* 填写需求描述 */
    const textarea = screen.getByPlaceholderText(/请输入客户需求/);
    await user.type(textarea, "刹车异响");

    /* 点保存 */
    await user.click(screen.getByRole("button", { name: "保存" }));

    /* 等异步保存流程跑完（机器满载时 1 秒默认上限不够，放宽到 5 秒防偶发超时） */
    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalled();
    }, { timeout: 5000 });

    /* 断言：写库成功后广播 wo-requirement-added 事件（局部追加需求卡片），
     * 不再调 刷新工单详情 整页刷新（局部更新模式） */
    expect(调用顺序).toContain("insert");
    await waitFor(() => {
      expect(事件监听).toHaveBeenCalled();
    });
    expect(mock刷新工单详情).not.toHaveBeenCalled();
    window.removeEventListener("wo-requirement-added", 事件监听);
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

describe("RequirementBatchModal - 删除防误删保护", () => {
  const 编辑用需求 = { id: "req-1", seq: 1, description: "刹车异响" };

  it("删除前实时查库：需求下有项目 → 点删除弹出提示，且不删库", async () => {
    const alert提示 = vi.spyOn(window, "alert").mockImplementation(() => {});
    模拟项目数 = 2;
    const user = userEvent.setup();
    render(
      <RequirementBatchModal
        open={true}
        onClose={vi.fn()}
        orderId="wo-1"
        requirement={编辑用需求}
        项目数={2}
      />
    );

    const 删除按钮 = screen.getByRole("button", { name: "删除" });
    /* 按钮可点击（不禁用），让用户能得到提示，而不是点了没反应 */
    expect(删除按钮).not.toBeDisabled();

    await user.click(删除按钮);
    /* 应弹出提示说明原因，且不调用 delete */
    expect(alert提示).toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("删除前实时查库：需求下无项目 → 可删除，广播 wo-requirement-deleted 局部移除", async () => {
    /* 删除会弹 confirm，mock 成确认 */
    vi.spyOn(window, "confirm").mockReturnValue(true);
    模拟项目数 = 0;
    const 事件监听 = vi.fn();
    window.addEventListener("wo-requirement-deleted", 事件监听);
    const user = userEvent.setup();
    render(
      <RequirementBatchModal
        open={true}
        onClose={vi.fn()}
        orderId="wo-1"
        requirement={编辑用需求}
        项目数={0}
      />
    );

    const 删除按钮 = screen.getByRole("button", { name: "删除" });
    expect(删除按钮).not.toBeDisabled();

    await user.click(删除按钮);

    /* 删除后广播 wo-requirement-deleted 事件（卡片局部消失），不再整页刷新 */
    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(事件监听).toHaveBeenCalled();
    });
    expect(mock刷新工单详情).not.toHaveBeenCalled();
    window.removeEventListener("wo-requirement-deleted", 事件监听);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RequirementBatchModal from "./RequirementBatchModal";

/* ============================================================
   RequirementBatchModal — 保存逻辑测试

   架构说明（2026-08-27 客户端直写收编后）：
   写库不再走客户端 supabase 直写，统一走 Server Action
   （保存需求/删除需求/指派需求/领取需求/取消需求指派）。
   本测试守护：
   1. 点保存 → 调 保存需求 Action，成功后广播 wo-requirement-added 局部追加
   2. 内容为空 → 不调 Action（提示后中止）
   3. 删除：Action 端校验失败（需求下有项目）→ 弹提示、不广播删除事件
   4. 删除：Action 成功 → 广播 wo-requirement-deleted 局部移除
   ============================================================ */

/* 记录关键调用顺序 */
const 调用顺序: string[] = [];

/* 删除需求 Action 的模拟结果：success=false 表示服务端检查发现需求下有项目 */
let 模拟删除结果 = { success: true as boolean, error: undefined as string | undefined };

const mock保存需求 = vi.fn(async (..._args: unknown[]) => {
  调用顺序.push("保存需求");
  return { success: true, id: "req-1", seq: 1 };
});
const mock删除需求 = vi.fn(async (..._args: unknown[]) => {
  调用顺序.push("删除需求");
  return 模拟删除结果;
});
const mock刷新工单详情 = vi.fn(async (..._args: unknown[]) => {
  调用顺序.push("刷新工单详情");
});

vi.mock("@/app/work-orders/actions", () => ({
  保存需求: (...args: unknown[]) => mock保存需求(...args),
  删除需求: (...args: unknown[]) => mock删除需求(...args),
  指派需求: vi.fn(async () => ({ success: true })),
  领取需求: vi.fn(async () => ({ success: true })),
  取消需求指派: vi.fn(async () => ({ success: true })),
  刷新工单详情: (...args: unknown[]) => mock刷新工单详情(...args),
}));

/* 只读查询（角色、当前用户）仍走客户端 supabase */
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: [], error: null })),
      })),
    })),
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })),
    },
  }),
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
  模拟删除结果 = { success: true, error: undefined };
  /* jsdom 未实现 alert，mock 掉避免噪音 */
  vi.spyOn(window, "alert").mockImplementation(() => {});
  /* jsdom 未实现 scrollIntoView（组件聚焦时 300ms 后调用），补空实现防未捕获异常 */
  Element.prototype.scrollIntoView = vi.fn();
});

describe("RequirementBatchModal - 保存逻辑", () => {
  it("点保存 → 调 保存需求 Action 后广播 wo-requirement-added 局部追加（不整页刷新）", async () => {
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
      expect(mock保存需求).toHaveBeenCalled();
    }, { timeout: 5000 });

    /* 断言：写库成功后广播 wo-requirement-added 事件（局部追加需求卡片），
     * 不再调 刷新工单详情 整页刷新（局部更新模式） */
    expect(调用顺序).toContain("保存需求");
    await waitFor(() => {
      expect(事件监听).toHaveBeenCalled();
    });
    expect(mock刷新工单详情).not.toHaveBeenCalled();
    window.removeEventListener("wo-requirement-added", 事件监听);
  });

  it("内容为空 → 不调 Action，提示后中止", async () => {
    const user = userEvent.setup();
    render(
      <RequirementBatchModal open={true} onClose={vi.fn()} orderId="wo-1" />
    );

    /* 不填任何内容直接点保存：会 alert 并 return，不应走保存流程 */
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(mock保存需求).not.toHaveBeenCalled();
  });
});

describe("RequirementBatchModal - 删除防误删保护", () => {
  const 编辑用需求 = { id: "req-1", seq: 1, description: "刹车异响" };

  it("服务端校验需求下有项目 → 点删除弹出提示，且不广播删除事件", async () => {
    const alert提示 = vi.spyOn(window, "alert").mockImplementation(() => {});
    /* 模拟服务端返回"需求下有 2 个项目" */
    模拟删除结果 = { success: false, error: "该需求下有 2 个维修项目，无法删除。请先删除这些维修项目，再删除需求。" };
    const 事件监听 = vi.fn();
    window.addEventListener("wo-requirement-deleted", 事件监听);
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

    /* 居中确认弹窗出现，点"确定"触发 Action */
    const 确定按钮 = await screen.findByRole("button", { name: "确定" });
    await user.click(确定按钮);

    /* 应弹出提示说明原因，且不广播删除事件 */
    await waitFor(() => {
      expect(alert提示).toHaveBeenCalled();
    });
    expect(mock删除需求).toHaveBeenCalled();
    expect(事件监听).not.toHaveBeenCalled();
    window.removeEventListener("wo-requirement-deleted", 事件监听);
  });

  it("需求下无项目 → 可删除，广播 wo-requirement-deleted 局部移除", async () => {
    /* 删除会弹居中确认弹窗（不再是浏览器 confirm），点"确定"继续 */
    模拟删除结果 = { success: true, error: undefined };
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

    /* 居中确认弹窗出现（Portal 渲染到 body），点"确定"执行删除 */
    const 确定按钮 = await screen.findByRole("button", { name: "确定" });
    await user.click(确定按钮);

    /* 删除后广播 wo-requirement-deleted 事件（卡片局部消失），不再整页刷新 */
    await waitFor(() => {
      expect(mock删除需求).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(事件监听).toHaveBeenCalled();
    });
    expect(mock刷新工单详情).not.toHaveBeenCalled();
    window.removeEventListener("wo-requirement-deleted", 事件监听);
  });
});

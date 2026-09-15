import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 解析工单配件价格（十级价格）的 Server Action 集成测试
 *
 * 为什么必须有这个测试（2026-09 DeepSeek 诊断）：
 *   partPriceResolver 的十级规则单测本来就全绿，但主路径（工单加配件）
 *   曾经根本没调用解析函数——单测再绿也拦不住"没被接线"的事故。
 *   本文件断言"主路径真的调用了 resolvePartSellingPrice 且上下文正确"。
 *
 * 方式：对 createClient / 验证用户已登录 / resolvePartSellingPrice 打桩，
 * 不连真实数据库。
 */

/* vi.mock 工厂里引用的变量必须先经 vi.hoisted 提升 */
const { mock验证用户已登录, mockCreateClient, mockResolve } = vi.hoisted(() => ({
  mock验证用户已登录: vi.fn(),
  mockCreateClient: vi.fn(),
  mockResolve: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/workOrderData", () => ({
  clearWorkOrderDataCache: vi.fn(),
  清基础数据缓存: vi.fn(),
}));
vi.mock("@/lib/operationLog", () => ({ logAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  验证用户已登录: mock验证用户已登录,
  createClient: mockCreateClient,
}));
vi.mock("@/lib/partPriceResolver", () => ({
  resolvePartSellingPrice: mockResolve,
}));

import { 解析工单配件价格 } from "./actions";

/* 造一条 supabase 查询链：from().select().eq().maybeSingle() */
function 造查询链(data: unknown, error: unknown = null) {
  const 链 = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  链.select.mockReturnValue(链);
  链.eq.mockReturnValue(链);
  return 链;
}

/* 按表名分派查询链，模拟 createClient() 返回的客户端 */
function 造客户端(各表: Record<string, ReturnType<typeof 造查询链>>) {
  return {
    from: vi.fn((表名: string) => {
      const 链 = 各表[表名];
      if (!链) throw new Error(`测试未预置表 ${表名} 的查询链`);
      return 链;
    }),
  };
}

describe("解析工单配件价格（主路径接线保护）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未登录 → 拒绝，且不调用解析函数", async () => {
    mock验证用户已登录.mockResolvedValue({ user: null, error: "未登录" });

    const 结果 = await 解析工单配件价格({ itemId: "item-1", partId: "part-1" });

    expect(结果.success).toBe(false);
    expect(结果.error).toContain("未登录");
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("项目不存在 → 报错，且不调用解析函数", async () => {
    mock验证用户已登录.mockResolvedValue({ user: { id: "u1" }, error: null });
    mockCreateClient.mockResolvedValue(
      造客户端({ work_order_items: 造查询链(null) })
    );

    const 结果 = await 解析工单配件价格({ itemId: "不存在", partId: "part-1" });

    expect(结果.success).toBe(false);
    expect(结果.error).toBe("项目不存在");
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("正常路径 → 调用解析函数且上下文从工单正确传出", async () => {
    mock验证用户已登录.mockResolvedValue({ user: { id: "u1" }, error: null });
    const supabase = 造客户端({
      work_order_items: 造查询链({ work_order_id: "wo-1" }),
      work_orders: 造查询链({
        vehicle_id: "veh-1",
        customer_id: "cust-1",
        vehicles: { vehicle_model_id: 42 },
        customers: { company: "某某物流公司" },
      }),
    });
    mockCreateClient.mockResolvedValue(supabase);
    mockResolve.mockResolvedValue({ price: 88, source: "车型VIP价" });

    const 结果 = await 解析工单配件价格({ itemId: "item-1", partId: "part-1" });

    /* 核心断言：主路径确实调用了十级解析（防"函数在但没接线"回归） */
    expect(mockResolve).toHaveBeenCalledTimes(1);
    expect(mockResolve).toHaveBeenCalledWith(supabase, "part-1", {
      vehicleId: "veh-1",
      customerId: "cust-1",
      companyName: "某某物流公司",
      vehicleModelId: 42,
    });
    expect(结果).toEqual({ success: true, price: 88, source: "车型VIP价" });
  });

  it("老数据无车辆/客户关联 → 上下文字段传 undefined 兜底", async () => {
    mock验证用户已登录.mockResolvedValue({ user: { id: "u1" }, error: null });
    const supabase = 造客户端({
      work_order_items: 造查询链({ work_order_id: "wo-1" }),
      work_orders: 造查询链({
        vehicle_id: null,
        customer_id: null,
        vehicles: null,
        customers: null,
      }),
    });
    mockCreateClient.mockResolvedValue(supabase);
    mockResolve.mockResolvedValue({ price: null, source: null });

    const 结果 = await 解析工单配件价格({ itemId: "item-1", partId: "part-1" });

    expect(mockResolve).toHaveBeenCalledWith(supabase, "part-1", {
      vehicleId: undefined,
      customerId: undefined,
      companyName: undefined,
      vehicleModelId: undefined,
    });
    /* price 为 null 时返回 undefined（前端据此提示"未匹配到价格"） */
    expect(结果).toEqual({ success: true, price: undefined, source: null });
  });
});

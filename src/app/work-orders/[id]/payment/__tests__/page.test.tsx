import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PaymentPage from "../page";

// ============================================================
// Mocks
// ============================================================
const mockPush = vi.fn();
const mockRefresh = vi.fn();
const mockBack = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
    back: mockBack,
  }),
}));

const mockRpc = vi.fn();
const mockFrom = vi.fn(() => ({
  select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(), order: vi.fn(() => ({ single: vi.fn() })) })) })),
  insert: vi.fn(() => Promise.resolve({ error: null })),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: mockRpc,
    from: mockFrom,
  }),
}));

vi.mock("@/components/PageHeader", () => ({
  PageHeader: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="page-header">
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
  ),
}));

// ============================================================
// Helpers
// ============================================================
function createMockSupabase(dataOverrides: Record<string, unknown> = {}) {
  const defaultWorkOrder = {
    id: "wo-1",
    order_no: "WO-20260501-001",
    total_cost: 300,
    parts_cost: 100,
    labor_cost: 150,
    other_cost: 50,
    advance_payment: 0,
    discount_amount: 0,
    status: "pending_settlement",
    customer_id: "cust-1",
    vehicle_id: "veh-1",
    mileage_in: 5000,
    vehicles: [{ plate_number: "京A12345", brand: "大众", model: "帕萨特" }],
    customers: [{ name: "张三", phone: "13800138000" }],
  };

  const defaultItems = [
    { id: "item-1", name: "更换机油", alias_name: null, item_type: "part" as const, quantity: 1, unit_price: 100, total_price: 100, business_type: "normal" },
    { id: "item-2", name: "工时费", alias_name: null, item_type: "labor" as const, quantity: 1, unit_price: 150, total_price: 150, business_type: "normal" },
  ];

  const defaultAccounts = [{ id: "acc-1", name: "现金账户" }];
  const defaultMembers = [{ id: "mem-1", card_no: "M001", name: "张三", phone: "13800138000", balance: 500, status: "active" }];

  const fromMocks: Record<string, unknown> = {
    work_orders: {
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: defaultWorkOrder, error: null })) })) })),
    },
    work_order_items: {
      select: vi.fn(() => ({ eq: vi.fn(() => ({ order: vi.fn(() => Promise.resolve({ data: defaultItems, error: null })) })) })),
    },
    payments: {
      select: vi.fn(() => ({ eq: vi.fn(() => ({ order: vi.fn(() => Promise.resolve({ data: [], error: null })) })) })),
    },
    finance_accounts: {
      select: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ data: defaultAccounts, error: null })) })),
    },
    members: {
      select: vi.fn(() => ({ eq: vi.fn(() => ({ order: vi.fn(() => Promise.resolve({ data: defaultMembers, error: null })) })) })),
    },
    maintenance_reminders: { insert: vi.fn(() => Promise.resolve({ error: null })) },
    notifications: { insert: vi.fn(() => Promise.resolve({ error: null })) },
    follow_ups: { insert: vi.fn(() => Promise.resolve({ error: null })) },
    ...dataOverrides,
  };

  return {
    rpc: mockRpc,
    from: (table: string) => {
      const mock = fromMocks[table];
      if (!mock) return { select: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ data: [], error: null })) })), insert: vi.fn(() => Promise.resolve({ error: null })) };
      return mock;
    },
  };
}

// ============================================================
// Tests
// ============================================================
describe("PaymentPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("加载中状态显示", async () => {
    const params = Promise.resolve({ id: "wo-1" });
    render(<PaymentPage params={params} />);
    expect(screen.getByText("加载中...")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("加载中...")).not.toBeInTheDocument());
  });

  it("加载完成后显示工单信息", async () => {
    const supabase = createMockSupabase();
    vi.mocked(mockFrom).mockImplementation(supabase.from as never);

    const params = Promise.resolve({ id: "wo-1" });
    render(<PaymentPage params={params} />);

    await waitFor(() => {
      expect(screen.getByText("工单结算")).toBeInTheDocument();
      expect(screen.getByText(/WO-20260501-001/)).toBeInTheDocument();
      expect(screen.getByText("张三")).toBeInTheDocument();
    });
  });

  it("未填写金额时提交按钮被禁用", async () => {
    const supabase = createMockSupabase();
    vi.mocked(mockFrom).mockImplementation(supabase.from as never);

    const params = Promise.resolve({ id: "wo-1" });
    render(<PaymentPage params={params} />);

    await waitFor(() => expect(screen.getByText("工单结算")).toBeInTheDocument());

    const submitBtn = screen.getByRole("button", { name: "确认结算" });
    expect(submitBtn).toBeDisabled();
  });

  it("填写金额后提交按钮可用", async () => {
    const user = userEvent.setup();
    const supabase = createMockSupabase();
    vi.mocked(mockFrom).mockImplementation(supabase.from as never);

    const params = Promise.resolve({ id: "wo-1" });
    render(<PaymentPage params={params} />);

    await waitFor(() => expect(screen.getByText("工单结算")).toBeInTheDocument());

    const amountInput = screen.getAllByPlaceholderText("金额")[0] as HTMLInputElement;
    await user.clear(amountInput);
    await user.type(amountInput, "100");

    const submitBtn = screen.getByRole("button", { name: "确认结算" });
    expect(submitBtn).not.toBeDisabled();
  });

  it("选择会员支付方式后显示会员下拉框", async () => {
    const user = userEvent.setup();
    const supabase = createMockSupabase();
    vi.mocked(mockFrom).mockImplementation(supabase.from as never);

    const params = Promise.resolve({ id: "wo-1" });
    render(<PaymentPage params={params} />);

    await waitFor(() => expect(screen.getByText("工单结算")).toBeInTheDocument());

    // combobox[0]=收款账户, combobox[1]=支付方式
    const methodSelect = screen.getAllByRole("combobox")[1] as HTMLSelectElement;
    await user.selectOptions(methodSelect, "member");

    await waitFor(() => {
      // 选择 member 后会新增一个会员选择下拉框，总 combobox 数量从 2 变为 3
      expect(screen.getAllByRole("combobox").length).toBeGreaterThanOrEqual(3);
    });
  });

  it("结算成功后跳转工单详情", async () => {
    const user = userEvent.setup();
    mockRpc.mockResolvedValue({
      data: { success: true, total_cost: 300 },
      error: null,
    });

    const supabase = createMockSupabase();
    vi.mocked(mockFrom).mockImplementation(supabase.from as never);

    const params = Promise.resolve({ id: "wo-1" });
    render(<PaymentPage params={params} />);

    await waitFor(() => expect(screen.getByText("工单结算")).toBeInTheDocument());

    const amountInput = screen.getAllByPlaceholderText("金额")[0] as HTMLInputElement;
    await user.clear(amountInput);
    await user.type(amountInput, "300");

    const submitBtn = screen.getByRole("button", { name: "确认结算" });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith("settle_work_order", {
        p_order_id: "wo-1",
        p_discount_amount: 0,
        p_payments: [{ method: "cash", amount: 300, member_id: null }],
        p_account_id: "acc-1",
        p_notes: null,
      });
      expect(mockPush).toHaveBeenCalledWith("/work-orders/wo-1");
    });
  });

  it("RPC 返回业务错误时显示错误信息", async () => {
    const user = userEvent.setup();
    mockRpc.mockResolvedValue({
      data: { success: false, error: "工单已结算，不能重复结算" },
      error: null,
    });

    const supabase = createMockSupabase();
    vi.mocked(mockFrom).mockImplementation(supabase.from as never);

    const params = Promise.resolve({ id: "wo-1" });
    render(<PaymentPage params={params} />);

    await waitFor(() => expect(screen.getByText("工单结算")).toBeInTheDocument());

    const amountInput = screen.getAllByPlaceholderText("金额")[0] as HTMLInputElement;
    await user.clear(amountInput);
    await user.type(amountInput, "300");

    const submitBtn = screen.getByRole("button", { name: "确认结算" });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText("工单已结算，不能重复结算")).toBeInTheDocument();
    });
  });

  it("RPC 抛异常时显示错误信息", async () => {
    const user = userEvent.setup();
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "connection timeout" },
    });

    const supabase = createMockSupabase();
    vi.mocked(mockFrom).mockImplementation(supabase.from as never);

    const params = Promise.resolve({ id: "wo-1" });
    render(<PaymentPage params={params} />);

    await waitFor(() => expect(screen.getByText("工单结算")).toBeInTheDocument());

    const amountInput = screen.getAllByPlaceholderText("金额")[0] as HTMLInputElement;
    await user.clear(amountInput);
    await user.type(amountInput, "300");

    const submitBtn = screen.getByRole("button", { name: "确认结算" });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText("connection timeout")).toBeInTheDocument();
    });
  });

  it("前端校验拦截超付（支付金额 > 待收 + 0.01）", async () => {
    const user = userEvent.setup();
    const supabase = createMockSupabase();
    vi.mocked(mockFrom).mockImplementation(supabase.from as never);

    const params = Promise.resolve({ id: "wo-1" });
    render(<PaymentPage params={params} />);

    await waitFor(() => expect(screen.getByText("工单结算")).toBeInTheDocument());

    const amountInput = screen.getAllByPlaceholderText("金额")[0] as HTMLInputElement;
    await user.clear(amountInput);
    await user.type(amountInput, "301");

    const submitBtn = screen.getByRole("button", { name: "确认结算" });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText("本次支付金额不能超过待收金额")).toBeInTheDocument();
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

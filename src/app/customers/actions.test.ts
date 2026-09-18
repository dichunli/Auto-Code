import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 新建客户 Server Action 单元测试（打桩，不连真实数据库）
 *
 * 为什么要有（9-15 诊断🟠#7）：客户创建是核心业务路径，此前零测试。
 * 覆盖：未登录拒绝 / 必填兜底校验 / 手机号查重拦截 / 正常创建（含附属表写入）。
 */

/* vi.mock 工厂里引用的变量必须先经 vi.hoisted 提升 */
const { mock验证用户已登录, mockCreateClient, mockFrom } = vi.hoisted(() => ({
  mock验证用户已登录: vi.fn(),
  mockCreateClient: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  验证用户已登录: mock验证用户已登录,
  createClient: mockCreateClient,
}));

import { 新建客户 } from "./actions";

/* 造一条 supabase 查询链：select().eq().maybeSingle() / insert().select().single() / insert() */
function 造链(结果: { data?: unknown; error?: unknown }) {
  const 链 = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: 结果.data ?? null, error: 结果.error ?? null }),
    single: vi.fn().mockResolvedValue({ data: 结果.data ?? null, error: 结果.error ?? null }),
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: 结果.data ?? null, error: 结果.error ?? null }),
  };
  return 链;
}

const 基础参数 = {
  customer: {
    name: "张三",
    phone: "13800138000",
    gender: "",
    address: "",
    company: "",
    id_card: "",
    notes: "",
  },
  hasPhone: true,
  customerPhotos: [] as string[],
  customerPhones: [] as { phone: string; label: string }[],
  contacts: [] as { name: string; phone: string; relationship: string; notes: string }[],
  vehicles: [] as {
    plate_number: string; vin: string; brand: string; model: string;
    engine_no: string; chassis_code: string; transmission_type: string;
    transmission_code: string; color: string; year: string; mileage: string; notes: string;
  }[],
};

describe("新建客户 Server Action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({ from: mockFrom });
    mock验证用户已登录.mockResolvedValue({ user: { id: "user-1" }, error: null });
  });

  it("未登录 → 拒绝，不碰数据库", async () => {
    mock验证用户已登录.mockResolvedValue({ user: null, error: "未登录或登录已过期" });
    const r = await 新建客户(基础参数);
    expect(r.success).toBe(false);
    expect(r.error).toContain("未登录");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("姓名为空 → 服务端兜底拒绝", async () => {
    const r = await 新建客户({
      ...基础参数,
      customer: { ...基础参数.customer, name: "   " },
    });
    expect(r.success).toBe(false);
    expect(r.error).toContain("姓名");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("手机号已存在 → 查重拦截，不插入", async () => {
    mockFrom.mockImplementation((表: string) => {
      if (表 === "customers") return 造链({ data: { id: "已有客户" } }); /* 查重命中 */
      return 造链({});
    });
    const r = await 新建客户(基础参数);
    expect(r.success).toBe(false);
    expect(r.error).toContain("手机号已存在");
    /* 只调了查重，没走 insert */
    const 链 = mockFrom.mock.results[0].value;
    expect(链.insert).not.toHaveBeenCalled();
  });

  it("正常创建：主表插入后写附属表（照片/备用号/联系人/车辆）", async () => {
    const 插入的表: string[] = [];
    mockFrom.mockImplementation((表: string) => {
      if (表 === "customers") {
        /* 第一次是查重（maybeSingle 返回 null），第二次是插入（single 返回 id） */
        const 链 = 造链({});
        链.insert = vi.fn().mockImplementation(() => {
          插入的表.push(表);
          return { select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "新客户id" }, error: null }) }) };
        });
        return 链;
      }
      return (() => {
        const 链 = 造链({});
        链.insert = vi.fn().mockImplementation(() => {
          插入的表.push(表);
          return Promise.resolve({ error: null });
        });
        return 链;
      })();
    });

    const r = await 新建客户({
      ...基础参数,
      customerPhotos: ["https://example.com/a.jpg"],
      customerPhones: [{ phone: "13900139000", label: "单位" }],
      contacts: [{ name: "李四", phone: "13700137000", relationship: "配偶", notes: "" }],
      vehicles: [{
        plate_number: "京A12345", vin: "", brand: "大众", model: "迈腾",
        engine_no: "", chassis_code: "", transmission_type: "", transmission_code: "",
        color: "", year: "", mileage: "", notes: "",
      }],
    });

    expect(r.success).toBe(true);
    expect(r.id).toBe("新客户id");
    expect(插入的表).toEqual(
      expect.arrayContaining(["customers", "customer_photos", "customer_phones", "customer_contacts", "vehicles"])
    );
  });

  it("主表插入失败 → 返回友好错误，不写附属表", async () => {
    mockFrom.mockImplementation((表: string) => {
      if (表 === "customers") {
        const 链 = 造链({});
        const 已查重 = false;
        链.insert = vi.fn().mockImplementation(() => {
          return {
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: { message: "duplicate key" } }),
            }),
          };
        });
        void 已查重;
        return 链;
      }
      return 造链({});
    });
    /* 查重返回空 → 走插入 → 插入报错 */
    const r = await 新建客户(基础参数);
    expect(r.success).toBe(false);
    expect(r.error).toContain("客户保存失败");
  });
});

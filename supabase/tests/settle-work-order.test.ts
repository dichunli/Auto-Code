import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

/**
 * ============================================================
 * 数据库集成测试：settle_work_order RPC 函数
 *
 * 运行前提：
 * 1. 本地 PostgreSQL / Supabase 已启动
 * 2. 所有 schema 迁移已应用（含 members / finance_accounts / finance_categories 等）
 * 3. 环境变量 TEST_DATABASE_URL 已配置，例如：
 *    postgresql://postgres:postgres@localhost:54322/postgres
 *
 * 启动 Supabase 本地实例后运行：
 *   npx vitest run supabase/tests/settle-work-order.test.ts
 * ============================================================
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:54322/postgres";

let client: Client;

// 测试数据句柄
let testCustomerId: string;
let testVehicleId: string;
let testWorkOrderId: string;
let testMemberId: string;
let testAccountId: string;
let testMechanicId: string;
let testServiceItemId: string;

async function query(sql: string, values?: unknown[]) {
  const res = await client.query(sql, values);
  return res;
}

async function callSettleWorkOrder(
  orderId: string,
  discountAmount: number,
  payments: Array<{ method: string; amount: number; member_id?: string }>,
  accountId: string,
  notes?: string
) {
  const res = await query(
    `SELECT settle_work_order($1::UUID, $2::DECIMAL, $3::JSONB, $4::UUID, $5::TEXT) as result`,
    [orderId, discountAmount, JSON.stringify(payments), accountId, notes || null]
  );
  return res.rows[0].result as {
    success: boolean;
    error?: string;
    total_cost?: number;
  };
}

async function createTestWorkOrder(opts: {
  partsCost?: number;
  laborCost?: number;
  otherCost?: number;
  advancePayment?: number;
  status?: string;
  discountAmount?: number;
} = {}) {
  const {
    partsCost = 100,
    laborCost = 150,
    otherCost = 50,
    advancePayment = 0,
    status = "pending_settlement",
    discountAmount = 0,
  } = opts;

  // 使用临时 customer / vehicle 避免外键冲突
  const custRes = await query(
    `INSERT INTO customers (name, phone) VALUES ('测试客户', '13800138000') RETURNING id`
  );
  const customerId = custRes.rows[0].id;

  const vehRes = await query(
    `INSERT INTO vehicles (customer_id, plate_number) VALUES ($1, '京A99999') RETURNING id`,
    [customerId]
  );
  const vehicleId = vehRes.rows[0].id;

  const woRes = await query(
    `INSERT INTO work_orders (order_no, vehicle_id, customer_id, mileage_in, parts_cost, labor_cost, other_cost, advance_payment, discount_amount, status)
     VALUES ('WO-TEST-' || nextval('test_seq'), $1, $2, 5000, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [vehicleId, customerId, partsCost, laborCost, otherCost, advancePayment, discountAmount, status]
  );
  const workOrderId = woRes.rows[0].id;

  // 创建至少一个 work_order_item（使折扣逻辑有东西可改）
  await query(
    `INSERT INTO work_order_items (work_order_id, name, item_type, quantity, unit_price, business_type)
     VALUES ($1, '测试项目', 'labor', 1, 150, 'normal')`,
    [workOrderId]
  );

  return { customerId, vehicleId, workOrderId };
}

async function cleanupWorkOrder(workOrderId: string, customerId: string, vehicleId: string) {
  await query(`DELETE FROM accounts_receivable WHERE work_order_id = $1`, [workOrderId]);
  await query(`DELETE FROM member_transactions WHERE work_order_id = $1`, [workOrderId]);
  await query(`DELETE FROM finance_transactions WHERE related_id = $1 AND related_type = 'work_order'`, [workOrderId]);
  await query(`DELETE FROM payments WHERE work_order_id = $1`, [workOrderId]);
  await query(`DELETE FROM work_order_item_mechanics WHERE work_order_item_id IN (SELECT id FROM work_order_items WHERE work_order_id = $1)`, [workOrderId]);
  await query(`DELETE FROM work_order_items WHERE work_order_id = $1`, [workOrderId]);
  await query(`DELETE FROM work_orders WHERE id = $1`, [workOrderId]);
  await query(`DELETE FROM vehicles WHERE id = $1`, [vehicleId]);
  await query(`DELETE FROM customers WHERE id = $1`, [customerId]);
}

describe("settle_work_order RPC - 数据库集成测试", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();

    // 创建自增序列用于生成唯一订单号
    await query(`CREATE SEQUENCE IF NOT EXISTS test_seq START 1`);

    // 准备基础数据：资金账户、会员、财务分类
    const accRes = await query(
      `INSERT INTO finance_accounts (name, account_type, is_active) VALUES ('测试账户', 'cash', true) ON CONFLICT DO NOTHING RETURNING id`
    );
    testAccountId =
      accRes.rows[0]?.id ||
      (await query(`SELECT id FROM finance_accounts WHERE name = '测试账户'`)).rows[0].id;

    const memberRes = await query(
      `INSERT INTO members (card_no, name, phone, balance, status)
       VALUES ('T001', '测试会员', '13900139000', 500, 'active')
       ON CONFLICT (card_no) DO UPDATE SET balance = 500, status = 'active'
       RETURNING id`
    );
    testMemberId = memberRes.rows[0].id;

    // 确保财务分类存在
    await query(
      `INSERT INTO finance_categories (name, type, sort_order)
       VALUES ('维修收入', 'income', 1)
       ON CONFLICT DO NOTHING`
    );
  });

  afterAll(async () => {
    await query(`DROP SEQUENCE IF EXISTS test_seq`);
    await client.end();
  });

  // ============================================================
  // 正常流程
  // ============================================================
  describe("正常流程", () => {
    it("无折扣，现金全额支付 → 结算成功", async () => {
      const { customerId, vehicleId, workOrderId } = await createTestWorkOrder({
        partsCost: 100,
        laborCost: 150,
        otherCost: 50,
      });

      const result = await callSettleWorkOrder(
        workOrderId,
        0,
        [{ method: "cash", amount: 300 }],
        testAccountId
      );

      expect(result.success).toBe(true);
      expect(result.total_cost).toBe(300);

      // 验证工单状态
      const woRes = await query(`SELECT status, settled_at, discount_amount FROM work_orders WHERE id = $1`, [workOrderId]);
      expect(woRes.rows[0].status).toBe("settled");
      expect(woRes.rows[0].settled_at).not.toBeNull();
      expect(parseFloat(woRes.rows[0].discount_amount)).toBe(0);

      // 验证支付记录
      const payRes = await query(`SELECT method, amount FROM payments WHERE work_order_id = $1`, [workOrderId]);
      expect(payRes.rows).toHaveLength(1);
      expect(payRes.rows[0].method).toBe("cash");
      expect(parseFloat(payRes.rows[0].amount)).toBe(300);

      // 验证财务流水
      const ftRes = await query(`SELECT amount FROM finance_transactions WHERE related_id = $1 AND related_type = 'work_order'`, [workOrderId]);
      expect(ftRes.rows).toHaveLength(1);
      expect(parseFloat(ftRes.rows[0].amount)).toBe(300);

      await cleanupWorkOrder(workOrderId, customerId, vehicleId);
    });

    it("有折扣，现金支付折扣后金额 → 结算成功并更新项目单价", async () => {
      const { customerId, vehicleId, workOrderId } = await createTestWorkOrder({
        partsCost: 100,
        laborCost: 200,
        otherCost: 0,
      });

      const result = await callSettleWorkOrder(
        workOrderId,
        50,
        [{ method: "cash", amount: 250 }],
        testAccountId
      );

      expect(result.success).toBe(true);

      // 验证工单折扣信息
      const woRes = await query(`SELECT discount_amount, discount_rate, labor_cost FROM work_orders WHERE id = $1`, [workOrderId]);
      expect(parseFloat(woRes.rows[0].discount_amount)).toBe(50);
      // 折扣率 = 250 / 300 ≈ 0.83333333
      expect(parseFloat(woRes.rows[0].discount_rate)).toBeCloseTo(250 / 300, 6);

      // 验证项目单价已被折扣（原始 150，折扣后约 125）
      const itemRes = await query(`SELECT unit_price FROM work_order_items WHERE work_order_id = $1 AND name = '测试项目'`, [workOrderId]);
      expect(parseFloat(itemRes.rows[0].unit_price)).toBeCloseTo(125, 2);

      await cleanupWorkOrder(workOrderId, customerId, vehicleId);
    });

    it("会员支付 → 扣减余额并生成交易记录", async () => {
      const { customerId, vehicleId, workOrderId } = await createTestWorkOrder({
        partsCost: 0,
        laborCost: 100,
        otherCost: 0,
      });

      const beforeBalance = parseFloat(
        (await query(`SELECT balance FROM members WHERE id = $1`, [testMemberId])).rows[0].balance
      );

      const result = await callSettleWorkOrder(
        workOrderId,
        0,
        [{ method: "member", amount: 100, member_id: testMemberId }],
        testAccountId
      );

      expect(result.success).toBe(true);

      // 验证会员余额扣减
      const afterBalance = parseFloat(
        (await query(`SELECT balance FROM members WHERE id = $1`, [testMemberId])).rows[0].balance
      );
      expect(afterBalance).toBe(beforeBalance - 100);

      // 验证会员交易记录
      const mtRes = await query(`SELECT type, amount, balance_after FROM member_transactions WHERE member_id = $1 AND work_order_id = $2`, [testMemberId, workOrderId]);
      expect(mtRes.rows).toHaveLength(1);
      expect(mtRes.rows[0].type).toBe("consume");
      expect(parseFloat(mtRes.rows[0].amount)).toBe(100);
      expect(parseFloat(mtRes.rows[0].balance_after)).toBe(afterBalance);

      // 恢复会员余额
      await query(`UPDATE members SET balance = balance + 100 WHERE id = $1`, [testMemberId]);
      await cleanupWorkOrder(workOrderId, customerId, vehicleId);
    });

    it("挂账支付 → 生成应收账款", async () => {
      const { customerId, vehicleId, workOrderId } = await createTestWorkOrder({
        partsCost: 0,
        laborCost: 200,
        otherCost: 0,
      });

      const result = await callSettleWorkOrder(
        workOrderId,
        0,
        [{ method: "credit", amount: 200 }],
        testAccountId
      );

      expect(result.success).toBe(true);

      // 验证应收账款
      const arRes = await query(`SELECT amount, status, notes FROM accounts_receivable WHERE work_order_id = $1`, [workOrderId]);
      expect(arRes.rows).toHaveLength(1);
      expect(parseFloat(arRes.rows[0].amount)).toBe(200);
      expect(arRes.rows[0].status).toBe("pending");
      expect(arRes.rows[0].notes).toContain("挂账");

      // 验证无财务流水（挂账不是实收）
      const ftRes = await query(`SELECT * FROM finance_transactions WHERE related_id = $1`, [workOrderId]);
      expect(ftRes.rows).toHaveLength(0);

      await cleanupWorkOrder(workOrderId, customerId, vehicleId);
    });

    it("混合支付（现金 + 会员 + 挂账）→ 分别生成对应记录", async () => {
      const { customerId, vehicleId, workOrderId } = await createTestWorkOrder({
        partsCost: 0,
        laborCost: 300,
        otherCost: 0,
      });

      const result = await callSettleWorkOrder(
        workOrderId,
        0,
        [
          { method: "cash", amount: 100 },
          { method: "member", amount: 50, member_id: testMemberId },
          { method: "credit", amount: 150 },
        ],
        testAccountId
      );

      expect(result.success).toBe(true);

      // 支付记录 3 条
      const payRes = await query(`SELECT method, amount FROM payments WHERE work_order_id = $1 ORDER BY method`, [workOrderId]);
      expect(payRes.rows).toHaveLength(3);

      // 财务流水只记录实收（现金 100，会员不算实收）
      const ftRes = await query(`SELECT amount FROM finance_transactions WHERE related_id = $1`, [workOrderId]);
      expect(ftRes.rows).toHaveLength(1);
      expect(parseFloat(ftRes.rows[0].amount)).toBe(100);

      // 挂账应收账款
      const arRes = await query(`SELECT amount FROM accounts_receivable WHERE work_order_id = $1 AND notes LIKE '%挂账%'`, [workOrderId]);
      expect(arRes.rows).toHaveLength(1);
      expect(parseFloat(arRes.rows[0].amount)).toBe(150);

      await query(`UPDATE members SET balance = balance + 50 WHERE id = $1`, [testMemberId]);
      await cleanupWorkOrder(workOrderId, customerId, vehicleId);
    });
  });

  // ============================================================
  // 边界情况
  // ============================================================
  describe("边界情况", () => {
    it("折扣为 0 → 不修改项目单价", async () => {
      const { customerId, vehicleId, workOrderId } = await createTestWorkOrder();

      const result = await callSettleWorkOrder(
        workOrderId,
        0,
        [{ method: "cash", amount: 300 }],
        testAccountId
      );

      expect(result.success).toBe(true);

      const itemRes = await query(`SELECT unit_price FROM work_order_items WHERE work_order_id = $1`, [workOrderId]);
      expect(parseFloat(itemRes.rows[0].unit_price)).toBe(150); // 未变更

      await cleanupWorkOrder(workOrderId, customerId, vehicleId);
    });

    it("精确支付（一分不差）→ 成功", async () => {
      const { customerId, vehicleId, workOrderId } = await createTestWorkOrder({
        partsCost: 100.55,
        laborCost: 0,
        otherCost: 0,
      });

      const result = await callSettleWorkOrder(
        workOrderId,
        0,
        [{ method: "cash", amount: 100.55 }],
        testAccountId
      );

      expect(result.success).toBe(true);
      await cleanupWorkOrder(workOrderId, customerId, vehicleId);
    });

    it("允许 0.01 的浮点误差 → 成功", async () => {
      const { customerId, vehicleId, workOrderId } = await createTestWorkOrder({
        partsCost: 100,
        laborCost: 0,
        otherCost: 0,
      });

      const result = await callSettleWorkOrder(
        workOrderId,
        0,
        [{ method: "cash", amount: 100.01 }],
        testAccountId
      );

      expect(result.success).toBe(true);
      await cleanupWorkOrder(workOrderId, customerId, vehicleId);
    });

    it("超出 0.01 误差 → 失败", async () => {
      const { customerId, vehicleId, workOrderId } = await createTestWorkOrder({
        partsCost: 100,
        laborCost: 0,
        otherCost: 0,
      });

      const result = await callSettleWorkOrder(
        workOrderId,
        0,
        [{ method: "cash", amount: 100.02 }],
        testAccountId
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("不能超过待收金额");
      await cleanupWorkOrder(workOrderId, customerId, vehicleId);
    });

    it("预付款抵扣后本次支付刚好补足 → 成功", async () => {
      const { customerId, vehicleId, workOrderId } = await createTestWorkOrder({
        partsCost: 100,
        laborCost: 0,
        otherCost: 0,
        advancePayment: 30,
      });

      const result = await callSettleWorkOrder(
        workOrderId,
        0,
        [{ method: "cash", amount: 70 }],
        testAccountId
      );

      expect(result.success).toBe(true);
      await cleanupWorkOrder(workOrderId, customerId, vehicleId);
    });

    it("预付款超过折扣后总额 → 失败", async () => {
      const { customerId, vehicleId, workOrderId } = await createTestWorkOrder({
        partsCost: 100,
        laborCost: 0,
        otherCost: 0,
        advancePayment: 150,
      });

      const result = await callSettleWorkOrder(
        workOrderId,
        0,
        [{ method: "cash", amount: 0 }],
        testAccountId
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("预付款金额已超过折扣后总额");
      await cleanupWorkOrder(workOrderId, customerId, vehicleId);
    });

    it("尾款未结清 → 生成尾款应收账款", async () => {
      const { customerId, vehicleId, workOrderId } = await createTestWorkOrder({
        partsCost: 100,
        laborCost: 0,
        otherCost: 0,
      });

      const result = await callSettleWorkOrder(
        workOrderId,
        0,
        [{ method: "cash", amount: 60 }],
        testAccountId
      );

      expect(result.success).toBe(true);

      // 尾款 40
      const arRes = await query(`SELECT amount, notes FROM accounts_receivable WHERE work_order_id = $1 AND notes LIKE '%尾款%'`, [workOrderId]);
      expect(arRes.rows).toHaveLength(1);
      expect(parseFloat(arRes.rows[0].amount)).toBe(40);

      await cleanupWorkOrder(workOrderId, customerId, vehicleId);
    });
  });

  // ============================================================
  // 异常场景
  // ============================================================
  describe("异常场景", () => {
    it("工单不存在 → 失败", async () => {
      const result = await callSettleWorkOrder(
        "00000000-0000-0000-0000-000000000000",
        0,
        [{ method: "cash", amount: 100 }],
        testAccountId
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("工单不存在");
    });

    it("重复结算 → 失败", async () => {
      const { customerId, vehicleId, workOrderId } = await createTestWorkOrder({ status: "settled" });

      const result = await callSettleWorkOrder(
        workOrderId,
        0,
        [{ method: "cash", amount: 100 }],
        testAccountId
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("工单已结算，不能重复结算");
      await cleanupWorkOrder(workOrderId, customerId, vehicleId);
    });

    it("折扣金额大于工单总额 → 失败", async () => {
      const { customerId, vehicleId, workOrderId } = await createTestWorkOrder({
        partsCost: 100,
        laborCost: 0,
        otherCost: 0,
      });

      const result = await callSettleWorkOrder(
        workOrderId,
        150,
        [{ method: "cash", amount: 0 }],
        testAccountId
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("折扣金额不能大于工单总额");
      await cleanupWorkOrder(workOrderId, customerId, vehicleId);
    });

    it("负数折扣 → 失败", async () => {
      const { customerId, vehicleId, workOrderId } = await createTestWorkOrder();

      const result = await callSettleWorkOrder(
        workOrderId,
        -10,
        [{ method: "cash", amount: 300 }],
        testAccountId
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("折扣金额不能为负数");
      await cleanupWorkOrder(workOrderId, customerId, vehicleId);
    });

    it("支付金额小于等于 0 → 失败", async () => {
      const { customerId, vehicleId, workOrderId } = await createTestWorkOrder();

      const result = await callSettleWorkOrder(
        workOrderId,
        0,
        [{ method: "cash", amount: 0 }],
        testAccountId
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("支付金额必须大于 0");
      await cleanupWorkOrder(workOrderId, customerId, vehicleId);
    });

    it("负数支付金额 → 失败", async () => {
      const { customerId, vehicleId, workOrderId } = await createTestWorkOrder();

      const result = await callSettleWorkOrder(
        workOrderId,
        0,
        [{ method: "cash", amount: -10 }],
        testAccountId
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("支付金额不能为负数");
      await cleanupWorkOrder(workOrderId, customerId, vehicleId);
    });

    it("会员支付未传 member_id → 失败", async () => {
      const { customerId, vehicleId, workOrderId } = await createTestWorkOrder({
        partsCost: 0,
        laborCost: 100,
        otherCost: 0,
      });

      const result = await callSettleWorkOrder(
        workOrderId,
        0,
        [{ method: "member", amount: 100 }],
        testAccountId
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("请选择会员");
      await cleanupWorkOrder(workOrderId, customerId, vehicleId);
    });

    it("会员不存在 → 失败", async () => {
      const { customerId, vehicleId, workOrderId } = await createTestWorkOrder({
        partsCost: 0,
        laborCost: 100,
        otherCost: 0,
      });

      const result = await callSettleWorkOrder(
        workOrderId,
        0,
        [{ method: "member", amount: 100, member_id: "00000000-0000-0000-0000-000000000000" }],
        testAccountId
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("会员不存在");
      await cleanupWorkOrder(workOrderId, customerId, vehicleId);
    });

    it("会员余额不足 → 失败", async () => {
      const { customerId, vehicleId, workOrderId } = await createTestWorkOrder({
        partsCost: 0,
        laborCost: 1000,
        otherCost: 0,
      });

      const result = await callSettleWorkOrder(
        workOrderId,
        0,
        [{ method: "member", amount: 1000, member_id: testMemberId }],
        testAccountId
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("会员余额不足");
      await cleanupWorkOrder(workOrderId, customerId, vehicleId);
    });

    it("会员状态非 active → 失败", async () => {
      const { customerId, vehicleId, workOrderId } = await createTestWorkOrder({
        partsCost: 0,
        laborCost: 100,
        otherCost: 0,
      });

      // 临时冻结会员
      await query(`UPDATE members SET status = 'frozen' WHERE id = $1`, [testMemberId]);

      const result = await callSettleWorkOrder(
        workOrderId,
        0,
        [{ method: "member", amount: 100, member_id: testMemberId }],
        testAccountId
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("会员已失效");

      await query(`UPDATE members SET status = 'active' WHERE id = $1`, [testMemberId]);
      await cleanupWorkOrder(workOrderId, customerId, vehicleId);
    });
  });

  // ============================================================
  // 并发安全
  // ============================================================
  describe("并发安全", () => {
    it("并发重复结算 → 仅一个成功", async () => {
      const { customerId, vehicleId, workOrderId } = await createTestWorkOrder();

      const client2 = new Client({ connectionString: DATABASE_URL });
      await client2.connect();

      // 两个并行请求同时结算同一工单
      const promise1 = callSettleWorkOrder(
        workOrderId,
        0,
        [{ method: "cash", amount: 300 }],
        testAccountId
      );
      const promise2 = (async () => {
        const res = await client2.query(
          `SELECT settle_work_order($1::UUID, $2::DECIMAL, $3::JSONB, $4::UUID, $5::TEXT) as result`,
          [workOrderId, 0, JSON.stringify([{ method: "wechat", amount: 300 }]), testAccountId, null]
        );
        return res.rows[0].result as { success: boolean; error?: string };
      })();

      const [result1, result2] = await Promise.all([promise1, promise2]);

      const successCount = [result1, result2].filter((r) => r.success).length;
      const failCount = [result1, result2].filter((r) => !r.success).length;

      // 只有一个成功，另一个被 FOR UPDATE 锁拦截
      expect(successCount).toBe(1);
      expect(failCount).toBe(1);

      // 验证只有一条支付记录
      const payRes = await query(`SELECT COUNT(*) as cnt FROM payments WHERE work_order_id = $1`, [workOrderId]);
      expect(parseInt(payRes.rows[0].cnt)).toBe(1);

      await client2.end();
      await cleanupWorkOrder(workOrderId, customerId, vehicleId);
    });
  });
});

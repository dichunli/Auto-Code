import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

/**
 * ============================================================
 * 数据库集成测试：返工解锁回滚收款（unlock_work_order_settlement）
 *   （迁移 migrations_20260919_s_unlock_settlement_rpc.sql）
 *
 * 背景 bug（最高危）：旧解锁只翻 status，payments/财务流水/会员扣款/应收
 *   全部留原地，可重复结算重复入账。
 * 修复：解锁 = 单事务完整撤销结算资金痕迹；应收已核销的拒绝解锁。
 *
 * 运行前提：
 *   1. 本地 Supabase 已启动且所有迁移已应用（含 20260919_q、20260919000002、_s）
 *   2. 环境变量 TEST_DATABASE_URL（默认 postgresql://postgres:postgres@localhost:54322/postgres）
 *
 * 运行：npx vitest run supabase/tests/unlock-settlement.test.ts
 * ============================================================
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:54322/postgres";

const TEST_USER_ID = "cdcdcdcd-cdcd-4bcd-8bcd-cdcdcdcdcdcd";
const NOBODY_USER_ID = "cdcdcdcd-cdcd-4bcd-8bcd-cececececece";
const PFX = "TESTUL-";

let client: Client;
let accountId: string;
let memberId: string;

interface RPC结果 {
  success: boolean;
  error?: string;
  payments_deleted?: number;
  finance_deleted?: number;
  member_refunded?: number;
}

async function query(sql: string, values?: unknown[]) {
  return client.query(sql, values);
}

/* 在事务内注入登录身份后调用（函数返回 JSONB 不中断事务） */
async function withAuth<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  await client.query(
    `SELECT set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: userId, role: "authenticated" })]
  );
  try {
    const out = await fn();
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function 余额(): Promise<number> {
  const res = await query(`SELECT balance FROM finance_accounts WHERE id = $1`, [accountId]);
  return Number(res.rows[0].balance);
}

async function 会员余额(): Promise<number> {
  const res = await query(`SELECT balance FROM members WHERE id = $1`, [memberId]);
  return Number(res.rows[0].balance);
}

async function 造工单(): Promise<{ workOrderId: string; customerId: string; vehicleId: string }> {
  const 随机 = Math.random().toString().slice(2, 10);
  const cust = await query(`INSERT INTO customers (name, phone) VALUES ($1, $2) RETURNING id`, [`${PFX}客户`, `136${随机}`]);
  const veh = await query(
    `INSERT INTO vehicles (customer_id, plate_number) VALUES ($1, $2) RETURNING id`,
    [cust.rows[0].id, `${PFX}${随机.slice(0, 4)}`]
  );
  const wo = await query(
    `INSERT INTO work_orders (order_no, vehicle_id, customer_id, mileage_in, parts_cost, labor_cost, other_cost, advance_payment, discount_amount, status)
     VALUES ($1, $2, $3, 5000, 0, 300, 0, 0, 0, 'pending_settlement') RETURNING id`,
    [`${PFX}WO${随机}`, veh.rows[0].id, cust.rows[0].id]
  );
  await query(
    `INSERT INTO work_order_items (work_order_id, name, item_type, quantity, unit_price, business_type)
     VALUES ($1, '测试项目', 'labor', 1, 300, 'normal')`,
    [wo.rows[0].id]
  );
  return { workOrderId: wo.rows[0].id, customerId: cust.rows[0].id, vehicleId: veh.rows[0].id };
}

async function 清理工单(t: { workOrderId: string; customerId: string; vehicleId: string }) {
  await query(`DELETE FROM finance_transactions WHERE related_type = 'work_order' AND related_id = $1`, [t.workOrderId]);
  await query(`DELETE FROM member_transactions WHERE work_order_id = $1`, [t.workOrderId]);
  await query(`DELETE FROM payments WHERE work_order_id = $1`, [t.workOrderId]);
  await query(`DELETE FROM accounts_receivable WHERE work_order_id = $1`, [t.workOrderId]);
  await query(`DELETE FROM work_order_items WHERE work_order_id = $1`, [t.workOrderId]);
  await query(`DELETE FROM work_orders WHERE id = $1`, [t.workOrderId]);
  await query(`DELETE FROM vehicles WHERE id = $1`, [t.vehicleId]);
  await query(`DELETE FROM customers WHERE id = $1`, [t.customerId]);
}

async function 结算(workOrderId: string, payments: Array<Record<string, unknown>>): Promise<RPC结果> {
  const res = await query(
    `SELECT settle_work_order($1::UUID, 0, $2::JSONB, $3::UUID, NULL) AS result`,
    [workOrderId, JSON.stringify(payments), accountId]
  );
  return res.rows[0].result as RPC结果;
}

async function 解锁(workOrderId: string): Promise<RPC结果> {
  const res = await query(`SELECT unlock_work_order_settlement($1::UUID) AS result`, [workOrderId]);
  return res.rows[0].result as RPC结果;
}

describe("返工解锁回滚收款 - 数据库集成测试", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();

    /* 清历史残留 */
    await query(`DELETE FROM finance_accounts WHERE name LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM member_transactions WHERE member_id IN (SELECT id FROM members WHERE card_no LIKE $1)`, [`${PFX}%`]);
    await query(`DELETE FROM members WHERE card_no LIKE $1`, [`${PFX}%`]);

    /* 造测试用户：admin + 路人 */
    for (const [uid, name] of [[TEST_USER_ID, "解锁测试员"], [NOBODY_USER_ID, "路人丁"]] as const) {
      await query(
        `INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
         VALUES ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '', now(), now(), now())
         ON CONFLICT (id) DO NOTHING`,
        [uid, `${PFX.toLowerCase()}${uid.slice(-4)}@example.com`]
      );
      await query(`INSERT INTO profiles (id, full_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [uid, name]);
    }
    await query(`INSERT INTO roles (name, label) VALUES ('admin', '管理员') ON CONFLICT (name) DO NOTHING`);
    const roleRes = await query(`SELECT id FROM roles WHERE name = 'admin'`);
    await query(
      `INSERT INTO profile_roles (profile_id, role_id) VALUES ($1, $2) ON CONFLICT (profile_id, role_id) DO NOTHING`,
      [TEST_USER_ID, roleRes.rows[0].id]
    );

    /* 资金账户（cash 解析落点以辅助函数为准）+ 会员（余额 500） */
    await query(
      `INSERT INTO finance_accounts (name, account_type, balance, is_active) VALUES ($1, 'cash', 0, true)`,
      [`${PFX}现金`]
    );
    accountId = (await query(`SELECT public.fn_finance_account_for_method('cash') AS id`)).rows[0].id;
    const m = await query(
      `INSERT INTO members (card_no, name, phone, balance, status) VALUES ($1, $2, $3, 500, 'active') RETURNING id`,
      [`${PFX}M001`, `${PFX}会员`, "13500135000"]
    );
    memberId = m.rows[0].id;
  });

  afterAll(async () => {
    await query(`DELETE FROM finance_accounts WHERE name LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM member_transactions WHERE member_id = $1`, [memberId]);
    await query(`DELETE FROM members WHERE id = $1`, [memberId]);
    await query(`DELETE FROM profile_roles WHERE profile_id IN ($1, $2)`, [TEST_USER_ID, NOBODY_USER_ID]);
    await query(`DELETE FROM profiles WHERE id IN ($1, $2)`, [TEST_USER_ID, NOBODY_USER_ID]);
    await query(`DELETE FROM auth.users WHERE id IN ($1, $2)`, [TEST_USER_ID, NOBODY_USER_ID]);
    await client.end();
  });

  /* 1. 核心回归：混合结算 → 解锁 → 全部资金痕迹回滚 → 可重新结算不重复 */
  it("结算(现金+会员+挂账) → 解锁：流水/支付/应收清空、会员退回、余额还原、可重新结算", async () => {
    const t = await 造工单();
    const 账户前 = await 余额();
    const 会员前 = await 会员余额();

    /* 结算：现金100 + 会员50 + 挂账150 = 300 */
    const s = await withAuth(TEST_USER_ID, () =>
      结算(t.workOrderId, [
        { method: "cash", amount: 100 },
        { method: "member", amount: 50, member_id: memberId },
        { method: "credit", amount: 150 },
      ])
    );
    expect(s.success).toBe(true);
    expect(await 余额()).toBe(账户前 + 100);
    expect(await 会员余额()).toBe(会员前 - 50);

    /* 解锁 */
    const u = await withAuth(TEST_USER_ID, () => 解锁(t.workOrderId));
    expect(u.success).toBe(true);
    expect(u.payments_deleted).toBe(3);
    expect(u.finance_deleted).toBe(1);
    expect(Number(u.member_refunded)).toBe(50);

    /* 状态回滚 */
    const wo = await query(`SELECT status, settled_at FROM work_orders WHERE id = $1`, [t.workOrderId]);
    expect(wo.rows[0].status).toBe("pending_settlement");
    expect(wo.rows[0].settled_at).toBeNull();

    /* 资金痕迹全部回滚 */
    expect((await query(`SELECT COUNT(*)::int AS n FROM payments WHERE work_order_id = $1`, [t.workOrderId])).rows[0].n).toBe(0);
    expect((await query(`SELECT COUNT(*)::int AS n FROM finance_transactions WHERE related_type = 'work_order' AND related_id = $1`, [t.workOrderId])).rows[0].n).toBe(0);
    expect((await query(`SELECT COUNT(*)::int AS n FROM accounts_receivable WHERE work_order_id = $1`, [t.workOrderId])).rows[0].n).toBe(0);
    expect(await 余额()).toBe(账户前);
    expect(await 会员余额()).toBe(会员前);

    /* 会员审计链完整：consume 留档 + refund 对冲 */
    const mt = await query(
      `SELECT type, amount FROM member_transactions WHERE work_order_id = $1 ORDER BY created_at`,
      [t.workOrderId]
    );
    expect(mt.rows.map((x) => x.type)).toEqual(["consume", "refund"]);

    /* 重新结算（全额现金）→ 成功且不重复 */
    const s2 = await withAuth(TEST_USER_ID, () =>
      结算(t.workOrderId, [{ method: "cash", amount: 300 }])
    );
    expect(s2.success).toBe(true);
    expect((await query(`SELECT COUNT(*)::int AS n FROM payments WHERE work_order_id = $1`, [t.workOrderId])).rows[0].n).toBe(1);
    expect((await query(`SELECT COUNT(*)::int AS n FROM finance_transactions WHERE related_type = 'work_order' AND related_id = $1`, [t.workOrderId])).rows[0].n).toBe(1);
    expect(await 余额()).toBe(账户前 + 300);

    await 清理工单(t);
    /* 恢复会员初始余额供后续用例 */
    await query(`UPDATE members SET balance = 500 WHERE id = $1`, [memberId]);
  });

  /* 2. 门禁：应收已核销的工单拒绝解锁 */
  it("欠款已被收款核销的工单 → 拒绝解锁", async () => {
    const t = await 造工单();
    const s = await withAuth(TEST_USER_ID, () =>
      结算(t.workOrderId, [{ method: "credit", amount: 300 }])
    );
    expect(s.success).toBe(true);

    /* 模拟已核销 100（直接改 paid_amount，测的是解锁门禁本身） */
    await query(`UPDATE accounts_receivable SET paid_amount = 100, status = 'partial' WHERE work_order_id = $1`, [t.workOrderId]);

    const u = await withAuth(TEST_USER_ID, () => 解锁(t.workOrderId));
    expect(u.success).toBe(false);
    expect(u.error).toContain("收款核销");

    /* 状态没被改动 */
    const wo = await query(`SELECT status FROM work_orders WHERE id = $1`, [t.workOrderId]);
    expect(wo.rows[0].status).toBe("settled");

    await 清理工单(t);
  });

  /* 3. 未结算工单不能解锁 */
  it("待结算工单 → 拒绝解锁", async () => {
    const t = await 造工单();
    const u = await withAuth(TEST_USER_ID, () => 解锁(t.workOrderId));
    expect(u.success).toBe(false);
    expect(u.error).toContain("已结算");
    await 清理工单(t);
  });

  /* 4. 无角色用户 / 未登录 → 拒绝（涉钱操作收紧的拒绝路径） */
  it("无角色用户与未登录 → 拒绝解锁", async () => {
    const t = await 造工单();
    const s = await withAuth(TEST_USER_ID, () =>
      结算(t.workOrderId, [{ method: "cash", amount: 300 }])
    );
    expect(s.success).toBe(true);

    const 路人 = await withAuth(NOBODY_USER_ID, () => 解锁(t.workOrderId));
    expect(路人.success).toBe(false);
    expect(路人.error).toContain("无权限");

    const 匿名 = await 解锁(t.workOrderId);
    expect(匿名.success).toBe(false);
    expect(匿名.error).toContain("未登录");

    /* 资金痕迹没被动 */
    expect((await query(`SELECT COUNT(*)::int AS n FROM payments WHERE work_order_id = $1`, [t.workOrderId])).rows[0].n).toBe(1);

    await 清理工单(t);
  });
});

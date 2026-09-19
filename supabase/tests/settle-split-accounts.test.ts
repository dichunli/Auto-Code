import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

/**
 * ============================================================
 * 数据库集成测试：结算混合收款按支付方式分账户记账
 *   （迁移 supabase/migrations/20260919000002_settle_split_accounts.sql）
 *
 * 背景 bug：混合收款只写一条财务流水到单一账户——现金+微信混收，
 *   微信的钱也进了现金账户，账户余额与实际渠道不符。
 * 修复口径：
 *   1. 实收按支付方式逐条记账到同类型账户（cash→现金、wechat→微信…）
 *   2. 自定义方式/无匹配账户 → 兜底用户指定的 p_account_id
 *   3. credit（挂账）/member（储值卡）不记流水（口径不变）
 *
 * 运行前提：
 *   1. 本地 Supabase 已启动且所有迁移已应用（含 20260919_q 与 20260919000002）
 *   2. 环境变量 TEST_DATABASE_URL（默认 postgresql://postgres:postgres@localhost:54322/postgres）
 *
 * 运行：npx vitest run supabase/tests/settle-split-accounts.test.ts
 * ============================================================
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:54322/postgres";

const TEST_USER_ID = "bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc";
const PFX = "TESTSA-";

let client: Client;
let cashAccountId: string;
let wechatAccountId: string;
let bankAccountId: string;
let fallbackAccountId: string;

interface RPC结果 {
  success: boolean;
  error?: string;
  total_cost?: number;
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

async function 余额(accountId: string): Promise<number> {
  const res = await query(`SELECT balance FROM finance_accounts WHERE id = $1`, [accountId]);
  return Number(res.rows[0].balance);
}

/* 造一张待结算工单，总额 300（工时） */
async function 造工单(): Promise<{ workOrderId: string; customerId: string; vehicleId: string }> {
  const 随机 = Math.random().toString().slice(2, 10);
  const cust = await query(`INSERT INTO customers (name, phone) VALUES ($1, $2) RETURNING id`, [`${PFX}客户`, `137${随机}`]);
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
  await query(`DELETE FROM payments WHERE work_order_id = $1`, [t.workOrderId]);
  await query(`DELETE FROM accounts_receivable WHERE work_order_id = $1`, [t.workOrderId]);
  await query(`DELETE FROM work_order_items WHERE work_order_id = $1`, [t.workOrderId]);
  await query(`DELETE FROM work_orders WHERE id = $1`, [t.workOrderId]);
  await query(`DELETE FROM vehicles WHERE id = $1`, [t.vehicleId]);
  await query(`DELETE FROM customers WHERE id = $1`, [t.customerId]);
}

async function 结算(
  workOrderId: string,
  payments: Array<{ method: string; amount: number }>,
  accountId: string
): Promise<RPC结果> {
  const res = await query(
    `SELECT settle_work_order($1::UUID, 0, $2::JSONB, $3::UUID, NULL) AS result`,
    [workOrderId, JSON.stringify(payments), accountId]
  );
  return res.rows[0].result as RPC结果;
}

describe("结算分账户记账 - 数据库集成测试", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();

    /* 清历史残留 */
    await query(`DELETE FROM finance_accounts WHERE name LIKE $1`, [`${PFX}%`]);

    /* 造测试用户（admin） */
    await query(
      `INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
       VALUES ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '', now(), now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `${PFX.toLowerCase()}admin@example.com`]
    );
    await query(`INSERT INTO profiles (id, full_name) VALUES ($1, '分账户测试员') ON CONFLICT (id) DO NOTHING`, [TEST_USER_ID]);
    await query(`INSERT INTO roles (name, label) VALUES ('admin', '管理员') ON CONFLICT (name) DO NOTHING`);
    const roleRes = await query(`SELECT id FROM roles WHERE name = 'admin'`);
    await query(
      `INSERT INTO profile_roles (profile_id, role_id) VALUES ($1, $2) ON CONFLICT (profile_id, role_id) DO NOTHING`,
      [TEST_USER_ID, roleRes.rows[0].id]
    );

    /* 四个账户：现金、微信、银行、兜底（other 类型）。解析落点以辅助函数实际结果为准 */
    await query(
      `INSERT INTO finance_accounts (name, account_type, balance, is_active) VALUES
       ($1, 'cash', 0, true), ($2, 'wechat', 0, true), ($3, 'bank', 0, true), ($4, 'other', 0, true)`,
      [`${PFX}现金`, `${PFX}微信`, `${PFX}银行`, `${PFX}兜底`]
    );
    cashAccountId = (await query(`SELECT public.fn_finance_account_for_method('cash') AS id`)).rows[0].id;
    wechatAccountId = (await query(`SELECT public.fn_finance_account_for_method('wechat') AS id`)).rows[0].id;
    bankAccountId = (await query(`SELECT public.fn_finance_account_for_method('bank_transfer') AS id`)).rows[0].id;
    /* 兜底账户用一个不会被任何方式映射抢走的：直接拿我们建的 other 账户 */
    fallbackAccountId = (await query(`SELECT id FROM finance_accounts WHERE name = $1`, [`${PFX}兜底`])).rows[0].id;
  });

  afterAll(async () => {
    await query(`DELETE FROM finance_accounts WHERE name LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM profile_roles WHERE profile_id = $1`, [TEST_USER_ID]);
    await query(`DELETE FROM profiles WHERE id = $1`, [TEST_USER_ID]);
    await query(`DELETE FROM auth.users WHERE id = $1`, [TEST_USER_ID]);
    await client.end();
  });

  /* 1. 核心回归：现金+微信混收 → 两条流水各进各的账户 */
  it("现金100+微信200 混合收款 → 两条流水分别进现金账户和微信账户", async () => {
    const t = await 造工单();
    const 现金前 = await 余额(cashAccountId);
    const 微信前 = await 余额(wechatAccountId);

    const r = await withAuth(TEST_USER_ID, () =>
      结算(t.workOrderId, [
        { method: "cash", amount: 100 },
        { method: "wechat", amount: 200 },
      ], fallbackAccountId)
    );
    expect(r.success).toBe(true);

    const ft = await query(
      `SELECT account_id, amount FROM finance_transactions
       WHERE related_type = 'work_order' AND related_id = $1 ORDER BY amount`,
      [t.workOrderId]
    );
    expect(ft.rows.length).toBe(2);
    expect(ft.rows[0].account_id).toBe(cashAccountId);
    expect(Number(ft.rows[0].amount)).toBe(100);
    expect(ft.rows[1].account_id).toBe(wechatAccountId);
    expect(Number(ft.rows[1].amount)).toBe(200);

    /* 账户余额各加各的（修复前：300 全进用户选的那一个账户） */
    expect(await 余额(cashAccountId)).toBe(现金前 + 100);
    expect(await 余额(wechatAccountId)).toBe(微信前 + 200);

    await 清理工单(t);
  });

  /* 2. 银行转账 → 进银行账户（payments.method 有 CHECK，只允许字典内编码，
        自定义编码走不进结算，兜底账户逻辑由辅助函数单测覆盖） */
  it("银行转账收款 → 流水进银行账户", async () => {
    const t = await 造工单();
    const 银行前 = await 余额(bankAccountId);

    const r = await withAuth(TEST_USER_ID, () =>
      结算(t.workOrderId, [{ method: "bank_transfer", amount: 300 }], fallbackAccountId)
    );
    expect(r.success).toBe(true);

    const ft = await query(
      `SELECT account_id, amount FROM finance_transactions
       WHERE related_type = 'work_order' AND related_id = $1`,
      [t.workOrderId]
    );
    expect(ft.rows.length).toBe(1);
    expect(ft.rows[0].account_id).toBe(bankAccountId);
    expect(Number(ft.rows[0].amount)).toBe(300);
    expect(await 余额(bankAccountId)).toBe(银行前 + 300);

    await 清理工单(t);
  });

  /* 3. 挂账+现金混收：挂账不进流水、进应收；现金进现金账户 */
  it("现金100+挂账200 → 只有 1 条现金流水，200 进应收账款", async () => {
    const t = await 造工单();
    const 现金前 = await 余额(cashAccountId);

    const r = await withAuth(TEST_USER_ID, () =>
      结算(t.workOrderId, [
        { method: "cash", amount: 100 },
        { method: "credit", amount: 200 },
      ], fallbackAccountId)
    );
    expect(r.success).toBe(true);

    const ft = await query(
      `SELECT account_id, amount FROM finance_transactions
       WHERE related_type = 'work_order' AND related_id = $1`,
      [t.workOrderId]
    );
    expect(ft.rows.length).toBe(1);
    expect(ft.rows[0].account_id).toBe(cashAccountId);
    expect(Number(ft.rows[0].amount)).toBe(100);
    expect(await 余额(cashAccountId)).toBe(现金前 + 100);

    const ar = await query(
      `SELECT amount, notes FROM accounts_receivable WHERE work_order_id = $1`,
      [t.workOrderId]
    );
    expect(ar.rows.length).toBe(1);
    expect(Number(ar.rows[0].amount)).toBe(200);
    expect(ar.rows[0].notes).toContain("挂账");

    await 清理工单(t);
  });
});

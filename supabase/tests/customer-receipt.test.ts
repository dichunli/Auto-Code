import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

/**
 * ============================================================
 * 数据库集成测试：客户收款单 RPC
 *   create_customer_receipt / void_customer_receipt / list_customer_receivables
 *   （2026-09-16 往来账销账闭环，迁移 migrations_20260916_b_customer_receipts.sql）
 *
 * 运行前提：
 *   1. 本地 Supabase 已启动且所有迁移已应用（含 20260916_b）
 *   2. 环境变量 TEST_DATABASE_URL（默认 postgresql://postgres:postgres@localhost:54322/postgres）
 *
 * 运行：npx vitest run supabase/tests/customer-receipt.test.ts
 *
 * 认证模拟：函数内 auth.uid() 读 request.jwt.claims 的 sub；
 * 测试在事务内用 set_config(..., true) 注入，COMMIT 后自动失效。
 * ============================================================
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:54322/postgres";

/* 固定测试用户 id（造数专用） */
const TEST_USER_ID = "dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb";
/* 无角色的路人用户（测门禁） */
const NOBODY_USER_ID = "dddddddd-eeee-4fff-8aaa-cccccccccccc";
const PFX = "TESTCR-";

let client: Client;
let customerId: string;
let otherCustomerId: string;
let accountId: string;

interface RPC结果 {
  success: boolean;
  error?: string;
  receipt_id?: string;
  receipt_no?: string;
}

interface 应收行 {
  transaction_id: string;
  order_no: string | null;
  amount: number;
  paid_amount: number;
  remaining: number;
}

interface 查询结果 {
  success: boolean;
  error?: string;
  receivables?: 应收行[];
  total_remaining?: number;
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

async function 建收款单(
  amount: number,
  allocations: Array<{ receivable_id: string; amount: number }>,
  opts: { method?: string; note?: string; customerId?: string; accountId?: string } = {}
): Promise<RPC结果> {
  const res = await query(
    `SELECT create_customer_receipt($1::UUID, $2::NUMERIC, $3::UUID, $4::TEXT, NULL, $5::TEXT, $6::JSONB) as result`,
    [opts.customerId || customerId, amount, opts.accountId || accountId, opts.method || null, opts.note || null, JSON.stringify(allocations)]
  );
  return res.rows[0].result as RPC结果;
}

async function 作废收款单(receiptId: string): Promise<RPC结果> {
  const res = await query(`SELECT void_customer_receipt($1::UUID) as result`, [receiptId]);
  return res.rows[0].result as RPC结果;
}

async function 查应收(cid: string = customerId): Promise<查询结果> {
  const res = await query(`SELECT list_customer_receivables($1::UUID) as result`, [cid]);
  return res.rows[0].result as 查询结果;
}

/* 直接插一笔应收（pending），返回应收 id */
async function 造应收(amount: number, 备注: string, cid: string = customerId): Promise<string> {
  const res = await query(
    `INSERT INTO accounts_receivable (customer_id, amount, paid_amount, status, notes)
     VALUES ($1, $2, 0, 'pending', $3) RETURNING id`,
    [cid, amount, 备注]
  );
  return res.rows[0].id as string;
}

async function 应收状态(rid: string): Promise<{ paid_amount: number; status: string }> {
  const res = await query(`SELECT paid_amount, status FROM accounts_receivable WHERE id = $1`, [rid]);
  return { paid_amount: Number(res.rows[0].paid_amount), status: res.rows[0].status };
}

async function 账户余额(): Promise<number> {
  const res = await query(`SELECT balance FROM finance_accounts WHERE id = $1`, [accountId]);
  return Number(res.rows[0].balance);
}

async function cleanupAll() {
  /* 顺序：收款单（级联删核销明细）→ 财务流水 → 应收 → 客户 → 账户 */
  await query(`DELETE FROM customer_receipts WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM finance_transactions WHERE description LIKE '客户收款单%' AND account_id IN (SELECT id FROM finance_accounts WHERE name LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM accounts_receivable WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM customers WHERE name LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM finance_accounts WHERE name LIKE $1`, [`${PFX}%`]);
}

describe("客户收款单 RPC - 数据库集成测试", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    await cleanupAll();

    /* 造测试用户：auth.users → profiles → profile_roles(admin) */
    await query(
      `INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
       VALUES ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '', now(), now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `${PFX.toLowerCase()}admin@example.com`]
    );
    await query(
      `INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
       VALUES ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '', now(), now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [NOBODY_USER_ID, `${PFX.toLowerCase()}nobody@example.com`]
    );
    await query(`INSERT INTO profiles (id, full_name) VALUES ($1, '收款测试员') ON CONFLICT (id) DO NOTHING`, [TEST_USER_ID]);
    await query(`INSERT INTO profiles (id, full_name) VALUES ($1, '路人乙') ON CONFLICT (id) DO NOTHING`, [NOBODY_USER_ID]);
    await query(`INSERT INTO roles (name, label) VALUES ('admin', '管理员') ON CONFLICT (name) DO NOTHING`);
    const roleRes = await query(`SELECT id FROM roles WHERE name = 'admin'`);
    await query(
      `INSERT INTO profile_roles (profile_id, role_id) VALUES ($1, $2) ON CONFLICT (profile_id, role_id) DO NOTHING`,
      [TEST_USER_ID, roleRes.rows[0].id]
    );

    /* 造测试客户、资金账户、收支分类 */
    const c1 = await query(`INSERT INTO customers (name) VALUES ($1) RETURNING id`, [`${PFX}客户甲`]);
    customerId = c1.rows[0].id;
    const c2 = await query(`INSERT INTO customers (name) VALUES ($1) RETURNING id`, [`${PFX}客户乙`]);
    otherCustomerId = c2.rows[0].id;
    const acc = await query(
      `INSERT INTO finance_accounts (name, account_type, balance, is_active) VALUES ($1, 'cash', 0, true) RETURNING id`,
      [`${PFX}现金`]
    );
    accountId = acc.rows[0].id;
    await query(
      `INSERT INTO finance_categories (name, type, sort_order) VALUES ('维修收入', 'income', 1) ON CONFLICT DO NOTHING`
    );
  });

  afterAll(async () => {
    await cleanupAll();
    await query(`DELETE FROM profile_roles WHERE profile_id IN ($1, $2)`, [TEST_USER_ID, NOBODY_USER_ID]);
    await query(`DELETE FROM profiles WHERE id IN ($1, $2)`, [TEST_USER_ID, NOBODY_USER_ID]);
    await query(`DELETE FROM auth.users WHERE id IN ($1, $2)`, [TEST_USER_ID, NOBODY_USER_ID]);
    await client.end();
  });

  /* 1. 未登录拦截 */
  it("未登录调用 → 返回未登录错误", async () => {
    const res = await query(
      `SELECT create_customer_receipt($1::UUID, 100, $2::UUID, NULL, NULL, NULL, '[]'::JSONB) as result`,
      [customerId, accountId]
    );
    const r = res.rows[0].result as RPC结果;
    expect(r.success).toBe(false);
    expect(r.error).toContain("未登录");
  });

  /* 2. 无角色用户门禁 */
  it("无角色用户 → 无权限", async () => {
    const rid = await 造应收(100, `${PFX}门禁用例`);
    const r = await withAuth(NOBODY_USER_ID, () => 建收款单(100, [{ receivable_id: rid, amount: 100 }]));
    expect(r.success).toBe(false);
    expect(r.error).toContain("无权限");
    await query(`DELETE FROM accounts_receivable WHERE id = $1`, [rid]);
  });

  /* 3. 创建收款单 + 核销销账 全链路 */
  it("建单+核销：单号/明细/应收销账/财务流水/账户余额全部正确", async () => {
    const rid = await 造应收(500, `${PFX}挂账500`);
    const 余额前 = await 账户余额();

    const r = await withAuth(TEST_USER_ID, () =>
      建收款单(500, [{ receivable_id: rid, amount: 500 }], { method: "微信", note: `${PFX}第一笔` })
    );
    expect(r.success).toBe(true);
    expect(r.receipt_no).toMatch(/^SK-\d{8}-\d{3}$/);

    /* 核销明细 */
    const alloc = await query(`SELECT amount FROM customer_receipt_allocations WHERE receipt_id = $1`, [r.receipt_id]);
    expect(alloc.rows.length).toBe(1);
    expect(Number(alloc.rows[0].amount)).toBe(500);

    /* 应收已销：paid_amount=500, status=paid */
    const ar = await 应收状态(rid);
    expect(ar.paid_amount).toBe(500);
    expect(ar.status).toBe("paid");

    /* 财务流水（income/维修收入/指回收款单/经办人） */
    const tx = await query(
      `SELECT ft.amount, ft.type, ft.related_type, ft.related_id, ft.created_by, fc.name AS category_name
       FROM finance_transactions ft LEFT JOIN finance_categories fc ON fc.id = ft.category_id
       WHERE ft.related_type = 'other' AND ft.related_id = $1`,
      [r.receipt_id]
    );
    expect(tx.rows.length).toBe(1);
    expect(Number(tx.rows[0].amount)).toBe(500);
    expect(tx.rows[0].type).toBe("income");
    expect(tx.rows[0].category_name).toBe("维修收入");
    expect(tx.rows[0].created_by).toBe(TEST_USER_ID);

    /* 账户余额增加（触发器） */
    expect(await 账户余额()).toBe(余额前 + 500);

    /* 待收清单里不再出现（已 paid 不在 pending/partial 之列） */
    const 查 = await withAuth(TEST_USER_ID, () => 查应收());
    expect(查.success).toBe(true);
    expect((查.receivables || []).find((x) => x.transaction_id === rid)).toBeUndefined();

    await query(`DELETE FROM customer_receipts WHERE id = $1`, [r.receipt_id]);
    await query(`DELETE FROM finance_transactions WHERE related_type = 'other' AND related_id = $1`, [r.receipt_id]);
    await query(`DELETE FROM accounts_receivable WHERE id = $1`, [rid]);
  });

  /* 4. 超销拦截（单笔超过未收余额 → 报错且整体回滚） */
  it("核销超过该笔应收未收余额 → 报错且整体回滚", async () => {
    const rid = await 造应收(100, `${PFX}应收100`);
    const 余额前 = await 账户余额();

    const r = await withAuth(TEST_USER_ID, () =>
      建收款单(150, [{ receivable_id: rid, amount: 150 }])
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain("未收余额");

    /* 回滚验证：收款单不存在、应收没动、余额没变 */
    const pay = await query(`SELECT COUNT(*)::int AS n FROM customer_receipts WHERE customer_id = $1`, [customerId]);
    expect(pay.rows[0].n).toBe(0);
    const ar = await 应收状态(rid);
    expect(ar.paid_amount).toBe(0);
    expect(ar.status).toBe("pending");
    expect(await 账户余额()).toBe(余额前);

    await query(`DELETE FROM accounts_receivable WHERE id = $1`, [rid]);
  });

  /* 5. 口径校验：核销合计 ≠ 收款金额 → 报错 */
  it("核销合计与收款金额不一致 → 报错", async () => {
    const rid = await 造应收(300, `${PFX}应收300`);

    /* 收 300 只勾 200 → 拒绝（多收的钱没去处） */
    const r = await withAuth(TEST_USER_ID, () =>
      建收款单(300, [{ receivable_id: rid, amount: 200 }])
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain("不一致");

    const ar = await 应收状态(rid);
    expect(ar.paid_amount).toBe(0);

    await query(`DELETE FROM accounts_receivable WHERE id = $1`, [rid]);
  });

  /* 6. 跨客户核销被拒 */
  it("核销别家客户的应收 → 报错", async () => {
    const rid = await 造应收(200, `${PFX}别人的应收`, otherCustomerId);

    const r = await withAuth(TEST_USER_ID, () =>
      建收款单(200, [{ receivable_id: rid, amount: 200 }])
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain("不属于该客户");

    await query(`DELETE FROM accounts_receivable WHERE id = $1`, [rid]);
  });

  /* 7. 部分收款 → 收清：状态 pending → partial → paid，再收被拒 */
  it("部分收款两次后收清，状态正确推进；付清后再收被拒", async () => {
    const rid = await 造应收(500, `${PFX}分期500`);

    const r1 = await withAuth(TEST_USER_ID, () =>
      建收款单(200, [{ receivable_id: rid, amount: 200 }], { note: `${PFX}分期1` })
    );
    expect(r1.success).toBe(true);
    let ar = await 应收状态(rid);
    expect(ar.paid_amount).toBe(200);
    expect(ar.status).toBe("partial");

    /* 清单里剩余 300 */
    const 查 = await withAuth(TEST_USER_ID, () => 查应收());
    const 行 = (查.receivables || []).find((x) => x.transaction_id === rid);
    expect(行).toBeTruthy();
    expect(Number(行!.remaining)).toBe(300);

    const r2 = await withAuth(TEST_USER_ID, () =>
      建收款单(300, [{ receivable_id: rid, amount: 300 }], { note: `${PFX}分期2` })
    );
    expect(r2.success).toBe(true);
    ar = await 应收状态(rid);
    expect(ar.paid_amount).toBe(500);
    expect(ar.status).toBe("paid");

    /* 已 paid 再核销 → 拒绝 */
    const r3 = await withAuth(TEST_USER_ID, () =>
      建收款单(1, [{ receivable_id: rid, amount: 1 }])
    );
    expect(r3.success).toBe(false);

    await query(`DELETE FROM customer_receipts WHERE id IN ($1, $2)`, [r1.receipt_id, r2.receipt_id]);
    await query(
      `DELETE FROM finance_transactions WHERE related_type = 'other' AND related_id IN ($1, $2)`,
      [r1.receipt_id, r2.receipt_id]
    );
    await query(`DELETE FROM accounts_receivable WHERE id = $1`, [rid]);
  });

  /* 8. 作废收款单：应收回滚、明细/流水删除、余额扣回、留痕、重复作废报错 */
  it("作废：应收恢复未收、流水删除余额扣回；重复作废报错", async () => {
    const rid = await 造应收(400, `${PFX}待作废400`);
    const 余额前 = await 账户余额();

    const r = await withAuth(TEST_USER_ID, () =>
      建收款单(400, [{ receivable_id: rid, amount: 400 }], { note: `${PFX}待作废` })
    );
    expect(r.success).toBe(true);
    expect(await 账户余额()).toBe(余额前 + 400);

    const v = await withAuth(TEST_USER_ID, () => 作废收款单(r.receipt_id!));
    expect(v.success).toBe(true);

    /* 应收回滚 */
    const ar = await 应收状态(rid);
    expect(ar.paid_amount).toBe(0);
    expect(ar.status).toBe("pending");
    /* 核销明细已删 */
    const alloc = await query(`SELECT COUNT(*)::int AS n FROM customer_receipt_allocations WHERE receipt_id = $1`, [r.receipt_id]);
    expect(alloc.rows[0].n).toBe(0);
    /* 流水已删、余额扣回 */
    const tx = await query(
      `SELECT COUNT(*)::int AS n FROM finance_transactions WHERE related_type = 'other' AND related_id = $1`,
      [r.receipt_id]
    );
    expect(tx.rows[0].n).toBe(0);
    expect(await 账户余额()).toBe(余额前);
    /* 收款单留痕为 voided */
    const rec = await query(`SELECT status, voided_by FROM customer_receipts WHERE id = $1`, [r.receipt_id]);
    expect(rec.rows[0].status).toBe("voided");
    expect(rec.rows[0].voided_by).toBe(TEST_USER_ID);

    /* 重复作废 */
    const v2 = await withAuth(TEST_USER_ID, () => 作废收款单(r.receipt_id!));
    expect(v2.success).toBe(false);
    expect(v2.error).toContain("已作废");

    await query(`DELETE FROM customer_receipts WHERE id = $1`, [r.receipt_id]);
    await query(`DELETE FROM accounts_receivable WHERE id = $1`, [rid]);
  });

  /* 9. 必填校验：不选账户 / 金额不大于 0 */
  it("缺账户或金额非法 → 报错", async () => {
    const rid = await 造应收(100, `${PFX}校验用例`);

    const 无账户 = await withAuth(TEST_USER_ID, () =>
      建收款单(100, [{ receivable_id: rid, amount: 100 }], { accountId: "00000000-0000-0000-0000-000000000000" })
    );
    expect(无账户.success).toBe(false);
    expect(无账户.error).toContain("收款账户");

    const 零金额 = await withAuth(TEST_USER_ID, () => 建收款单(0, []));
    expect(零金额.success).toBe(false);
    expect(零金额.error).toContain("大于 0");

    await query(`DELETE FROM accounts_receivable WHERE id = $1`, [rid]);
  });
});

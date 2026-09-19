import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

/**
 * ============================================================
 * 数据库集成测试：外包应付付款 RPC
 *   create_ap_payment / void_ap_payment
 *   （2026-09-16 往来账销账闭环 第二部分，迁移 migrations_20260916_c_ap_payment_records.sql）
 *
 * 运行前提：
 *   1. 本地 Supabase 已启动且所有迁移已应用（含 20260916_c）
 *   2. 环境变量 TEST_DATABASE_URL（默认 postgresql://postgres:postgres@localhost:54322/postgres）
 *
 * 运行：npx vitest run supabase/tests/ap-payment.test.ts
 *
 * 认证模拟：函数内 auth.uid() 读 request.jwt.claims 的 sub；
 * 测试在事务内用 set_config(..., true) 注入，COMMIT 后自动失效。
 * ============================================================
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:54322/postgres";

/* 固定测试用户 id（造数专用） */
const TEST_USER_ID = "eeeeeeee-ffff-4aaa-8bbb-cccccccccccc";
/* 无角色的路人用户（测门禁） */
const NOBODY_USER_ID = "eeeeeeee-ffff-4aaa-8bbb-dddddddddddd";
const PFX = "TESTAP-";

let client: Client;
let accountId: string;

interface RPC结果 {
  success: boolean;
  error?: string;
  record_id?: string;
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

async function 登记付款(
  payableId: string,
  amount: number,
  opts: { method?: string; note?: string; accountId?: string } = {}
): Promise<RPC结果> {
  const res = await query(
    `SELECT create_ap_payment($1::UUID, $2::NUMERIC, $3::UUID, $4::TEXT, NULL, $5::TEXT) as result`,
    [payableId, amount, opts.accountId || accountId, opts.method || null, opts.note || null]
  );
  return res.rows[0].result as RPC结果;
}

async function 作废付款(recordId: string): Promise<RPC结果> {
  const res = await query(`SELECT void_ap_payment($1::UUID) as result`, [recordId]);
  return res.rows[0].result as RPC结果;
}

/* 直接插一笔外包应付（pending），返回应付 id */
async function 造应付(amount: number, 备注: string): Promise<string> {
  const res = await query(
    `INSERT INTO accounts_payable (supplier_id, amount, paid_amount, status, notes)
     VALUES (NULL, $1, 0, 'pending', $2) RETURNING id`,
    [amount, 备注]
  );
  return res.rows[0].id as string;
}

async function 应付状态(pid: string): Promise<{ paid_amount: number; status: string }> {
  const res = await query(`SELECT paid_amount, status FROM accounts_payable WHERE id = $1`, [pid]);
  return { paid_amount: Number(res.rows[0].paid_amount), status: res.rows[0].status };
}

async function 账户余额(): Promise<number> {
  const res = await query(`SELECT balance FROM finance_accounts WHERE id = $1`, [accountId]);
  return Number(res.rows[0].balance);
}

async function cleanupAll() {
  /* 顺序：付款流水 → 财务流水 → 应付 → 账户 */
  await query(`DELETE FROM ap_payment_records WHERE payable_id IN (SELECT id FROM accounts_payable WHERE notes LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM finance_transactions WHERE description LIKE '外包付款%' AND account_id IN (SELECT id FROM finance_accounts WHERE name LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM accounts_payable WHERE notes LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM finance_accounts WHERE name LIKE $1`, [`${PFX}%`]);
}

describe("外包应付付款 RPC - 数据库集成测试", () => {
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
    await query(`INSERT INTO profiles (id, full_name) VALUES ($1, '外包付款测试员') ON CONFLICT (id) DO NOTHING`, [TEST_USER_ID]);
    await query(`INSERT INTO profiles (id, full_name) VALUES ($1, '路人丙') ON CONFLICT (id) DO NOTHING`, [NOBODY_USER_ID]);
    await query(`INSERT INTO roles (name, label) VALUES ('admin', '管理员') ON CONFLICT (name) DO NOTHING`);
    const roleRes = await query(`SELECT id FROM roles WHERE name = 'admin'`);
    await query(
      `INSERT INTO profile_roles (profile_id, role_id) VALUES ($1, $2) ON CONFLICT (profile_id, role_id) DO NOTHING`,
      [TEST_USER_ID, roleRes.rows[0].id]
    );

    /* 造资金账户、收支分类 */
    const acc = await query(
      `INSERT INTO finance_accounts (name, account_type, balance, is_active) VALUES ($1, 'cash', 10000, true) RETURNING id`,
      [`${PFX}现金`]
    );
    accountId = acc.rows[0].id;
    /* name 无唯一约束，用 WHERE NOT EXISTS 防重复科目 */
    await query(
      `INSERT INTO finance_categories (name, type, sort_order)
       SELECT '其他支出', 'expense', 5
       WHERE NOT EXISTS (SELECT 1 FROM finance_categories WHERE type = 'expense' AND name = '其他支出')`
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
    const pid = await 造应付(100, `${PFX}未登录用例`);
    const res = await query(
      `SELECT create_ap_payment($1::UUID, 100, $2::UUID, NULL, NULL, NULL) as result`,
      [pid, accountId]
    );
    const r = res.rows[0].result as RPC结果;
    expect(r.success).toBe(false);
    expect(r.error).toContain("未登录");
    await query(`DELETE FROM accounts_payable WHERE id = $1`, [pid]);
  });

  /* 2. 无角色用户门禁 */
  it("无角色用户 → 无权限", async () => {
    const pid = await 造应付(100, `${PFX}门禁用例`);
    const r = await withAuth(NOBODY_USER_ID, () => 登记付款(pid, 100));
    expect(r.success).toBe(false);
    expect(r.error).toContain("无权限");
    await query(`DELETE FROM accounts_payable WHERE id = $1`, [pid]);
  });

  /* 3. 登记付款全链路：流水/销账/财务流水/账户余额 */
  it("付款全链路：流水记录、应付销账、expense 流水、余额扣减全部正确", async () => {
    const pid = await 造应付(800, `${PFX}外包服务单 WB001`);
    const 余额前 = await 账户余额();

    const r = await withAuth(TEST_USER_ID, () =>
      登记付款(pid, 800, { method: "银行转账", note: `${PFX}全款` })
    );
    expect(r.success).toBe(true);
    expect(r.record_id).toBeTruthy();

    /* 付款流水 */
    const rec = await query(
      `SELECT amount, payment_method, status, created_by FROM ap_payment_records WHERE id = $1`,
      [r.record_id]
    );
    expect(Number(rec.rows[0].amount)).toBe(800);
    expect(rec.rows[0].payment_method).toBe("银行转账");
    expect(rec.rows[0].status).toBe("confirmed");
    expect(rec.rows[0].created_by).toBe(TEST_USER_ID);

    /* 应付已销：paid_amount=800, status=paid */
    const ap = await 应付状态(pid);
    expect(ap.paid_amount).toBe(800);
    expect(ap.status).toBe("paid");

    /* 财务流水（expense/其他支出/指回付款记录） */
    const tx = await query(
      `SELECT ft.amount, ft.type, fc.name AS category_name
       FROM finance_transactions ft LEFT JOIN finance_categories fc ON fc.id = ft.category_id
       WHERE ft.related_type = 'other' AND ft.related_id = $1`,
      [r.record_id]
    );
    expect(tx.rows.length).toBe(1);
    expect(Number(tx.rows[0].amount)).toBe(800);
    expect(tx.rows[0].type).toBe("expense");
    expect(tx.rows[0].category_name).toBe("其他支出");

    /* 账户余额扣减（触发器） */
    expect(await 账户余额()).toBe(余额前 - 800);

    await query(`DELETE FROM ap_payment_records WHERE id = $1`, [r.record_id]);
    await query(`DELETE FROM finance_transactions WHERE related_type = 'other' AND related_id = $1`, [r.record_id]);
    await query(`DELETE FROM accounts_payable WHERE id = $1`, [pid]);
  });

  /* 4. 超付拦截（> 未付余额 → 报错且整体回滚） */
  it("付款超过未付余额 → 报错且整体回滚", async () => {
    const pid = await 造应付(100, `${PFX}应付100`);
    const 余额前 = await 账户余额();

    const r = await withAuth(TEST_USER_ID, () => 登记付款(pid, 150));
    expect(r.success).toBe(false);
    expect(r.error).toContain("未付余额");

    /* 回滚验证：无流水、应付没动、余额没变 */
    const rec = await query(`SELECT COUNT(*)::int AS n FROM ap_payment_records WHERE payable_id = $1`, [pid]);
    expect(rec.rows[0].n).toBe(0);
    const ap = await 应付状态(pid);
    expect(ap.paid_amount).toBe(0);
    expect(await 账户余额()).toBe(余额前);

    await query(`DELETE FROM accounts_payable WHERE id = $1`, [pid]);
  });

  /* 5. 部分付款：状态 pending → partial → paid；付清后再付被拒 */
  it("部分付款两次后付清，状态正确推进；付清后再付被拒", async () => {
    const pid = await 造应付(500, `${PFX}分期500`);

    const r1 = await withAuth(TEST_USER_ID, () => 登记付款(pid, 200, { note: `${PFX}分期1` }));
    expect(r1.success).toBe(true);
    let ap = await 应付状态(pid);
    expect(ap.paid_amount).toBe(200);
    expect(ap.status).toBe("partial");

    const r2 = await withAuth(TEST_USER_ID, () => 登记付款(pid, 300, { note: `${PFX}分期2` }));
    expect(r2.success).toBe(true);
    ap = await 应付状态(pid);
    expect(ap.paid_amount).toBe(500);
    expect(ap.status).toBe("paid");

    /* 已 paid 再付 → 拒绝 */
    const r3 = await withAuth(TEST_USER_ID, () => 登记付款(pid, 1));
    expect(r3.success).toBe(false);
    expect(r3.error).toContain("已结清");

    await query(`DELETE FROM ap_payment_records WHERE id IN ($1, $2)`, [r1.record_id, r2.record_id]);
    await query(
      `DELETE FROM finance_transactions WHERE related_type = 'other' AND related_id IN ($1, $2)`,
      [r1.record_id, r2.record_id]
    );
    await query(`DELETE FROM accounts_payable WHERE id = $1`, [pid]);
  });

  /* 6. 作废：应收回滚、流水删除余额退回、留痕、重复作废报错 */
  it("作废：应付恢复未付、流水删除余额退回；重复作废报错", async () => {
    const pid = await 造应付(400, `${PFX}待作废400`);
    const 余额前 = await 账户余额();

    const r = await withAuth(TEST_USER_ID, () => 登记付款(pid, 400, { note: `${PFX}待作废` }));
    expect(r.success).toBe(true);
    expect(await 账户余额()).toBe(余额前 - 400);

    const v = await withAuth(TEST_USER_ID, () => 作废付款(r.record_id!));
    expect(v.success).toBe(true);

    /* 应付回滚 */
    const ap = await 应付状态(pid);
    expect(ap.paid_amount).toBe(0);
    expect(ap.status).toBe("pending");
    /* 财务流水已删、余额退回 */
    const tx = await query(
      `SELECT COUNT(*)::int AS n FROM finance_transactions WHERE related_type = 'other' AND related_id = $1`,
      [r.record_id]
    );
    expect(tx.rows[0].n).toBe(0);
    expect(await 账户余额()).toBe(余额前);
    /* 付款记录留痕为 voided */
    const rec = await query(`SELECT status, voided_by FROM ap_payment_records WHERE id = $1`, [r.record_id]);
    expect(rec.rows[0].status).toBe("voided");
    expect(rec.rows[0].voided_by).toBe(TEST_USER_ID);

    /* 重复作废 */
    const v2 = await withAuth(TEST_USER_ID, () => 作废付款(r.record_id!));
    expect(v2.success).toBe(false);
    expect(v2.error).toContain("已作废");

    await query(`DELETE FROM ap_payment_records WHERE id = $1`, [r.record_id]);
    await query(`DELETE FROM accounts_payable WHERE id = $1`, [pid]);
  });

  /* 7. 必填校验：不选账户 */
  it("缺账户 → 报错", async () => {
    const pid = await 造应付(100, `${PFX}校验用例`);
    const r = await withAuth(TEST_USER_ID, () =>
      登记付款(pid, 100, { accountId: "00000000-0000-0000-0000-000000000000" })
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain("付款账户");
    await query(`DELETE FROM accounts_payable WHERE id = $1`, [pid]);
  });
});

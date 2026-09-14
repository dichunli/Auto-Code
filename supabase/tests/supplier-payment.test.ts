import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

/**
 * ============================================================
 * 数据库集成测试：供应商付款单 RPC
 *   create_supplier_payment / void_supplier_payment / list_supplier_payables
 *   （2026-09-14 供应商款项改造批次1，迁移 migrations_20260914_a_supplier_payments.sql）
 *
 * 运行前提：
 *   1. 本地 Supabase 已启动且所有迁移已应用（含 20260914_a）
 *   2. 环境变量 TEST_DATABASE_URL（默认 postgresql://postgres:postgres@localhost:54322/postgres）
 *
 * 运行：npx vitest run supabase/tests/supplier-payment.test.ts
 *
 * 认证模拟：函数内 auth.uid() 读 request.jwt.claims 的 sub；
 * 测试在事务内用 set_config(..., true) 注入，COMMIT 后自动失效。
 * ============================================================
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:54322/postgres";

/* 固定测试用户 id（造数专用） */
const TEST_USER_ID = "cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa";
/* 无角色的路人用户（测门禁） */
const NOBODY_USER_ID = "cccccccc-dddd-4eee-8fff-bbbbbbbbbbbb";
const PFX = "TESTSP-";

let client: Client;
let supplierId: string;

interface RPC结果 {
  success: boolean;
  error?: string;
  payment_id?: string;
  payment_no?: string;
}

interface 应付行 {
  transaction_id: string;
  amount: number;
  allocated: number;
  remaining: number;
}

interface 查询结果 {
  success: boolean;
  error?: string;
  payables?: 应付行[];
  pool?: number;
  allocated?: number;
  available?: number;
  balance?: number;
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

async function 建付款单(
  amount: number,
  allocations: Array<{ transaction_id: string; amount: number }>,
  opts: { method?: string; note?: string } = {}
): Promise<RPC结果> {
  const res = await query(
    `SELECT create_supplier_payment($1::UUID, $2::NUMERIC, $3::TEXT, NULL, $4::TEXT, $5::JSONB) as result`,
    [supplierId, amount, opts.method || null, opts.note || null, JSON.stringify(allocations)]
  );
  return res.rows[0].result as RPC结果;
}

async function 作废付款单(paymentId: string): Promise<RPC结果> {
  const res = await query(`SELECT void_supplier_payment($1::UUID) as result`, [paymentId]);
  return res.rows[0].result as RPC结果;
}

async function 查应付(): Promise<查询结果> {
  const res = await query(`SELECT list_supplier_payables($1::UUID) as result`, [supplierId]);
  return res.rows[0].result as 查询结果;
}

/* 直接插一笔应付（debit）流水，返回流水 id */
async function 造应付(amount: number, 备注: string): Promise<string> {
  const res = await query(
    `INSERT INTO supplier_transactions (supplier_id, transaction_type, amount, description)
     VALUES ($1, 'debit', $2, $3) RETURNING id`,
    [supplierId, amount, 备注]
  );
  return res.rows[0].id as string;
}

async function 流水数(类型: string): Promise<number> {
  const res = await query(
    `SELECT COUNT(*)::int AS n FROM supplier_transactions WHERE supplier_id = $1 AND transaction_type = $2`,
    [supplierId, 类型]
  );
  return res.rows[0].n as number;
}

async function cleanupAll() {
  /* 顺序：付款单（级联删核销明细）→ 供应商（级联删往来流水） */
  await query(`DELETE FROM supplier_payments WHERE note LIKE $1 OR id IN (
    SELECT payment_id FROM supplier_payment_allocations WHERE transaction_id IN (
      SELECT id FROM supplier_transactions WHERE description LIKE $1))`, [`${PFX}%`]);
  await query(`DELETE FROM supplier_payments WHERE supplier_id IN (SELECT id FROM suppliers WHERE name LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM suppliers WHERE name LIKE $1`, [`${PFX}%`]);
}

describe("供应商付款单 RPC - 数据库集成测试", () => {
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
    await query(`INSERT INTO profiles (id, full_name) VALUES ($1, '付款测试员') ON CONFLICT (id) DO NOTHING`, [TEST_USER_ID]);
    await query(`INSERT INTO profiles (id, full_name) VALUES ($1, '路人甲') ON CONFLICT (id) DO NOTHING`, [NOBODY_USER_ID]);
    await query(`INSERT INTO roles (name, label) VALUES ('admin', '管理员') ON CONFLICT (name) DO NOTHING`);
    const roleRes = await query(`SELECT id FROM roles WHERE name = 'admin'`);
    await query(
      `INSERT INTO profile_roles (profile_id, role_id) VALUES ($1, $2) ON CONFLICT (profile_id, role_id) DO NOTHING`,
      [TEST_USER_ID, roleRes.rows[0].id]
    );

    /* 造测试供应商 */
    const sup = await query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`${PFX}供应商`]);
    supplierId = sup.rows[0].id;
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
      `SELECT create_supplier_payment($1::UUID, 100, NULL, NULL, NULL, '[]'::JSONB) as result`,
      [supplierId]
    );
    const r = res.rows[0].result as RPC结果;
    expect(r.success).toBe(false);
    expect(r.error).toContain("未登录");
  });

  /* 2. 无角色用户门禁 */
  it("无角色用户 → 无权限", async () => {
    const r = await withAuth(NOBODY_USER_ID, () => 建付款单(100, []));
    expect(r.success).toBe(false);
    expect(r.error).toContain("无权限");
  });

  /* 3. 创建付款单 + 核销 全链路 */
  it("建单+核销：单号/明细/流水/核销状态全部正确", async () => {
    const tid = await 造应付(500, `${PFX}入库应付500`);

    const r = await withAuth(TEST_USER_ID, () =>
      建付款单(300, [{ transaction_id: tid, amount: 300 }], { method: "微信", note: `${PFX}第一笔` })
    );
    expect(r.success).toBe(true);
    expect(r.payment_no).toMatch(/^FK-\d{8}-\d{3}$/);

    /* 核销明细 */
    const alloc = await query(`SELECT amount FROM supplier_payment_allocations WHERE payment_id = $1`, [r.payment_id]);
    expect(alloc.rows.length).toBe(1);
    expect(Number(alloc.rows[0].amount)).toBe(300);

    /* payment 流水（带支付方式和回指） */
    const tx = await query(
      `SELECT amount, payment_method, reference_type, reference_id FROM supplier_transactions
       WHERE reference_type = 'supplier_payment' AND reference_id = $1`,
      [r.payment_id]
    );
    expect(tx.rows.length).toBe(1);
    expect(Number(tx.rows[0].amount)).toBe(300);
    expect(tx.rows[0].payment_method).toBe("微信");

    /* 核销状态：500 应付勾了 300 → remaining 200 */
    const 查 = await withAuth(TEST_USER_ID, 查应付);
    expect(查.success).toBe(true);
    const 行 = (查.payables || []).find((p) => p.transaction_id === tid);
    expect(行).toBeTruthy();
    expect(Number(行!.allocated)).toBe(300);
    expect(Number(行!.remaining)).toBe(200);
    /* 余额口径：debit 500 − payment 300 = 200 */
    expect(Number(查.balance)).toBe(200);

    await query(`DELETE FROM supplier_payments WHERE id = $1`, [r.payment_id]);
    await query(`DELETE FROM supplier_transactions WHERE id = $1`, [tid]);
  });

  /* 4. 超勾拦截（单笔） */
  it("核销超过该笔应付未付余额 → 报错且整体回滚", async () => {
    const tid = await 造应付(100, `${PFX}入库应付100`);
    const 前流水数 = await 流水数("payment");

    const r = await withAuth(TEST_USER_ID, () =>
      建付款单(150, [{ transaction_id: tid, amount: 150 }])
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain("未付余额");

    /* 回滚验证：付款单不存在、payment 流水没多 */
    const pay = await query(`SELECT COUNT(*)::int AS n FROM supplier_payments WHERE supplier_id = $1`, [supplierId]);
    expect(pay.rows[0].n).toBe(0);
    expect(await 流水数("payment")).toBe(前流水数);

    await query(`DELETE FROM supplier_transactions WHERE id = $1`, [tid]);
  });

  /* 5. 全局核销额度校验 */
  it("核销合计超过 付款来源池+本单金额 → 报错", async () => {
    const tidA = await 造应付(100, `${PFX}应付A`);
    const tidB = await 造应付(100, `${PFX}应付B`);

    /* 第一笔：付 100 勾 A100 —— 正常 */
    const r1 = await withAuth(TEST_USER_ID, () =>
      建付款单(100, [{ transaction_id: tidA, amount: 100 }], { note: `${PFX}额度1` })
    );
    expect(r1.success).toBe(true);

    /* 第二笔：付 0 不行（>0 校验）；付 50 却勾 B100 → 池(100)−已核销(100)+50=50 < 100 → 报错 */
    const r2 = await withAuth(TEST_USER_ID, () =>
      建付款单(50, [{ transaction_id: tidB, amount: 100 }])
    );
    expect(r2.success).toBe(false);
    expect(r2.error).toContain("可核销额度");

    await query(`DELETE FROM supplier_payments WHERE id = $1`, [r1.payment_id]);
    await query(`DELETE FROM supplier_transactions WHERE id IN ($1, $2)`, [tidA, tidB]);
  });

  /* 6. 游离 payment 流水（手工记的）计入付款来源池 */
  it("手工 payment 流水计入来源池，可用来勾单", async () => {
    const tid = await 造应付(200, `${PFX}应付200`);
    /* 手工记一笔 payment（无 reference，模拟历史数据/代收） */
    await query(
      `INSERT INTO supplier_transactions (supplier_id, transaction_type, amount, description)
       VALUES ($1, 'payment', 200, $2)`,
      [supplierId, `${PFX}手工付款`]
    );

    const 查前 = await withAuth(TEST_USER_ID, 查应付);
    expect(Number(查前.pool)).toBe(200);
    expect(Number(查前.available)).toBe(200);

    /* 本单付 0 不允许，但付 1 元可以勾 200（池 200 − 已核销 0 + 本单 1 ≥ 200） */
    const r = await withAuth(TEST_USER_ID, () =>
      建付款单(1, [{ transaction_id: tid, amount: 200 }], { note: `${PFX}勾手工` })
    );
    expect(r.success).toBe(true);

    const 查后 = await withAuth(TEST_USER_ID, 查应付);
    const 行 = (查后.payables || []).find((p) => p.transaction_id === tid);
    expect(Number(行!.remaining)).toBe(0);

    await query(`DELETE FROM supplier_payments WHERE id = $1`, [r.payment_id]);
    await query(`DELETE FROM supplier_transactions WHERE supplier_id = $1`, [supplierId]);
  });

  /* 7. 作废付款单：明细/流水删除、应付恢复、重复作废报错 */
  it("作废：核销明细和流水删除，应付恢复未付；重复作废报错", async () => {
    const tid = await 造应付(400, `${PFX}应付400`);
    const r = await withAuth(TEST_USER_ID, () =>
      建付款单(400, [{ transaction_id: tid, amount: 400 }], { note: `${PFX}待作废` })
    );
    expect(r.success).toBe(true);

    const v = await withAuth(TEST_USER_ID, () => 作废付款单(r.payment_id!));
    expect(v.success).toBe(true);

    /* 核销明细已删 */
    const alloc = await query(`SELECT COUNT(*)::int AS n FROM supplier_payment_allocations WHERE payment_id = $1`, [r.payment_id]);
    expect(alloc.rows[0].n).toBe(0);
    /* 流水已删 */
    const tx = await query(
      `SELECT COUNT(*)::int AS n FROM supplier_transactions WHERE reference_type = 'supplier_payment' AND reference_id = $1`,
      [r.payment_id]
    );
    expect(tx.rows[0].n).toBe(0);
    /* 付款单留痕为 voided */
    const pay = await query(`SELECT status, voided_by FROM supplier_payments WHERE id = $1`, [r.payment_id]);
    expect(pay.rows[0].status).toBe("voided");
    expect(pay.rows[0].voided_by).toBe(TEST_USER_ID);
    /* 应付恢复 */
    const 查 = await withAuth(TEST_USER_ID, 查应付);
    const 行 = (查.payables || []).find((p) => p.transaction_id === tid);
    expect(Number(行!.remaining)).toBe(400);

    /* 重复作废 */
    const v2 = await withAuth(TEST_USER_ID, () => 作废付款单(r.payment_id!));
    expect(v2.success).toBe(false);
    expect(v2.error).toContain("已作废");

    await query(`DELETE FROM supplier_payments WHERE id = $1`, [r.payment_id]);
    await query(`DELETE FROM supplier_transactions WHERE id = $1`, [tid]);
  });

  /* 8. 同一笔应付分两次勾（部分付款） */
  it("部分付款：同一应付两次勾稽后付清", async () => {
    const tid = await 造应付(500, `${PFX}应付500`);

    const r1 = await withAuth(TEST_USER_ID, () =>
      建付款单(200, [{ transaction_id: tid, amount: 200 }], { note: `${PFX}分期1` })
    );
    const r2 = await withAuth(TEST_USER_ID, () =>
      建付款单(300, [{ transaction_id: tid, amount: 300 }], { note: `${PFX}分期2` })
    );
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);

    const 查 = await withAuth(TEST_USER_ID, 查应付);
    const 行 = (查.payables || []).find((p) => p.transaction_id === tid);
    expect(Number(行!.allocated)).toBe(500);
    expect(Number(行!.remaining)).toBe(0);

    /* 再勾就超 */
    const r3 = await withAuth(TEST_USER_ID, () =>
      建付款单(1, [{ transaction_id: tid, amount: 1 }])
    );
    expect(r3.success).toBe(false);

    await query(`DELETE FROM supplier_payments WHERE id IN ($1, $2)`, [r1.payment_id, r2.payment_id]);
    await query(`DELETE FROM supplier_transactions WHERE id = $1`, [tid]);
  });
});

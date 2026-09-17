import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

/**
 * ============================================================
 * 数据库集成测试：供应商收款单 RPC + 汇总优惠列
 *   create_supplier_receipt / void_supplier_receipt / supplier_balances
 *   （2026-09-16 供应商款项改造批次7，迁移 migrations_20260916_b_supplier_receipts.sql）
 *
 * 运行前提：
 *   1. 本地 Supabase 已启动且所有迁移已应用（含 20260916_b）
 *   2. 环境变量 TEST_DATABASE_URL（默认 postgresql://postgres:postgres@localhost:54322/postgres）
 *
 * 运行：npx vitest run supabase/tests/supplier-receipt.test.ts
 *
 * 认证模拟：函数内 auth.uid() 读 request.jwt.claims 的 sub；
 * 测试在事务内用 set_config(..., true) 注入，COMMIT 后自动失效。
 * ============================================================
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:54322/postgres";

/* 固定测试用户 id（造数专用） */
const TEST_USER_ID = "cccccccc-dddd-4eee-8fff-cccccccccccc";
/* 无角色的路人用户（测门禁） */
const NOBODY_USER_ID = "cccccccc-dddd-4eee-8fff-dddddddddddd";
const PFX = "TESTSR-";

let client: Client;
let supplierId: string;

interface RPC结果 {
  success: boolean;
  error?: string;
  receipt_id?: string;
  receipt_no?: string;
}

interface 汇总行 {
  supplier_id: string;
  balance: number;
  total_debit: number;
  total_payment: number;
  total_credit: number;
  total_discount: number;
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
  opts: { method?: string; note?: string } = {}
): Promise<RPC结果> {
  const res = await query(
    `SELECT create_supplier_receipt($1::UUID, $2::NUMERIC, $3::TEXT, NULL, $4::TEXT) as result`,
    [supplierId, amount, opts.method || null, opts.note || null]
  );
  return res.rows[0].result as RPC结果;
}

async function 作废收款单(receiptId: string): Promise<RPC结果> {
  const res = await query(`SELECT void_supplier_receipt($1::UUID) as result`, [receiptId]);
  return res.rows[0].result as RPC结果;
}

/* 直接插一笔流水（造余额用），返回流水 id */
async function 造流水(类型: string, amount: number, 备注: string): Promise<string> {
  const res = await query(
    `INSERT INTO supplier_transactions (supplier_id, transaction_type, amount, description)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [supplierId, 类型, amount, 备注]
  );
  return res.rows[0].id as string;
}

/* 按全局口径算余额：debit + refund − payment − credit − discount */
async function 算余额(): Promise<number> {
  const res = await query(
    `SELECT COALESCE(SUM(CASE transaction_type
        WHEN 'debit' THEN amount WHEN 'refund' THEN amount
        WHEN 'payment' THEN -amount WHEN 'credit' THEN -amount
        WHEN 'discount' THEN -amount ELSE 0 END), 0)::NUMERIC(12,2) AS bal
     FROM supplier_transactions WHERE supplier_id = $1`,
    [supplierId]
  );
  return Number(res.rows[0].bal);
}

async function 查汇总(): Promise<汇总行 | undefined> {
  const res = await query(`SELECT * FROM supplier_balances() WHERE supplier_id = $1`, [supplierId]);
  return res.rows[0] as 汇总行 | undefined;
}

async function cleanupAll() {
  /* 顺序：收款单 → 供应商（级联删往来流水靠手工，直接按供应商删流水） */
  await query(`DELETE FROM supplier_receipts WHERE supplier_id IN (SELECT id FROM suppliers WHERE name LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM supplier_transactions WHERE supplier_id IN (SELECT id FROM suppliers WHERE name LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM suppliers WHERE name LIKE $1`, [`${PFX}%`]);
}

describe("供应商收款单 RPC - 数据库集成测试", () => {
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
      `SELECT create_supplier_receipt($1::UUID, 100, NULL, NULL, NULL) as result`,
      [supplierId]
    );
    const r = res.rows[0].result as RPC结果;
    expect(r.success).toBe(false);
    expect(r.error).toContain("未登录");
  });

  /* 2. 无角色用户门禁 */
  it("无角色用户 → 无权限", async () => {
    const r = await withAuth(NOBODY_USER_ID, () => 建收款单(100));
    expect(r.success).toBe(false);
    expect(r.error).toContain("无权限");
  });

  /* 3. 正常收款：负余额收一部分，单据+refund 流水+余额变化全对 */
  it("正常收款：余额 -500 收 300 → 余额 -200，单号/流水正确", async () => {
    /* 造负余额：只付没欠（多付 500） */
    const tid = await 造流水("payment", 500, `${PFX}多付500`);
    expect(await 算余额()).toBe(-500);

    const r = await withAuth(TEST_USER_ID, () =>
      建收款单(300, { method: "银行转账", note: `${PFX}退回多付` })
    );
    expect(r.success).toBe(true);
    expect(r.receipt_no).toMatch(/^SK-\d{8}-\d{3}$/);

    /* refund 流水（带收款方式和回指） */
    const tx = await query(
      `SELECT amount, payment_method, transaction_type FROM supplier_transactions
       WHERE reference_type = 'supplier_receipt' AND reference_id = $1`,
      [r.receipt_id]
    );
    expect(tx.rows.length).toBe(1);
    expect(tx.rows[0].transaction_type).toBe("refund");
    expect(Number(tx.rows[0].amount)).toBe(300);
    expect(tx.rows[0].payment_method).toBe("银行转账");

    /* 余额：-500 + 300 = -200 */
    expect(await 算余额()).toBe(-200);

    /* 汇总函数口径一致 */
    const 汇总 = await withAuth(TEST_USER_ID, 查汇总);
    expect(汇总).toBeTruthy();
    expect(Number(汇总!.balance)).toBe(-200);

    await query(`DELETE FROM supplier_receipts WHERE id = $1`, [r.receipt_id]);
    await query(`DELETE FROM supplier_transactions WHERE id = $1 OR (supplier_id = $2 AND transaction_type = 'refund')`, [tid, supplierId]);
  });

  /* 4. 超额拒绝：收得比待退余额多 → 报错且整体回滚 */
  it("收款超过待退余额 → 报错且不留痕", async () => {
    const tid = await 造流水("payment", 500, `${PFX}多付500b`);

    const r = await withAuth(TEST_USER_ID, () => 建收款单(600));
    expect(r.success).toBe(false);
    expect(r.error).toContain("待退余额");

    /* 回滚验证：收款单不存在、refund 流水没多 */
    const rec = await query(`SELECT COUNT(*)::int AS n FROM supplier_receipts WHERE supplier_id = $1`, [supplierId]);
    expect(rec.rows[0].n).toBe(0);
    expect(await 算余额()).toBe(-500);

    await query(`DELETE FROM supplier_transactions WHERE id = $1`, [tid]);
  });

  /* 5. 正余额拒绝：咱还欠着供应商钱，不能收款 */
  it("正余额（咱欠供应商）→ 不能收款", async () => {
    const tid = await 造流水("debit", 100, `${PFX}进货欠100`);
    expect(await 算余额()).toBe(100);

    const r = await withAuth(TEST_USER_ID, () => 建收款单(50));
    expect(r.success).toBe(false);
    expect(r.error).toContain("没有多付/待退余额");

    await query(`DELETE FROM supplier_transactions WHERE id = $1`, [tid]);
  });

  /* 6. 零余额拒绝 */
  it("零余额 → 不能收款", async () => {
    expect(await 算余额()).toBe(0);
    const r = await withAuth(TEST_USER_ID, () => 建收款单(10));
    expect(r.success).toBe(false);
    expect(r.error).toContain("没有多付/待退余额");
  });

  /* 7. 作废收款单：refund 流水删除、余额恢复、单据留痕、重复作废报错 */
  it("作废：流水删除余额恢复，单据留痕 voided；重复作废报错", async () => {
    const tid = await 造流水("payment", 400, `${PFX}多付400`);

    const r = await withAuth(TEST_USER_ID, () => 建收款单(400, { note: `${PFX}待作废` }));
    expect(r.success).toBe(true);
    expect(await 算余额()).toBe(0);

    const v = await withAuth(TEST_USER_ID, () => 作废收款单(r.receipt_id!));
    expect(v.success).toBe(true);

    /* refund 流水已删、余额回到 -400 */
    const tx = await query(
      `SELECT COUNT(*)::int AS n FROM supplier_transactions WHERE reference_type = 'supplier_receipt' AND reference_id = $1`,
      [r.receipt_id]
    );
    expect(tx.rows[0].n).toBe(0);
    expect(await 算余额()).toBe(-400);

    /* 单据留痕 voided */
    const rec = await query(`SELECT status, voided_by FROM supplier_receipts WHERE id = $1`, [r.receipt_id]);
    expect(rec.rows[0].status).toBe("voided");
    expect(rec.rows[0].voided_by).toBe(TEST_USER_ID);

    /* 重复作废 */
    const v2 = await withAuth(TEST_USER_ID, () => 作废收款单(r.receipt_id!));
    expect(v2.success).toBe(false);
    expect(v2.error).toContain("已作废");

    await query(`DELETE FROM supplier_receipts WHERE id = $1`, [r.receipt_id]);
    await query(`DELETE FROM supplier_transactions WHERE id = $1`, [tid]);
  });

  /* 8. supplier_balances 返回累计优惠列（批次7 加列） */
  it("supplier_balances 含 total_discount 累计列且计入余额", async () => {
    const t1 = await 造流水("debit", 1000, `${PFX}进货1000`);
    const t2 = await 造流水("discount", 38, `${PFX}抹零38`);

    const 汇总 = await withAuth(TEST_USER_ID, 查汇总);
    expect(汇总).toBeTruthy();
    expect(Number(汇总!.total_debit)).toBe(1000);
    expect(Number(汇总!.total_discount)).toBe(38);
    /* 余额 = 1000 − 38 = 962 */
    expect(Number(汇总!.balance)).toBe(962);

    await query(`DELETE FROM supplier_transactions WHERE id IN ($1, $2)`, [t1, t2]);
  });
});

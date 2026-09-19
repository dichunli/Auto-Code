import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

/**
 * ============================================================
 * 数据库集成测试：供应商付款/收款（退款）财务流水补记
 *   （迁移 migrations_20260919_r_supplier_payment_finance_log.sql）
 *
 * 背景 bug：采购付款（最大现金流出）与供应商退款不写 finance_transactions，
 *   收支流水页和资金账户余额看不到这些钱。
 * 修复：四个 RPC 同事务补记/删除流水，科目 采购付款/采购退款（不计利润）。
 *
 * 运行前提：
 *   1. 本地 Supabase 已启动且所有迁移已应用（含 20260919_q 和 _r）
 *   2. 环境变量 TEST_DATABASE_URL（默认 postgresql://postgres:postgres@localhost:54322/postgres）
 *
 * 运行：npx vitest run supabase/tests/supplier-payment-finance-log.test.ts
 * ============================================================
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:54322/postgres";

const TEST_USER_ID = "abababab-abab-4bab-8bab-abababababab";
const PFX = "TESTFR-";

let client: Client;
let accountId: string;
let supplierId: string;

interface RPC结果 {
  success: boolean;
  error?: string;
  payment_id?: string;
  payment_no?: string;
  receipt_id?: string;
  receipt_no?: string;
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

async function 账户余额(): Promise<number> {
  const res = await query(`SELECT balance FROM finance_accounts WHERE id = $1`, [accountId]);
  return Number(res.rows[0].balance);
}

async function 财务流水(relatedType: string, relatedId: string) {
  const res = await query(
    `SELECT ft.amount, ft.type, ft.account_id, ft.created_by, fc.name AS category_name, fc.counts_in_profit
     FROM finance_transactions ft
     LEFT JOIN finance_categories fc ON fc.id = ft.category_id
     WHERE ft.related_type = $1 AND ft.related_id = $2`,
    [relatedType, relatedId]
  );
  return res.rows as Array<{
    amount: string; type: string; account_id: string; created_by: string;
    category_name: string | null; counts_in_profit: boolean | null;
  }>;
}

/* 直接插一笔供应商应付（debit），模拟入库产生的欠款 */
async function 造应付(amount: number, 备注: string): Promise<string> {
  const res = await query(
    `INSERT INTO supplier_transactions (supplier_id, transaction_type, amount, description, created_by)
     VALUES ($1, 'debit', $2, $3, $4) RETURNING id`,
    [supplierId, amount, `${PFX}${备注}`, TEST_USER_ID]
  );
  return res.rows[0].id as string;
}

describe("供应商付款/退款 财务流水补记 - 数据库集成测试", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();

    /* 清历史残留 */
    await query(`DELETE FROM finance_transactions WHERE description LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM finance_accounts WHERE name LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM supplier_payment_allocations WHERE payment_id IN (SELECT id FROM supplier_payments WHERE note LIKE $1)`, [`${PFX}%`]);
    await query(`DELETE FROM supplier_transactions WHERE supplier_id IN (SELECT id FROM suppliers WHERE name LIKE $1)`, [`${PFX}%`]);
    await query(`DELETE FROM supplier_payments WHERE supplier_id IN (SELECT id FROM suppliers WHERE name LIKE $1)`, [`${PFX}%`]);
    await query(`DELETE FROM supplier_receipts WHERE supplier_id IN (SELECT id FROM suppliers WHERE name LIKE $1)`, [`${PFX}%`]);
    await query(`DELETE FROM suppliers WHERE name LIKE $1`, [`${PFX}%`]);

    /* 造测试用户（admin） */
    await query(
      `INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
       VALUES ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '', now(), now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `${PFX.toLowerCase()}admin@example.com`]
    );
    await query(`INSERT INTO profiles (id, full_name) VALUES ($1, '供应商流水测试员') ON CONFLICT (id) DO NOTHING`, [TEST_USER_ID]);
    await query(`INSERT INTO roles (name, label) VALUES ('admin', '管理员') ON CONFLICT (name) DO NOTHING`);
    const roleRes = await query(`SELECT id FROM roles WHERE name = 'admin'`);
    await query(
      `INSERT INTO profile_roles (profile_id, role_id) VALUES ($1, $2) ON CONFLICT (profile_id, role_id) DO NOTHING`,
      [TEST_USER_ID, roleRes.rows[0].id]
    );

    /* 资金账户 + 供应商（cash 方式解析落点以辅助函数实际结果为准） */
    await query(
      `INSERT INTO finance_accounts (name, account_type, balance, is_active) VALUES ($1, 'cash', 0, true)`,
      [`${PFX}现金`]
    );
    const resolved = await query(`SELECT public.fn_finance_account_for_method('cash') AS id`);
    accountId = resolved.rows[0].id;

    const sup = await query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`${PFX}供应商`]);
    supplierId = sup.rows[0].id;
  });

  afterAll(async () => {
    await query(`DELETE FROM finance_transactions WHERE related_type IN ('supplier_payment','supplier_receipt') AND related_id IN (SELECT id FROM supplier_payments WHERE supplier_id = $1 UNION SELECT id FROM supplier_receipts WHERE supplier_id = $1)`, [supplierId]);
    /* 经办人兜底清（防漏网流水 created_by 外键卡删用户） */
    await query(`DELETE FROM finance_transactions WHERE created_by = $1`, [TEST_USER_ID]);
    await query(`DELETE FROM supplier_payment_allocations WHERE payment_id IN (SELECT id FROM supplier_payments WHERE supplier_id = $1)`, [supplierId]);
    await query(`DELETE FROM supplier_transactions WHERE supplier_id = $1`, [supplierId]);
    await query(`DELETE FROM supplier_payments WHERE supplier_id = $1`, [supplierId]);
    await query(`DELETE FROM supplier_receipts WHERE supplier_id = $1`, [supplierId]);
    await query(`DELETE FROM suppliers WHERE id = $1`, [supplierId]);
    await query(`DELETE FROM finance_accounts WHERE name LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM profile_roles WHERE profile_id = $1`, [TEST_USER_ID]);
    await query(`DELETE FROM profiles WHERE id = $1`, [TEST_USER_ID]);
    await query(`DELETE FROM auth.users WHERE id = $1`, [TEST_USER_ID]);
    await client.end();
  });

  /* 1. 付款（实付>0）→ expense/采购付款 流水 + 账户余额减少 */
  it("供应商付款 → 补记 expense/采购付款 流水，账户余额同步减少", async () => {
    const tid = await 造应付(1000, "入库应付款");
    const 余额前 = await 账户余额();

    const r = await withAuth(TEST_USER_ID, async () => {
      const res = await query(
        `SELECT create_supplier_payment($1::UUID, 600, 'cash', NULL, $2, $3::JSONB, 0) AS result`,
        [supplierId, `${PFX}第一笔付款`, JSON.stringify([{ transaction_id: tid, amount: 600 }])]
      );
      return res.rows[0].result as RPC结果;
    });
    expect(r.success).toBe(true);

    const 流水 = await 财务流水("supplier_payment", r.payment_id!);
    expect(流水.length).toBe(1);
    expect(Number(流水[0].amount)).toBe(600);
    expect(流水[0].type).toBe("expense");
    expect(流水[0].category_name).toBe("采购付款");
    expect(流水[0].counts_in_profit).toBe(false); /* 进货是资产，不计利润 */
    expect(流水[0].account_id).toBe(accountId);
    expect(流水[0].created_by).toBe(TEST_USER_ID);
    expect(await 账户余额()).toBe(余额前 - 600);

    /* 清理（作废即删流水，走正常路径保持账平） */
    await withAuth(TEST_USER_ID, () =>
      query(`SELECT void_supplier_payment($1::UUID) AS result`, [r.payment_id])
    );
  });

  /* 2. 纯优惠抹零单（实付 0）→ 无现金流动，不记财务流水 */
  it("纯优惠单（实付 0 + 优惠>0）→ 不记财务流水", async () => {
    const tid = await 造应付(50, "抹零应付款");

    const r = await withAuth(TEST_USER_ID, async () => {
      const res = await query(
        `SELECT create_supplier_payment($1::UUID, 0, NULL, NULL, $2, $3::JSONB, 50) AS result`,
        [supplierId, `${PFX}纯优惠`, JSON.stringify([{ transaction_id: tid, amount: 50 }])]
      );
      return res.rows[0].result as RPC结果;
    });
    expect(r.success).toBe(true);

    const 流水 = await 财务流水("supplier_payment", r.payment_id!);
    expect(流水.length).toBe(0);

    await withAuth(TEST_USER_ID, () =>
      query(`SELECT void_supplier_payment($1::UUID) AS result`, [r.payment_id])
    );
  });

  /* 3. 作废付款单 → 财务流水删除 + 余额回加 */
  it("作废付款单 → 财务流水同步删除，账户余额回加", async () => {
    const tid = await 造应付(300, "待作废应付款");
    const 余额前 = await 账户余额();

    const r = await withAuth(TEST_USER_ID, async () => {
      const res = await query(
        `SELECT create_supplier_payment($1::UUID, 300, 'cash', NULL, $2, $3::JSONB, 0) AS result`,
        [supplierId, `${PFX}待作废`, JSON.stringify([{ transaction_id: tid, amount: 300 }])]
      );
      return res.rows[0].result as RPC结果;
    });
    expect(r.success).toBe(true);
    expect(await 账户余额()).toBe(余额前 - 300);

    const v = await withAuth(TEST_USER_ID, async () => {
      const res = await query(`SELECT void_supplier_payment($1::UUID) AS result`, [r.payment_id]);
      return res.rows[0].result as RPC结果;
    });
    expect(v.success).toBe(true);

    const 流水 = await 财务流水("supplier_payment", r.payment_id!);
    expect(流水.length).toBe(0);
    expect(await 账户余额()).toBe(余额前);
  });

  /* 4. 供应商退款（收款单）→ income/采购退款 流水 + 余额增加；作废对称删除 */
  it("供应商退款 → 补记 income/采购退款 流水；作废收款单 → 流水删除", async () => {
    /* 用独立供应商：前面用例作废付款单后应付都挂回主供应商头上，
       余额恒为正，收款单（要求负余额）永远建不了 */
    const sup2 = await query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`${PFX}供应商乙`]);
    const supplier2Id = sup2.rows[0].id;

    /* 造负余额：应付 100，预付 300（不勾单）→ 余额 -200，可收 150 */
    await query(
      `INSERT INTO supplier_transactions (supplier_id, transaction_type, amount, description, created_by)
       VALUES ($1, 'debit', 100, $2, $3)`,
      [supplier2Id, `${PFX}退款场景应付款`, TEST_USER_ID]
    );
    const prepay = await withAuth(TEST_USER_ID, async () => {
      const res = await query(
        `SELECT create_supplier_payment($1::UUID, 300, 'cash', NULL, $2, '[]'::JSONB, 0) AS result`,
        [supplier2Id, `${PFX}预付`]
      );
      return res.rows[0].result as RPC结果;
    });
    expect(prepay.success).toBe(true);

    const 余额前 = await 账户余额();
    const r = await withAuth(TEST_USER_ID, async () => {
      const res = await query(
        `SELECT create_supplier_receipt($1::UUID, 150, 'cash', NULL, $2) AS result`,
        [supplier2Id, `${PFX}退预付`]
      );
      return res.rows[0].result as RPC结果;
    });
    expect(r.success).toBe(true);

    const 流水 = await 财务流水("supplier_receipt", r.receipt_id!);
    expect(流水.length).toBe(1);
    expect(Number(流水[0].amount)).toBe(150);
    expect(流水[0].type).toBe("income");
    expect(流水[0].category_name).toBe("采购退款");
    expect(流水[0].counts_in_profit).toBe(false);
    expect(await 账户余额()).toBe(余额前 + 150);

    /* 作废收款单 → 流水删、余额回扣 */
    const v = await withAuth(TEST_USER_ID, async () => {
      const res = await query(`SELECT void_supplier_receipt($1::UUID) AS result`, [r.receipt_id]);
      return res.rows[0].result as RPC结果;
    });
    expect(v.success).toBe(true);
    expect((await 财务流水("supplier_receipt", r.receipt_id!)).length).toBe(0);
    expect(await 账户余额()).toBe(余额前);

    /* 收尾：作废预付单，让供应商乙账回到只剩应付 100 的干净状态 */
    await withAuth(TEST_USER_ID, () =>
      query(`SELECT void_supplier_payment($1::UUID) AS result`, [prepay.payment_id])
    );

    /* 清理供应商乙（流水按 created_by 由 afterAll 统一兜底） */
    await query(`DELETE FROM finance_transactions WHERE related_type IN ('supplier_payment','supplier_receipt') AND related_id IN (SELECT id FROM supplier_payments WHERE supplier_id = $1 UNION SELECT id FROM supplier_receipts WHERE supplier_id = $1)`, [supplier2Id]);
    await query(`DELETE FROM supplier_transactions WHERE supplier_id = $1`, [supplier2Id]);
    await query(`DELETE FROM supplier_payments WHERE supplier_id = $1`, [supplier2Id]);
    await query(`DELETE FROM supplier_receipts WHERE supplier_id = $1`, [supplier2Id]);
    await query(`DELETE FROM suppliers WHERE id = $1`, [supplier2Id]);
  });
});

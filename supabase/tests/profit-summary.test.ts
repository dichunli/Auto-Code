import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

/**
 * ============================================================
 * 数据库集成测试：利润分析汇总 RPC（report_profit_summary）
 *   —— 双计收入回归测试（迁移 migrations_20260919_n_profit_category_flag.sql）
 *
 * 背景 bug：旧版把 finance_transactions 全部 income 当"其他收入"，
 *   结算收入/欠款收回与工单 total_cost 重复计入净利润；
 *   手工"配件采购"支出与领用时的配件成本重复扣减。
 * 修复：finance_categories.counts_in_profit 标记，资金往来科目不计入利润。
 *
 * 运行前提：
 *   1. 本地 Supabase 已启动且所有迁移已应用（含 20260919_n）
 *   2. 环境变量 TEST_DATABASE_URL（默认 postgresql://postgres:postgres@localhost:54322/postgres）
 *
 * 运行：npx vitest run supabase/tests/profit-summary.test.ts
 *
 * 隔离策略：利润汇总是全量口径，断言一律用"前后差值"，
 *   不受其他测试遗留的已结算工单/流水影响。
 * ============================================================
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:54322/postgres";

const TEST_USER_ID = "eeeeeeee-ffff-4aaa-8bbb-cccccccccccc";
const PFX = "TESTPS-";

let client: Client;
let accountId: string;
let cat维修收入Id: string;
let cat其他收入Id: string;
let cat其他支出Id: string;
let cat配件采购Id: string;

interface 利润汇总 {
  success?: boolean;
  error?: string;
  total_revenue: number;
  parts_sales: number;
  labor_sales: number;
  other_sales: number;
  parts_real_cost: number;
  commission: number;
  other_costs: number;
  operating_expense: number;
  other_income: number;
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

async function 读利润汇总(): Promise<利润汇总> {
  const res = await query(`SELECT report_profit_summary() AS result`);
  return res.rows[0].result as 利润汇总;
}

/* 造一笔财务流水，返回 id */
async function 造流水(
  type: "income" | "expense",
  amount: number,
  categoryId: string | null,
  备注: string
): Promise<string> {
  const res = await query(
    `INSERT INTO finance_transactions (account_id, category_id, type, amount, description, transaction_date)
     VALUES ($1, $2, $3, $4, $5, CURRENT_DATE) RETURNING id`,
    [accountId, categoryId, type, amount, `${PFX}${备注}`]
  );
  return res.rows[0].id as string;
}

describe("利润分析汇总 RPC - 双计收入回归测试", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();

    /* 清理可能的历史残留（按前缀） */
    await query(`DELETE FROM finance_transactions WHERE description LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM finance_accounts WHERE name LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM work_order_items WHERE work_order_id IN (SELECT id FROM work_orders WHERE order_no LIKE $1)`, [`${PFX}%`]);
    await query(`DELETE FROM work_orders WHERE order_no LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM vehicles WHERE plate_number LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM customers WHERE name LIKE $1`, [`${PFX}%`]);

    /* 造测试用户：auth.users → profiles → profile_roles(admin) */
    await query(
      `INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
       VALUES ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '', now(), now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `${PFX.toLowerCase()}admin@example.com`]
    );
    await query(`INSERT INTO profiles (id, full_name) VALUES ($1, '利润测试员') ON CONFLICT (id) DO NOTHING`, [TEST_USER_ID]);
    await query(`INSERT INTO roles (name, label) VALUES ('admin', '管理员') ON CONFLICT (name) DO NOTHING`);
    const roleRes = await query(`SELECT id FROM roles WHERE name = 'admin'`);
    await query(
      `INSERT INTO profile_roles (profile_id, role_id) VALUES ($1, $2) ON CONFLICT (profile_id, role_id) DO NOTHING`,
      [TEST_USER_ID, roleRes.rows[0].id]
    );

    /* 造资金账户 */
    const acc = await query(
      `INSERT INTO finance_accounts (name, account_type, balance, is_active) VALUES ($1, 'cash', 0, true) RETURNING id`,
      [`${PFX}现金`]
    );
    accountId = acc.rows[0].id;

    /* 准备收支分类：名称唯一化避免与种子数据歧义，标记显式对齐迁移口径 */
    const mkCat = async (name: string, type: string, countsInProfit: boolean): Promise<string> => {
      const r = await query(
        `INSERT INTO finance_categories (name, type, sort_order, counts_in_profit)
         VALUES ($1, $2, 99, $3) RETURNING id`,
        [name, type, countsInProfit]
      );
      return r.rows[0].id as string;
    };
    cat维修收入Id = await mkCat(`${PFX}维修收入`, "income", false);
    cat其他收入Id = await mkCat(`${PFX}其他收入`, "income", true);
    cat其他支出Id = await mkCat(`${PFX}其他支出`, "expense", true);
    cat配件采购Id = await mkCat(`${PFX}配件采购`, "expense", false);
  });

  afterAll(async () => {
    await query(`DELETE FROM finance_transactions WHERE description LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM finance_categories WHERE name LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM work_order_items WHERE work_order_id IN (SELECT id FROM work_orders WHERE order_no LIKE $1)`, [`${PFX}%`]);
    await query(`DELETE FROM work_orders WHERE order_no LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM vehicles WHERE plate_number LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM customers WHERE name LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM finance_accounts WHERE name LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM profile_roles WHERE profile_id = $1`, [TEST_USER_ID]);
    await query(`DELETE FROM profiles WHERE id = $1`, [TEST_USER_ID]);
    await query(`DELETE FROM auth.users WHERE id = $1`, [TEST_USER_ID]);
    await client.end();
  });

  /* 1. 未登录拦截 */
  it("未登录调用 → 返回未登录错误", async () => {
    const r = await 读利润汇总();
    expect(r.success).toBe(false);
    expect(r.error).toContain("未登录");
  });

  /* 2. 核心回归：维修收入/配件采购不重复计入利润 */
  it("维修收入与配件采购不计入其他收入/运营支出，经营性科目正常计入", async () => {
    /* 造一张已结算工单：配件100 + 工时150 + 其他50 = 营收300 */
    const custRes = await query(`INSERT INTO customers (name) VALUES ($1) RETURNING id`, [`${PFX}客户`]);
    const customerId = custRes.rows[0].id;
    const vehRes = await query(
      `INSERT INTO vehicles (customer_id, plate_number) VALUES ($1, $2) RETURNING id`,
      [customerId, `${PFX}京A001`]
    );
    const vehicleId = vehRes.rows[0].id;
    const woRes = await query(
      `INSERT INTO work_orders (order_no, vehicle_id, customer_id, mileage_in,
         parts_cost, labor_cost, other_cost, advance_payment, discount_amount, status, settled_at)
       VALUES ($1, $2, $3, 5000, 100, 150, 50, 0, 0, 'settled', NOW())
       RETURNING id`,
      [`${PFX}WO001`, vehicleId, customerId]
    );
    const workOrderId = woRes.rows[0].id;

    /* 基线 */
    const 前 = await withAuth(TEST_USER_ID, () => 读利润汇总());

    /* 造四笔流水 + 一笔无分类流水：
       维修收入300（结算产生，应排除）、配件采购200（资产化，应排除）、
       其他收入80（应计入）、其他支出50（应计入）、无分类收入30（兼容旧行为，应计入） */
    const 流水ids: string[] = [];
    流水ids.push(await 造流水("income", 300, cat维修收入Id, "结算收入"));
    流水ids.push(await 造流水("expense", 200, cat配件采购Id, "采购一批件"));
    流水ids.push(await 造流水("income", 80, cat其他收入Id, "卖废机油"));
    流水ids.push(await 造流水("expense", 50, cat其他支出Id, "买清洁剂"));
    流水ids.push(await 造流水("income", 30, null, "无分类收入"));

    const 后 = await withAuth(TEST_USER_ID, () => 读利润汇总());

    /* 营收：新工单 +300 */
    expect(Number(后.total_revenue) - Number(前.total_revenue)).toBe(300);
    expect(Number(后.parts_sales) - Number(前.parts_sales)).toBe(100);
    expect(Number(后.labor_sales) - Number(前.labor_sales)).toBe(150);
    expect(Number(后.other_sales) - Number(前.other_sales)).toBe(50);

    /* 其他收入：只算 80 + 30 = 110，绝不含结算的 300（修复前会算出 410） */
    expect(Number(后.other_income) - Number(前.other_income)).toBe(110);

    /* 运营支出：只算 50，绝不含配件采购的 200（修复前会算出 250） */
    expect(Number(后.operating_expense) - Number(前.operating_expense)).toBe(50);

    /* 清理本用例数据 */
    await query(`DELETE FROM finance_transactions WHERE id = ANY($1)`, [流水ids]);
    await query(`DELETE FROM work_orders WHERE id = $1`, [workOrderId]);
    await query(`DELETE FROM vehicles WHERE id = $1`, [vehicleId]);
    await query(`DELETE FROM customers WHERE id = $1`, [customerId]);
  });

  /* 3. 作废单过滤回归：已结算但已作废的工单不得计入利润与工单统计 */
  it("已结算+已作废的工单不计入利润营收与工单统计", async () => {
    /* 造一张已结算但作废的工单：营收 999 */
    const custRes = await query(`INSERT INTO customers (name) VALUES ($1) RETURNING id`, [`${PFX}作废客户`]);
    const customerId = custRes.rows[0].id;
    const vehRes = await query(
      `INSERT INTO vehicles (customer_id, plate_number) VALUES ($1, $2) RETURNING id`,
      [customerId, `${PFX}京B002`]
    );
    const vehicleId = vehRes.rows[0].id;
    const woRes = await query(
      `INSERT INTO work_orders (order_no, vehicle_id, customer_id, mileage_in,
         parts_cost, labor_cost, other_cost, advance_payment, discount_amount, status, settled_at, order_type, cancelled_reason)
       VALUES ($1, $2, $3, 5000, 999, 0, 0, 0, 0, 'settled', NOW(), 'cancelled', '测试作废')
       RETURNING id`,
      [`${PFX}WO-CANCEL`, vehicleId, customerId]
    );
    const workOrderId = woRes.rows[0].id;

    const 利润 = await withAuth(TEST_USER_ID, () => 读利润汇总());
    /* 行存在（证明确实造进去了）但报表不含它：找一条已知基线对比太脆，
       直接断言"把这张单改回正常单前后"的营收差值 = 999 */
    await query(`UPDATE work_orders SET order_type = 'normal' WHERE id = $1`, [workOrderId]);
    const 改回后 = await withAuth(TEST_USER_ID, () => 读利润汇总());
    expect(Number(改回后.total_revenue) - Number(利润.total_revenue)).toBe(999);

    /* 工单统计同样排除作废单 */
    const 作废时统计 = await withAuth(TEST_USER_ID, async () => {
      await query(`UPDATE work_orders SET order_type = 'cancelled' WHERE id = $1`, [workOrderId]);
      const r = await query(`SELECT report_work_order_stats() AS result`);
      return r.rows[0].result as Array<{ status: string; cnt: number; amount: number }>;
    });
    const 恢复后统计 = await withAuth(TEST_USER_ID, async () => {
      await query(`UPDATE work_orders SET order_type = 'normal' WHERE id = $1`, [workOrderId]);
      const r = await query(`SELECT report_work_order_stats() AS result`);
      return r.rows[0].result as Array<{ status: string; cnt: number; amount: number }>;
    });
    const 取settled = (rows: Array<{ status: string; cnt: number; amount: number }>) =>
      rows.find((x) => x.status === "settled") || { status: "settled", cnt: 0, amount: 0 };
    expect(Number(取settled(恢复后统计).amount) - Number(取settled(作废时统计).amount)).toBe(999);
    expect(Number(取settled(恢复后统计).cnt) - Number(取settled(作废时统计).cnt)).toBe(1);

    /* 清理 */
    await query(`DELETE FROM work_orders WHERE id = $1`, [workOrderId]);
    await query(`DELETE FROM vehicles WHERE id = $1`, [vehicleId]);
    await query(`DELETE FROM customers WHERE id = $1`, [customerId]);
  });

  /* 4. 分类标记回填验证：种子数据里的"维修收入/配件采购"必须已被迁移置为 FALSE */
  it("迁移已把种子的维修收入/配件采购标记为不计入利润", async () => {
    const res = await query(
      `SELECT name, type, counts_in_profit FROM finance_categories
       WHERE (type = 'income' AND name = '维修收入') OR (type = 'expense' AND name = '配件采购')`
    );
    expect(res.rows.length).toBeGreaterThan(0);
    for (const row of res.rows) {
      expect(row.counts_in_profit).toBe(false);
    }
  });
});

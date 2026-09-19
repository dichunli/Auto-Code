import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

/**
 * ============================================================
 * 数据库集成测试：预收款/预收退款/会员充值 财务流水补记
 *   （迁移 migrations_20260919_q_advance_recharge_finance_log.sql）
 *
 * 背景 bug：预收款登记/退款、会员充值只记业务表不写 finance_transactions，
 *   资金账户余额小于实际现金，收支流水页看不到这些钱。
 * 修复：三个 RPC 在同一事务内补记流水；recharge_member 改 SECURITY DEFINER
 *   并补齐登录+角色门禁（原为 INVOKER 无门禁，靠下游 RLS 兜底）。
 *
 * 运行前提：
 *   1. 本地 Supabase 已启动且所有迁移已应用（含 20260919_q）
 *   2. 环境变量 TEST_DATABASE_URL（默认 postgresql://postgres:postgres@localhost:54322/postgres）
 *
 * 运行：npx vitest run supabase/tests/advance-recharge-finance-log.test.ts
 * ============================================================
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:54322/postgres";

const TEST_USER_ID = "ffffffff-aaaa-4bbb-8ccc-dddddddddddd";
const NOBODY_USER_ID = "ffffffff-aaaa-4bbb-8ccc-eeeeeeeeeeee";
const PFX = "TESTFQ-";

let client: Client;
let accountId: string; /* 'cash' 方式应解析到的账户（与辅助函数同一口径） */

interface RPC结果 {
  success: boolean;
  error?: string;
  new_balance?: number;
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

/* 造一张未结算工单，返回 { workOrderId, customerId, vehicleId } */
async function 造工单(): Promise<{ workOrderId: string; customerId: string; vehicleId: string }> {
  const 随机 = Math.random().toString().slice(2, 10);
  const cust = await query(`INSERT INTO customers (name, phone) VALUES ($1, $2) RETURNING id`, [`${PFX}客户`, `139${随机}`]);
  const veh = await query(
    `INSERT INTO vehicles (customer_id, plate_number) VALUES ($1, $2) RETURNING id`,
    [cust.rows[0].id, `${PFX}${随机.slice(0, 4)}`]
  );
  const wo = await query(
    `INSERT INTO work_orders (order_no, vehicle_id, customer_id, mileage_in, parts_cost, labor_cost, other_cost, advance_payment, discount_amount, status)
     VALUES ($1, $2, $3, 5000, 100, 100, 0, 0, 0, 'pending_settlement') RETURNING id`,
    [`${PFX}WO${随机}`, veh.rows[0].id, cust.rows[0].id]
  );
  return { workOrderId: wo.rows[0].id, customerId: cust.rows[0].id, vehicleId: veh.rows[0].id };
}

async function 清理工单(t: { workOrderId: string; customerId: string; vehicleId: string }) {
  await query(`DELETE FROM finance_transactions WHERE related_type = 'advance_payment' AND related_id IN (SELECT id FROM advance_payment_records WHERE work_order_id = $1)`, [t.workOrderId]);
  await query(`DELETE FROM advance_payment_records WHERE work_order_id = $1`, [t.workOrderId]);
  await query(`DELETE FROM work_orders WHERE id = $1`, [t.workOrderId]);
  await query(`DELETE FROM vehicles WHERE id = $1`, [t.vehicleId]);
  await query(`DELETE FROM customers WHERE id = $1`, [t.customerId]);
}

describe("预收款/会员充值 财务流水补记 - 数据库集成测试", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();

    /* 清历史残留 */
    await query(`DELETE FROM finance_transactions WHERE description LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM finance_accounts WHERE name LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM member_transactions WHERE notes LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM members WHERE card_no LIKE $1`, [`${PFX}%`]);

    /* 造测试用户：admin + 路人 */
    for (const [uid, name] of [[TEST_USER_ID, "流水测试员"], [NOBODY_USER_ID, "路人丙"]] as const) {
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

    /* 造一个 cash 类型资金账户（'cash' 收款方式的解析落点）。
       注意：辅助函数按 created_at 取最早启用账户，测试库可能有其他测试遗留的
       cash 账户，所以断言一律以辅助函数实际解析结果为准 */
    await query(
      `INSERT INTO finance_accounts (name, account_type, balance, is_active) VALUES ($1, 'cash', 0, true)`,
      [`${PFX}现金`]
    );
    const resolved = await query(`SELECT public.fn_finance_account_for_method('cash') AS id`);
    accountId = resolved.rows[0].id;
  });

  afterAll(async () => {
    await query(`DELETE FROM finance_transactions WHERE description LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM finance_accounts WHERE name LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM member_transactions WHERE notes LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM members WHERE card_no LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM profile_roles WHERE profile_id IN ($1, $2)`, [TEST_USER_ID, NOBODY_USER_ID]);
    await query(`DELETE FROM profiles WHERE id IN ($1, $2)`, [TEST_USER_ID, NOBODY_USER_ID]);
    await query(`DELETE FROM auth.users WHERE id IN ($1, $2)`, [TEST_USER_ID, NOBODY_USER_ID]);
    await client.end();
  });

  /* 1. 预收款登记：流水 income/预收款 + 账户余额增加 + 关联预收记录 */
  it("登记预收款 → 补记 income/预收款 流水，账户余额同步增加", async () => {
    const t = await 造工单();
    const 余额前 = await 账户余额();

    const r = await withAuth(TEST_USER_ID, async () => {
      const res = await query(
        `SELECT register_advance_payment($1::UUID, 200, 'cash', '测试收款') AS result`,
        [t.workOrderId]
      );
      return res.rows[0].result as RPC结果;
    });
    expect(r.success).toBe(true);

    /* 工单预收额累加 */
    const wo = await query(`SELECT advance_payment FROM work_orders WHERE id = $1`, [t.workOrderId]);
    expect(Number(wo.rows[0].advance_payment)).toBe(200);

    /* 流水：income / 预收款 / 指向预收记录 / 经办人 / 正确账户 */
    const tx = await query(
      `SELECT ft.amount, ft.type, ft.account_id, ft.related_id, ft.created_by, fc.name AS category_name, fc.counts_in_profit
       FROM finance_transactions ft
       JOIN advance_payment_records apr ON apr.id = ft.related_id
       LEFT JOIN finance_categories fc ON fc.id = ft.category_id
       WHERE ft.related_type = 'advance_payment' AND apr.work_order_id = $1 AND ft.type = 'income'`,
      [t.workOrderId]
    );
    expect(tx.rows.length).toBe(1);
    expect(Number(tx.rows[0].amount)).toBe(200);
    expect(tx.rows[0].category_name).toBe("预收款");
    expect(tx.rows[0].counts_in_profit).toBe(false); /* 不计利润，结算时才计营收 */
    expect(tx.rows[0].account_id).toBe(accountId);
    expect(tx.rows[0].created_by).toBe(TEST_USER_ID);

    /* 账户余额 +200（触发器） */
    expect(await 账户余额()).toBe(余额前 + 200);

    await 清理工单(t);
  });

  /* 2. 预收款退款：流水 expense/预收退款 + 余额扣回；超退拦截不被流水逻辑破坏 */
  it("预收款退款 → 补记 expense/预收退款 流水，账户余额扣回；超退仍拦截", async () => {
    const t = await 造工单();
    await withAuth(TEST_USER_ID, () =>
      query(`SELECT register_advance_payment($1::UUID, 300, 'cash', NULL) AS result`, [t.workOrderId])
    );
    const rec = await query(`SELECT id FROM advance_payment_records WHERE work_order_id = $1`, [t.workOrderId]);
    const recordId = rec.rows[0].id;
    const 余额前 = await 账户余额();

    /* 正常退 100 */
    const r = await withAuth(TEST_USER_ID, async () => {
      const res = await query(
        `SELECT refund_advance_payment($1::UUID, 100, 'cash') AS result`,
        [recordId]
      );
      return res.rows[0].result as RPC结果;
    });
    expect(r.success).toBe(true);

    const tx = await query(
      `SELECT ft.amount, ft.type, fc.name AS category_name, fc.counts_in_profit
       FROM finance_transactions ft
       LEFT JOIN finance_categories fc ON fc.id = ft.category_id
       WHERE ft.related_type = 'advance_payment' AND ft.related_id = $1 AND ft.type = 'expense'`,
      [recordId]
    );
    expect(tx.rows.length).toBe(1);
    expect(Number(tx.rows[0].amount)).toBe(100);
    expect(tx.rows[0].category_name).toBe("预收退款");
    expect(tx.rows[0].counts_in_profit).toBe(false);
    expect(await 账户余额()).toBe(余额前 - 100);

    /* 超退拦截：最多再退 200，退 250 必须失败且无新流水 */
    const r2 = await withAuth(TEST_USER_ID, async () => {
      const res = await query(
        `SELECT refund_advance_payment($1::UUID, 250, 'cash') AS result`,
        [recordId]
      );
      return res.rows[0].result as RPC结果;
    });
    expect(r2.success).toBe(false);
    const tx2 = await query(
      `SELECT COUNT(*)::int AS n FROM finance_transactions
       WHERE related_type = 'advance_payment' AND related_id = $1 AND type = 'expense'`,
      [recordId]
    );
    expect(tx2.rows[0].n).toBe(1); /* 仍只有第一次退款的 1 条 */

    await 清理工单(t);
  });

  /* 3. 会员充值：流水 income/会员充值 + 余额联动 + 关联会员交易记录 */
  it("会员充值 → 补记 income/会员充值 流水，账户余额同步增加", async () => {
    const m = await query(
      `INSERT INTO members (card_no, name, phone, balance, status) VALUES ($1, $2, $3, 0, 'active') RETURNING id`,
      [`${PFX}M001`, `${PFX}会员`, "13800138000"]
    );
    const memberId = m.rows[0].id;
    const 余额前 = await 账户余额();

    const r = await withAuth(TEST_USER_ID, async () => {
      const res = await query(
        `SELECT recharge_member($1::UUID, 500, 'cash', $2) AS result`,
        [memberId, `${PFX}首充`]
      );
      return res.rows[0].result as RPC结果;
    });
    expect(r.success).toBe(true);
    expect(Number(r.new_balance)).toBe(500);

    const tx = await query(
      `SELECT ft.amount, ft.type, ft.related_id, fc.name AS category_name, fc.counts_in_profit
       FROM finance_transactions ft
       LEFT JOIN finance_categories fc ON fc.id = ft.category_id
       WHERE ft.related_type = 'member_recharge' AND ft.related_id IN
         (SELECT id FROM member_transactions WHERE member_id = $1)`,
      [memberId]
    );
    expect(tx.rows.length).toBe(1);
    expect(Number(tx.rows[0].amount)).toBe(500);
    expect(tx.rows[0].category_name).toBe("会员充值");
    expect(tx.rows[0].counts_in_profit).toBe(false); /* 储值是负债，不计利润 */
    expect(await 账户余额()).toBe(余额前 + 500);

    await query(`DELETE FROM finance_transactions WHERE related_type = 'member_recharge' AND related_id IN (SELECT id FROM member_transactions WHERE member_id = $1)`, [memberId]);
    await query(`DELETE FROM member_transactions WHERE member_id = $1`, [memberId]);
    await query(`DELETE FROM members WHERE id = $1`, [memberId]);
  });

  /* 4. 门禁回归：DEFINER 化后无角色用户必须被拒（拒绝路径必测） */
  it("无角色用户充值/登记预收款 → 无权限", async () => {
    const m = await query(
      `INSERT INTO members (card_no, name, phone, balance, status) VALUES ($1, $2, $3, 0, 'active') RETURNING id`,
      [`${PFX}M002`, `${PFX}会员乙`, "13800138001"]
    );
    const memberId = m.rows[0].id;
    const t = await 造工单();

    const 充值 = await withAuth(NOBODY_USER_ID, async () => {
      const res = await query(`SELECT recharge_member($1::UUID, 100, 'cash', NULL) AS result`, [memberId]);
      return res.rows[0].result as RPC结果;
    });
    expect(充值.success).toBe(false);
    expect(充值.error).toContain("无权限");

    const 预收 = await withAuth(NOBODY_USER_ID, async () => {
      const res = await query(`SELECT register_advance_payment($1::UUID, 100, 'cash', NULL) AS result`, [t.workOrderId]);
      return res.rows[0].result as RPC结果;
    });
    expect(预收.success).toBe(false);
    expect(预收.error).toContain("无权限");

    /* 会员余额不能被改动 */
    const bal = await query(`SELECT balance FROM members WHERE id = $1`, [memberId]);
    expect(Number(bal.rows[0].balance)).toBe(0);

    await query(`DELETE FROM members WHERE id = $1`, [memberId]);
    await 清理工单(t);
  });

  /* 5. 未登录拦截 */
  it("未登录调用 → 返回未登录错误", async () => {
    const m = await query(
      `INSERT INTO members (card_no, name, phone, balance, status) VALUES ($1, $2, $3, 0, 'active') RETURNING id`,
      [`${PFX}M003`, `${PFX}会员丙`, "13800138002"]
    );
    const res = await query(`SELECT recharge_member($1::UUID, 100, 'cash', NULL) AS result`, [m.rows[0].id]);
    const r = res.rows[0].result as RPC结果;
    expect(r.success).toBe(false);
    expect(r.error).toContain("未登录");
    await query(`DELETE FROM members WHERE id = $1`, [m.rows[0].id]);
  });
});

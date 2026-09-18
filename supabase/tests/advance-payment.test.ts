import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

/**
 * ============================================================
 * 数据库集成测试：预收款 RPC
 *   register_advance_payment / refund_advance_payment
 *   （迁移 migrations_20260827_advance_payment_return_rpc.sql）
 *
 * 覆盖（9-15 诊断🟠#7 补缺）：
 *   - 正常登记/退款：记录落库 + 工单预收额原子增减
 *   - 拒绝路径：未登录 / 无角色路人（管钱函数必须有"被拦住"的断言）
 *   - 边界：超额退款被行锁口径拦截、退款后余额不复负
 *
 * 运行前提：本地 Supabase 已启动且迁移已应用；
 *   TEST_DATABASE_URL（默认 postgresql://postgres:postgres@localhost:54322/postgres）
 * 运行：npx vitest run supabase/tests/advance-payment.test.ts
 * ============================================================
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:54322/postgres";

const TEST_USER_ID = "eeeeeeee-ffff-4aaa-8bbb-aaaaaaaaaaaa";
const NOBODY_USER_ID = "eeeeeeee-ffff-4aaa-8bbb-bbbbbbbbbbbb";
const PFX = "TESTAP-";

let client: Client;

interface RPC结果 {
  success: boolean;
  error?: string;
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

/* 造一套最小工单（客户+车辆+工单），返回关键 id */
async function 造工单() {
  const custRes = await query(
    `INSERT INTO customers (name, phone) VALUES ($1, $2) RETURNING id`,
    [`${PFX}客户`, `199${Math.random().toString().slice(2, 10)}`]
  );
  const customerId = custRes.rows[0].id;
  const vehRes = await query(
    `INSERT INTO vehicles (customer_id, plate_number) VALUES ($1, $2) RETURNING id`,
    [customerId, `${PFX}${Math.random().toString().slice(2, 8)}`]
  );
  const vehicleId = vehRes.rows[0].id;
  const woRes = await query(
    `INSERT INTO work_orders (order_no, vehicle_id, customer_id, mileage_in, status)
     VALUES ($1, $2, $3, 0, 'received') RETURNING id`,
    [`${PFX}WO-${Math.random().toString().slice(2, 8)}`, vehicleId, customerId]
  );
  return { customerId, vehicleId, workOrderId: woRes.rows[0].id as string };
}

async function 清理(ids: { customerId: string; vehicleId: string; workOrderId: string }) {
  await query(`DELETE FROM advance_payment_records WHERE work_order_id = $1`, [ids.workOrderId]);
  await query(`DELETE FROM work_orders WHERE id = $1`, [ids.workOrderId]);
  await query(`DELETE FROM vehicles WHERE id = $1`, [ids.vehicleId]);
  await query(`DELETE FROM customers WHERE id = $1`, [ids.customerId]);
}

async function 登记(workOrderId: string, amount: number, method = "cash"): Promise<RPC结果> {
  const res = await query(
    `SELECT register_advance_payment($1::UUID, $2::DECIMAL, $3::TEXT, $4::TEXT) as result`,
    [workOrderId, amount, method, "测试收款员"]
  );
  return res.rows[0].result as RPC结果;
}

async function 退款(recordId: string, amount: number): Promise<RPC结果> {
  const res = await query(
    `SELECT refund_advance_payment($1::UUID, $2::DECIMAL, $3::TEXT) as result`,
    [recordId, amount, "cash"]
  );
  return res.rows[0].result as RPC结果;
}

async function 工单预收额(workOrderId: string): Promise<number> {
  const res = await query(`SELECT advance_payment FROM work_orders WHERE id = $1`, [workOrderId]);
  return Number(res.rows[0].advance_payment || 0);
}

describe("预收款 RPC - 数据库集成测试", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();

    /* 造测试用户：auth.users → profiles → profile_roles(admin) */
    for (const [uid, name] of [[TEST_USER_ID, "预收款测试员"], [NOBODY_USER_ID, "路人丙"]] as const) {
      await query(
        `INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
         VALUES ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '', now(), now(), now())
         ON CONFLICT (id) DO NOTHING`,
        [uid, `ap-test-${uid.slice(-4)}@example.com`]
      );
      await query(`INSERT INTO profiles (id, full_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [uid, name]);
    }
    await query(`INSERT INTO roles (name, label) VALUES ('admin', '管理员') ON CONFLICT (name) DO NOTHING`);
    const roleRes = await query(`SELECT id FROM roles WHERE name = 'admin'`);
    await query(
      `INSERT INTO profile_roles (profile_id, role_id) VALUES ($1, $2) ON CONFLICT (profile_id, role_id) DO NOTHING`,
      [TEST_USER_ID, roleRes.rows[0].id]
    );
  });

  afterAll(async () => {
    await query(`DELETE FROM profile_roles WHERE profile_id IN ($1, $2)`, [TEST_USER_ID, NOBODY_USER_ID]);
    await query(`DELETE FROM profiles WHERE id IN ($1, $2)`, [TEST_USER_ID, NOBODY_USER_ID]);
    await query(`DELETE FROM auth.users WHERE id IN ($1, $2)`, [TEST_USER_ID, NOBODY_USER_ID]);
    await client.end();
  });

  /* ─── 正常流程 ─── */
  it("登记预收款：记录落库（收款人取 auth.uid()）+ 工单预收额原子累加", async () => {
    const ids = await 造工单();
    const r = await withAuth(TEST_USER_ID, () => 登记(ids.workOrderId, 500));
    expect(r.success).toBe(true);
    expect(await 工单预收额(ids.workOrderId)).toBe(500);

    const rec = await query(
      `SELECT collector_id, collector_name, amount FROM advance_payment_records WHERE work_order_id = $1`,
      [ids.workOrderId]
    );
    expect(rec.rows).toHaveLength(1);
    expect(rec.rows[0].collector_id).toBe(TEST_USER_ID);
    expect(Number(rec.rows[0].amount)).toBe(500);

    /* 再登记一笔，累加 */
    await withAuth(TEST_USER_ID, () => 登记(ids.workOrderId, 300));
    expect(await 工单预收额(ids.workOrderId)).toBe(800);
    await 清理(ids);
  });

  it("退款：已退额累加 + 工单预收额扣减；超额退款被拦截", async () => {
    const ids = await 造工单();
    await withAuth(TEST_USER_ID, () => 登记(ids.workOrderId, 500));
    const rec = await query(
      `SELECT id FROM advance_payment_records WHERE work_order_id = $1`, [ids.workOrderId]
    );
    const recordId = rec.rows[0].id;

    /* 正常退 200 */
    const r1 = await withAuth(TEST_USER_ID, () => 退款(recordId, 200));
    expect(r1.success).toBe(true);
    expect(await 工单预收额(ids.workOrderId)).toBe(300);

    /* 超额退 400（最多还能退 300）→ 拦截，金额不动 */
    const r2 = await withAuth(TEST_USER_ID, () => 退款(recordId, 400));
    expect(r2.success).toBe(false);
    expect(r2.error).toContain("最多可退");
    expect(await 工单预收额(ids.workOrderId)).toBe(300);

    /* 退满剩余 300 → 成功，预收额归零（GREATEST 兜底不复负） */
    const r3 = await withAuth(TEST_USER_ID, () => 退款(recordId, 300));
    expect(r3.success).toBe(true);
    expect(await 工单预收额(ids.workOrderId)).toBe(0);
    await 清理(ids);
  });

  /* ─── 拒绝路径 ─── */
  it("未登录登记 → 拒绝", async () => {
    const ids = await 造工单();
    const r = await 登记(ids.workOrderId, 100);
    expect(r.success).toBe(false);
    expect(r.error).toContain("未登录");
    expect(await 工单预收额(ids.workOrderId)).toBe(0);
    await 清理(ids);
  });

  it("无角色路人登记 → 拒绝", async () => {
    const ids = await 造工单();
    const r = await withAuth(NOBODY_USER_ID, () => 登记(ids.workOrderId, 100));
    expect(r.success).toBe(false);
    expect(r.error).toContain("无权限");
    expect(await 工单预收额(ids.workOrderId)).toBe(0);
    await 清理(ids);
  });

  it("未登录退款 → 拒绝", async () => {
    const ids = await 造工单();
    await withAuth(TEST_USER_ID, () => 登记(ids.workOrderId, 100));
    const rec = await query(
      `SELECT id FROM advance_payment_records WHERE work_order_id = $1`, [ids.workOrderId]
    );
    const r = await 退款(rec.rows[0].id, 50);
    expect(r.success).toBe(false);
    expect(r.error).toContain("未登录");
    expect(await 工单预收额(ids.workOrderId)).toBe(100);
    await 清理(ids);
  });

  it("无角色路人退款 → 拒绝", async () => {
    const ids = await 造工单();
    await withAuth(TEST_USER_ID, () => 登记(ids.workOrderId, 100));
    const rec = await query(
      `SELECT id FROM advance_payment_records WHERE work_order_id = $1`, [ids.workOrderId]
    );
    const r = await withAuth(NOBODY_USER_ID, () => 退款(rec.rows[0].id, 50));
    expect(r.success).toBe(false);
    expect(r.error).toContain("无权限");
    expect(await 工单预收额(ids.workOrderId)).toBe(100);
    await 清理(ids);
  });

  /* ─── 边界 ─── */
  it("登记金额为空/负数 → 拒绝", async () => {
    const ids = await 造工单();
    const r1 = await withAuth(TEST_USER_ID, () => 登记(ids.workOrderId, 0));
    expect(r1.success).toBe(false);
    const r2 = await withAuth(TEST_USER_ID, () => 登记(ids.workOrderId, -50));
    expect(r2.success).toBe(false);
    expect(await 工单预收额(ids.workOrderId)).toBe(0);
    await 清理(ids);
  });

  it("工单不存在 → 拒绝", async () => {
    const r = await withAuth(TEST_USER_ID, () =>
      登记("00000000-0000-0000-0000-000000000000", 100)
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain("工单不存在");
  });
});

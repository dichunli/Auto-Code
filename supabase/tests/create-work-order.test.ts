import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

/**
 * ============================================================
 * 数据库集成测试：create_work_order RPC（工单开单主路径）
 *   （现行 13 参版定义于 migrations_20260523_mileage_in_default.sql，
 *     2026-09-19 migrations_20260919_b 起加登录校验）
 *
 * 覆盖（9-15 诊断🟠#7 补缺，规范要求"核心业务流程至少一条测试路径"）：
 *   - 正常开单：工单落库（received 状态）+ 需求行按序写入 + 空描述跳过
 *   - 拒绝路径：未登录调用被拒（2026-09-19 起）
 *
 * 运行前提：本地 Supabase 已启动且迁移已应用（含 migrations_20260919_b）；
 *   TEST_DATABASE_URL（默认 postgresql://postgres:postgres@localhost:54322/postgres）
 * 运行：npx vitest run supabase/tests/create-work-order.test.ts
 * ============================================================
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:54322/postgres";

const TEST_USER_ID = "ffffffff-aaaa-4bbb-8ccc-aaaaaaaaaaaa";
const PFX = "TESTWO-";

let client: Client;

interface RPC结果 {
  success: boolean;
  error?: string;
  order_id?: string;
}

async function query(sql: string, values?: unknown[]) {
  return client.query(sql, values);
}

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

/* 调 create_work_order（13 参现行版） */
async function 开单(customerId: string, vehicleId: string, requirements: unknown[] = []): Promise<RPC结果> {
  const res = await query(
    `SELECT create_work_order($1::UUID, $2::UUID, $3::INTEGER, $4::INTEGER, $5::TEXT, $6::TEXT, $7::UUID, $8::JSONB, $9::TEXT, $10::TEXT) as result`,
    [
      customerId, vehicleId, 5000, null,
      "发动机异响", "外观正常",
      TEST_USER_ID, JSON.stringify(requirements),
      "送修人张三", "13900000000",
    ]
  );
  return res.rows[0].result as RPC结果;
}

describe("create_work_order RPC - 数据库集成测试", () => {
  let customerId: string;
  let vehicleId: string;
  const 产生的工单ids: string[] = [];

  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();

    /* 造测试用户（开单函数的接待人字段由 action 层传 user.id，这里直接造） */
    await query(
      `INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
       VALUES ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '', now(), now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `wo-test-${TEST_USER_ID.slice(-4)}@example.com`]
    );
    await query(`INSERT INTO profiles (id, full_name) VALUES ($1, '开单测试员') ON CONFLICT (id) DO NOTHING`, [TEST_USER_ID]);

    /* 造客户+车辆 */
    const custRes = await query(
      `INSERT INTO customers (name, phone) VALUES ($1, $2) RETURNING id`,
      [`${PFX}客户`, `188${Math.random().toString().slice(2, 10)}`]
    );
    customerId = custRes.rows[0].id;
    const vehRes = await query(
      `INSERT INTO vehicles (customer_id, plate_number) VALUES ($1, $2) RETURNING id`,
      [customerId, `${PFX}${Math.random().toString().slice(2, 8)}`]
    );
    vehicleId = vehRes.rows[0].id;
  });

  afterAll(async () => {
    for (const id of 产生的工单ids) {
      await query(`DELETE FROM work_order_requirements WHERE work_order_id = $1`, [id]);
      await query(`DELETE FROM work_orders WHERE id = $1`, [id]);
    }
    await query(`DELETE FROM vehicles WHERE id = $1`, [vehicleId]);
    await query(`DELETE FROM customers WHERE id = $1`, [customerId]);
    await query(`DELETE FROM profiles WHERE id = $1`, [TEST_USER_ID]);
    await query(`DELETE FROM auth.users WHERE id = $1`, [TEST_USER_ID]);
    await client.end();
  });

  it("正常开单：工单落库为 received + 需求行按序写入 + 空描述自动跳过", async () => {
    const r = await withAuth(TEST_USER_ID, () =>
      开单(customerId, vehicleId, [
        { description: "更换机油", assigned_to: null },
        { description: "   " },           /* 纯空白描述应被跳过 */
        { description: "检查刹车", assigned_to: null },
      ])
    );
    expect(r.success).toBe(true);
    expect(r.order_id).toBeTruthy();
    产生的工单ids.push(r.order_id!);

    const wo = await query(
      `SELECT status, mileage_in, customer_complaint, sender_name FROM work_orders WHERE id = $1`,
      [r.order_id]
    );
    expect(wo.rows[0].status).toBe("received");
    expect(wo.rows[0].mileage_in).toBe(5000);
    expect(wo.rows[0].customer_complaint).toBe("发动机异响");
    expect(wo.rows[0].sender_name).toBe("送修人张三");

    /* 需求行：2 条有效（空白跳过），seq 连续 */
    const reqs = await query(
      `SELECT seq, description FROM work_order_requirements WHERE work_order_id = $1 ORDER BY seq`,
      [r.order_id]
    );
    expect(reqs.rows).toHaveLength(2);
    expect(reqs.rows[0].description).toBe("更换机油");
    expect(reqs.rows[1].description).toBe("检查刹车");
  });

  it("未登录调用 → 拒绝，不产生工单（2026-09-19 门禁）", async () => {
    /* 记录调用前数量（前一用例已开过 1 单，不能断言绝对值 0） */
    const before = await query(
      `SELECT COUNT(*) as cnt FROM work_orders WHERE customer_id = $1`,
      [customerId]
    );
    const 调用前 = parseInt(before.rows[0].cnt);

    const r = await 开单(customerId, vehicleId, []);
    expect(r.success).toBe(false);
    expect(r.error).toContain("未登录");

    const after = await query(
      `SELECT COUNT(*) as cnt FROM work_orders WHERE customer_id = $1`,
      [customerId]
    );
    expect(parseInt(after.rows[0].cnt)).toBe(调用前);
  });
});

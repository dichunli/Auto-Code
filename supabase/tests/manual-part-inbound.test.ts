import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

/**
 * ============================================================
 * 数据库集成测试：manual_part_inbound RPC（手工入库）
 *
 * 覆盖（2026-09-12 诊断 P0「并发丢库存」的回归保护）：
 *   1. 正常入库 → 库存增加、流水前后数量正确、有批次号时建批次
 *   2. 无批次号 → 不建批次
 *   3. 并发两次入库 → 库存 = 初始 + 两次之和（旧版"读-改-写"会丢一次）
 *   4. 未登录 → 拒绝
 *   5. 数量 0 / 负数 → 拒绝
 *   6. 配件不存在 → 拒绝
 *
 * 运行前提：
 *   1. 本地 Supabase 已启动且所有迁移已应用（含 20260912_b_manual_part_inbound）
 *   2. 环境变量 TEST_DATABASE_URL（默认 postgresql://postgres:postgres@localhost:54322/postgres）
 *
 * 运行：npm run test:db
 *
 * 认证模拟：函数内 auth.uid() 读 request.jwt.claims 的 sub；
 * 测试在事务内用 set_config(..., true) 注入，COMMIT 后自动失效。
 * ============================================================
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:54322/postgres";

/* 固定测试用户 id（造数专用，避免与真实数据混淆） */
const TEST_USER_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
/* 测试数据统一前缀，便于兜底清理 */
const PFX = "TESTMI-";

let client: Client;

async function query(sql: string, values?: unknown[]) {
  return client.query(sql, values);
}

/* 在事务内注入登录身份后调用 RPC（函数返回 JSONB 不中断事务） */
async function withAuth<T>(fn: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  await client.query(
    `SELECT set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: TEST_USER_ID, role: "authenticated" })]
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

async function callManualInbound(
  partId: string,
  qty: number,
  opts: { unitCost?: number; batchNo?: string; notes?: string } = {},
  targetClient?: Client
) {
  const c = targetClient || client;
  const res = await c.query(
    `SELECT manual_part_inbound($1::UUID, $2::INTEGER, $3::DECIMAL, $4::TEXT, NULL, $5::TEXT) as result`,
    [partId, qty, opts.unitCost ?? null, opts.batchNo ?? null, opts.notes ?? null]
  );
  return res.rows[0].result as {
    success: boolean;
    error?: string;
    before_qty?: number;
    after_qty?: number;
  };
}

/* 造一个配件（含 part_names；part_names.category_id 为 NOT NULL FK，先造分类） */
async function createPart(suffix: string, 初始库存: number) {
  const catRes = await query(
    `INSERT INTO part_categories (name) VALUES ($1) RETURNING id`,
    [`${PFX}分类${suffix}`]
  );
  const pnRes = await query(
    `INSERT INTO part_names (category_id, name) VALUES ($1, $2) RETURNING id`,
    [catRes.rows[0].id, `${PFX}配件名${suffix}`]
  );
  const pRes = await query(
    `INSERT INTO parts (part_number, part_name_id, name, quantity, purchase_price)
     VALUES ($1, $2, $3, $4, 10) RETURNING id`,
    [`${PFX}${suffix}`, pnRes.rows[0].id, `测试配件${suffix}`, 初始库存]
  );
  return { partId: pRes.rows[0].id as string, partNameId: pnRes.rows[0].id as string };
}

/* 按前缀兜底清理全部测试数据（反序删，绕过 FK） */
async function cleanupAll() {
  await query(`DELETE FROM inventory_logs WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM part_batches WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM parts WHERE part_number LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM part_names WHERE name LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM part_categories WHERE name LIKE $1`, [`${PFX}%`]);
}

async function 库存(partId: string): Promise<number> {
  const res = await query(`SELECT quantity FROM parts WHERE id = $1`, [partId]);
  return res.rows[0].quantity as number;
}

describe("manual_part_inbound - 数据库集成测试", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    await cleanupAll();

    /* 造测试用户：auth.users → profiles（函数只查 auth.uid()，不查角色） */
    await query(
      `INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
       VALUES ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '', now(), now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `${PFX.toLowerCase()}test@example.com`]
    );
    await query(
      `INSERT INTO profiles (id, full_name) VALUES ($1, '手工入库测试员') ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID]
    );
  });

  afterAll(async () => {
    await cleanupAll();
    await query(`DELETE FROM profiles WHERE id = $1`, [TEST_USER_ID]);
    await query(`DELETE FROM auth.users WHERE id = $1`, [TEST_USER_ID]);
    await client.end();
  });

  it("正常入库 → 库存增加、流水前后数量正确、有批次号时建批次", async () => {
    const { partId } = await createPart("A", 10);

    const r = await withAuth(() =>
      callManualInbound(partId, 5, { unitCost: 8.5, batchNo: "PC-001", notes: "测试入库" })
    );

    expect(r.success).toBe(true);
    expect(r.before_qty).toBe(10);
    expect(r.after_qty).toBe(15);
    expect(await 库存(partId)).toBe(15);

    /* 流水：类型/变动/前后数量 */
    const logRes = await query(
      `SELECT type, change_qty, before_qty, after_qty, notes FROM inventory_logs WHERE part_id = $1`,
      [partId]
    );
    expect(logRes.rows).toHaveLength(1);
    expect(logRes.rows[0].type).toBe("inbound");
    expect(logRes.rows[0].change_qty).toBe(5);
    expect(logRes.rows[0].before_qty).toBe(10);
    expect(logRes.rows[0].after_qty).toBe(15);
    expect(logRes.rows[0].notes).toBe("测试入库");

    /* 批次：数量/剩余/成本价 */
    const batchRes = await query(
      `SELECT batch_no, quantity, remaining, unit_cost FROM part_batches WHERE part_id = $1`,
      [partId]
    );
    expect(batchRes.rows).toHaveLength(1);
    expect(batchRes.rows[0].batch_no).toBe("PC-001");
    expect(batchRes.rows[0].quantity).toBe(5);
    expect(batchRes.rows[0].remaining).toBe(5);
    expect(parseFloat(batchRes.rows[0].unit_cost)).toBe(8.5);

    await cleanupAll();
  });

  it("无批次号 → 不建批次，只有流水", async () => {
    const { partId } = await createPart("B", 3);

    const r = await withAuth(() => callManualInbound(partId, 2));
    expect(r.success).toBe(true);
    expect(await 库存(partId)).toBe(5);

    const batchRes = await query(`SELECT COUNT(*) c FROM part_batches WHERE part_id = $1`, [partId]);
    expect(batchRes.rows[0].c).toBe("0");
    const logRes = await query(`SELECT COUNT(*) c FROM inventory_logs WHERE part_id = $1`, [partId]);
    expect(logRes.rows[0].c).toBe("1");

    await cleanupAll();
  });

  it("并发两次入库 → 库存 = 初始 + 两次之和（回归：读-改-写丢库存）", async () => {
    const { partId } = await createPart("C", 10);

    const client2 = new Client({ connectionString: DATABASE_URL });
    await client2.connect();

    /* 两个连接各自注入身份，同时入库 5 和 3 */
    await client.query("BEGIN");
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: TEST_USER_ID })]);
    const p1 = callManualInbound(partId, 5, { batchNo: "PC-T1" })
      .then(async (r) => { await client.query("COMMIT"); return r; })
      .catch(async (e) => { await client.query("ROLLBACK"); throw e; });

    await client2.query("BEGIN");
    await client2.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: TEST_USER_ID })]);
    const p2 = callManualInbound(partId, 3, { batchNo: "PC-T2" })
      .then(async (r) => { await client2.query("COMMIT"); return r; })
      .catch(async (e) => { await client2.query("ROLLBACK"); throw e; });

    const [r1, r2] = await Promise.all([p1, p2]);
    await client2.end();

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    /* 核心断言：10 + 5 + 3 = 18，一次都不能丢 */
    expect(await 库存(partId)).toBe(18);

    /* 两条流水，且 after_qty 分别是 15 和 18（排队执行，各算各的） */
    const logRes = await query(
      `SELECT change_qty, before_qty, after_qty FROM inventory_logs WHERE part_id = $1 ORDER BY after_qty`,
      [partId]
    );
    expect(logRes.rows).toHaveLength(2);
    const 收尾对 = logRes.rows.map((row) => row.before_qty + row.change_qty === row.after_qty);
    expect(收尾对).toEqual([true, true]);
    expect(logRes.rows.map((row) => row.after_qty).sort((a, b) => a - b)).toEqual([15, 18]);

    await cleanupAll();
  });

  it("未登录 → 拒绝", async () => {
    const { partId } = await createPart("D", 10);
    const r = await callManualInbound(partId, 5);
    expect(r.success).toBe(false);
    expect(r.error).toContain("未登录");
    expect(await 库存(partId)).toBe(10);
    await cleanupAll();
  });

  it("数量为 0 → 拒绝", async () => {
    const { partId } = await createPart("E", 10);
    const r = await withAuth(() => callManualInbound(partId, 0));
    expect(r.success).toBe(false);
    expect(r.error).toContain("入库数量必须大于0");
    expect(await 库存(partId)).toBe(10);
    await cleanupAll();
  });

  it("数量为负 → 拒绝", async () => {
    const { partId } = await createPart("F", 10);
    const r = await withAuth(() => callManualInbound(partId, -3));
    expect(r.success).toBe(false);
    expect(r.error).toContain("入库数量必须大于0");
    expect(await 库存(partId)).toBe(10);
    await cleanupAll();
  });

  it("配件不存在 → 拒绝", async () => {
    const r = await withAuth(() =>
      callManualInbound("00000000-0000-0000-0000-000000000000", 5)
    );
    expect(r.success).toBe(false);
    expect(r.error).toBe("配件不存在");
  });
});

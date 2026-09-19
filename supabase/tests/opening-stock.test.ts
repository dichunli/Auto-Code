import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

/**
 * ============================================================
 * 数据库集成测试：期初建账入库 RPC（opening_stock_inbound）
 *   （迁移 migrations_20260919_x_opening_stock_inbound.sql）
 *
 * 背景 bug：新建配件/批量导入/入库新增模式 的初始库存无批次行，
 *   领料（强制 batch_id）永远领不出，且无流水可查。
 * 修复口径：一个事务 = 总库存 + 必建期初批次 + 仓位（可选）+ 流水。
 *
 * 运行前提：
 *   1. 本地 Supabase 已启动且所有迁移已应用（含 20260919_x）
 *   2. 环境变量 TEST_DATABASE_URL（默认 postgresql://postgres:postgres@localhost:54322/postgres）
 *
 * 运行：npx vitest run supabase/tests/opening-stock.test.ts
 * ============================================================
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:54322/postgres";

const TEST_USER_ID = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const NOBODY_USER_ID = "a1a1a1a1-a1a1-4a1a-8a1a-b2b2b2b2b2b2";
const PFX = "TESTOS-";

let client: Client;
let warehouseId: string;
let categoryId: string;

interface RPC结果 {
  success: boolean;
  error?: string;
  batch_id?: string;
  batch_no?: string;
  before_qty?: number;
  after_qty?: number;
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

async function 造配件(初始: number = 0): Promise<string> {
  const 随机 = Math.random().toString().slice(2, 10);
  const pn = await query(`INSERT INTO part_names (category_id, name) VALUES ($1, $2) RETURNING id`, [categoryId, `${PFX}配件名${随机}`]);
  const p = await query(
    `INSERT INTO parts (part_number, part_name_id, name, quantity) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`${PFX}PN${随机}`, pn.rows[0].id, `${PFX}测试配件${随机}`, 初始]
  );
  return p.rows[0].id as string;
}

async function 清理(partId: string) {
  await query(`DELETE FROM inventory_logs WHERE part_id = $1`, [partId]);
  await query(`DELETE FROM part_stock_locations WHERE part_id = $1`, [partId]);
  await query(`DELETE FROM part_batches WHERE part_id = $1`, [partId]);
  await query(`DELETE FROM parts WHERE id = $1`, [partId]);
}

describe("期初建账入库 RPC - 数据库集成测试", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    await query(`DELETE FROM inventory_logs WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
    await query(`DELETE FROM part_stock_locations WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
    await query(`DELETE FROM part_batches WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
    await query(`DELETE FROM parts WHERE part_number LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM part_names WHERE name LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM warehouses WHERE name LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM part_categories WHERE name LIKE $1`, [`${PFX}%`]);

    /* 仓管 + 路人 */
    for (const [uid, name] of [[TEST_USER_ID, "期初测试仓管"], [NOBODY_USER_ID, "路人己"]] as const) {
      await query(
        `INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
         VALUES ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '', now(), now(), now())
         ON CONFLICT (id) DO NOTHING`,
        [uid, `${PFX.toLowerCase()}${uid.slice(-4)}@example.com`]
      );
      await query(`INSERT INTO profiles (id, full_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [uid, name]);
    }
    await query(`INSERT INTO roles (name, label) SELECT 'warehouse', '仓管' WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'warehouse')`);
    await query(
      `INSERT INTO profile_roles (profile_id, role_id)
       SELECT $1, id FROM roles WHERE name = 'warehouse'
       ON CONFLICT (profile_id, role_id) DO NOTHING`,
      [TEST_USER_ID]
    );

    const w = await query(`INSERT INTO warehouses (name) VALUES ($1) RETURNING id`, [`${PFX}主仓`]);
    warehouseId = w.rows[0].id;
    const cat = await query(`INSERT INTO part_categories (name) VALUES ($1) RETURNING id`, [`${PFX}分类`]);
    categoryId = cat.rows[0].id;
  });

  afterAll(async () => {
    await query(`DELETE FROM inventory_logs WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
    await query(`DELETE FROM part_stock_locations WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
    await query(`DELETE FROM part_batches WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
    await query(`DELETE FROM parts WHERE part_number LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM part_names WHERE name LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM warehouses WHERE name LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM part_categories WHERE name LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM profile_roles WHERE profile_id IN ($1, $2)`, [TEST_USER_ID, NOBODY_USER_ID]);
    await query(`DELETE FROM profiles WHERE id IN ($1, $2)`, [TEST_USER_ID, NOBODY_USER_ID]);
    await query(`DELETE FROM auth.users WHERE id IN ($1, $2)`, [TEST_USER_ID, NOBODY_USER_ID]);
    await client.end();
  });

  /* 1. 核心：期初必建批次（自动生成批次号），总库存/流水齐全 */
  it("期初入库 → 总库存+期初批次+流水（带操作人/批次列）", async () => {
    const partId = await 造配件(0);

    const r = await withAuth(TEST_USER_ID, async () => {
      const res = await query(
        `SELECT opening_stock_inbound($1::UUID, 20, 33.5, NULL, NULL, NULL, $2) AS result`,
        [partId, `${PFX}新建期初`]
      );
      return res.rows[0].result as RPC结果;
    });
    expect(r.success, `失败: ${r.error ?? "无"}`).toBe(true);
    expect(r.batch_no).toMatch(/^期初-\d{8}$/);
    expect(Number(r.after_qty)).toBe(20);

    /* 总库存 */
    const p = await query(`SELECT quantity FROM parts WHERE id = $1`, [partId]);
    expect(Number(p.rows[0].quantity)).toBe(20);

    /* 批次：remaining=20、成本 33.5、inbound_type='opening' */
    const b = await query(
      `SELECT remaining, unit_cost, inbound_type FROM part_batches WHERE id = $1`,
      [r.batch_id]
    );
    expect(Number(b.rows[0].remaining)).toBe(20);
    expect(Number(b.rows[0].unit_cost)).toBe(33.5);
    expect(b.rows[0].inbound_type).toBe("opening");

    /* 流水：inbound/opening_stock/操作人/批次列 */
    const log = await query(
      `SELECT type, change_qty, before_qty, after_qty, reference_type, reference_id, operator_id, batch_id, unit_cost
       FROM inventory_logs WHERE part_id = $1`,
      [partId]
    );
    expect(log.rows.length).toBe(1);
    expect(log.rows[0].type).toBe("inbound");
    expect(Number(log.rows[0].change_qty)).toBe(20);
    expect(Number(log.rows[0].before_qty)).toBe(0);
    expect(Number(log.rows[0].after_qty)).toBe(20);
    expect(log.rows[0].reference_type).toBe("opening_stock");
    expect(log.rows[0].reference_id).toBe(r.batch_id);
    expect(log.rows[0].operator_id).toBe(TEST_USER_ID);
    expect(log.rows[0].batch_id).toBe(r.batch_id);

    await 清理(partId);
  });

  /* 2. 带仓位+指定批次号 → 仓位账同步，批次号用指定的 */
  it("带仓位+指定批次号 → 仓位账同步建立，批次号用指定值", async () => {
    const partId = await 造配件(5);

    const r = await withAuth(TEST_USER_ID, async () => {
      const res = await query(
        `SELECT opening_stock_inbound($1::UUID, 10, 20, $2, $3::UUID, 'C-03', NULL) AS result`,
        [partId, `${PFX}批2026A`, warehouseId]
      );
      return res.rows[0].result as RPC结果;
    });
    expect(r.success, `失败: ${r.error ?? "无"}`).toBe(true);
    expect(r.batch_no).toBe(`${PFX}批2026A`);

    const p = await query(`SELECT quantity FROM parts WHERE id = $1`, [partId]);
    expect(Number(p.rows[0].quantity)).toBe(15);
    const loc = await query(
      `SELECT quantity FROM part_stock_locations WHERE part_id = $1 AND warehouse_id = $2 AND COALESCE(location,'') = 'C-03'`,
      [partId, warehouseId]
    );
    expect(loc.rows.length).toBe(1);
    expect(Number(loc.rows[0].quantity)).toBe(10);

    await 清理(partId);
  });

  /* 3. 拦截：数量非法 / 无角色 / 未登录 */
  it("数量≤0 拒绝；无角色拒绝；未登录拒绝", async () => {
    const partId = await 造配件(0);

    const 零 = await withAuth(TEST_USER_ID, async () => {
      const res = await query(`SELECT opening_stock_inbound($1::UUID, 0, NULL, NULL, NULL, NULL, NULL) AS result`, [partId]);
      return res.rows[0].result as RPC结果;
    });
    expect(零.success).toBe(false);

    const 路人 = await withAuth(NOBODY_USER_ID, async () => {
      const res = await query(`SELECT opening_stock_inbound($1::UUID, 5, NULL, NULL, NULL, NULL, NULL) AS result`, [partId]);
      return res.rows[0].result as RPC结果;
    });
    expect(路人.success).toBe(false);
    expect(路人.error).toContain("无权限");

    const 匿名 = await query(`SELECT opening_stock_inbound($1::UUID, 5, NULL, NULL, NULL, NULL, NULL) AS result`, [partId]);
    expect((匿名.rows[0].result as RPC结果).success).toBe(false);

    /* 什么都没动 */
    const p = await query(`SELECT quantity FROM parts WHERE id = $1`, [partId]);
    expect(Number(p.rows[0].quantity)).toBe(0);
    expect((await query(`SELECT COUNT(*)::int AS n FROM part_batches WHERE part_id = $1`, [partId])).rows[0].n).toBe(0);

    await 清理(partId);
  });
});

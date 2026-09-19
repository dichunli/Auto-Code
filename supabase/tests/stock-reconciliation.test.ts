import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

/**
 * ============================================================
 * 数据库集成测试：库存三方对账巡检（report_stock_reconciliation）
 *   （迁移 migrations_20260919_z_stock_reconciliation.sql）
 *
 * 口径：总库存 ≠ 批次合计 或 总库存 ≠ 仓位合计 的配件必须被列出；
 *   三方一致的配件不出现。
 *
 * 运行前提：
 *   1. 本地 Supabase 已启动且所有迁移已应用（含 20260919_z）
 *   2. 环境变量 TEST_DATABASE_URL（默认 postgresql://postgres:postgres@localhost:54322/postgres）
 *
 * 运行：npx vitest run supabase/tests/stock-reconciliation.test.ts
 * ============================================================
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:54322/postgres";

const TEST_USER_ID = "e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5";
const PFX = "TESTRR-";

let client: Client;
let categoryId: string;

interface 对账行 {
  part_id: string;
  part_number: string;
  name: string;
  total_qty: number;
  batch_qty: number;
  location_qty: number;
  batch_diff: number;
  location_diff: number;
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

async function 造配件(后缀: string, opts: { 总: number; 批次: number | null; 仓位: number | null }) {
  const pn = await query(`INSERT INTO part_names (category_id, name) VALUES ($1, $2) RETURNING id`, [categoryId, `${PFX}名${后缀}`]);
  const p = await query(
    `INSERT INTO parts (part_number, part_name_id, name, quantity) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`${PFX}PN${后缀}`, pn.rows[0].id, `${PFX}配件${后缀}`, opts.总]
  );
  const partId = p.rows[0].id as string;
  if (opts.批次 !== null) {
    await query(
      `INSERT INTO part_batches (part_id, batch_no, quantity, remaining, unit_cost) VALUES ($1, $2, $3, $3, 10)`,
      [partId, `${PFX}B${后缀}`, opts.批次]
    );
  }
  if (opts.仓位 !== null) {
    await query(
      `INSERT INTO part_stock_locations (part_id, warehouse_id, location, quantity) VALUES ($1, NULL, 'A-01', $2)`,
      [partId, opts.仓位]
    );
  }
  return partId;
}

async function cleanupAll() {
  await query(`DELETE FROM part_stock_locations WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM part_batches WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM parts WHERE part_number LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM part_names WHERE name LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM part_categories WHERE name LIKE $1`, [`${PFX}%`]);
}

describe("库存三方对账巡检 - 数据库集成测试", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    await cleanupAll();

    await query(
      `INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
       VALUES ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '', now(), now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `${PFX.toLowerCase()}admin@example.com`]
    );
    await query(`INSERT INTO profiles (id, full_name) VALUES ($1, '对账测试员') ON CONFLICT (id) DO NOTHING`, [TEST_USER_ID]);
    const cat = await query(`INSERT INTO part_categories (name) VALUES ($1) RETURNING id`, [`${PFX}分类`]);
    categoryId = cat.rows[0].id;
  });

  afterAll(async () => {
    await cleanupAll();
    await query(`DELETE FROM profiles WHERE id = $1`, [TEST_USER_ID]);
    await query(`DELETE FROM auth.users WHERE id = $1`, [TEST_USER_ID]);
    await client.end();
  });

  it("不一致的配件按差异列出，一致的不出现；未登录拒绝", async () => {
    /* 未登录 */
    const 匿名 = await query(`SELECT report_stock_reconciliation() AS result`);
    expect((匿名.rows[0].result as { success: boolean }).success).toBe(false);

    /* 三个配件：全不一致 / 仅仓位缺 / 三方一致 */
    const idMismatch = await 造配件("M", { 总: 10, 批次: 7, 仓位: 5 });
    await 造配件("L", { 总: 8, 批次: 8, 仓位: null });
    const idOk = await 造配件("OK", { 总: 6, 批次: 6, 仓位: 6 });

    const rows = await withAuth(TEST_USER_ID, async () => {
      const r = await query(`SELECT report_stock_reconciliation() AS result`);
      return r.rows[0].result as 对账行[];
    });

    const byId = new Map(rows.map((x) => [x.part_id, x]));

    /* 全不一致：批次差 3、仓位差 5 */
    const m = byId.get(idMismatch);
    expect(m).toBeTruthy();
    expect(Number(m!.total_qty)).toBe(10);
    expect(Number(m!.batch_qty)).toBe(7);
    expect(Number(m!.location_qty)).toBe(5);
    expect(Number(m!.batch_diff)).toBe(3);
    expect(Number(m!.location_diff)).toBe(5);

    /* 仅仓位缺：批次差 0、仓位差 8（无仓位记录按 0 计） */
    const l = rows.find((x) => x.part_number === `${PFX}PNL`);
    expect(l).toBeTruthy();
    expect(Number(l!.batch_diff)).toBe(0);
    expect(Number(l!.location_diff)).toBe(8);

    /* 一致的不出现 */
    expect(byId.get(idOk)).toBeUndefined();
  });
});

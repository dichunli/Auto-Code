import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

/**
 * ============================================================
 * 数据库集成测试：负库存 CHECK 约束
 *   （迁移 migrations_20260919_t_negative_stock_guard.sql）
 *
 * 三层数量列（parts.quantity / part_batches.remaining+quantity /
 * part_stock_locations.quantity）必须有数据库层兜底：
 * 任何路径（包括绕过 RPC 的直写）把数量改成负值都必须被拒。
 *
 * 运行前提：
 *   1. 本地 Supabase 已启动且所有迁移已应用（含 20260919_t）
 *   2. 环境变量 TEST_DATABASE_URL（默认 postgresql://postgres:postgres@localhost:54322/postgres）
 *
 * 运行：npx vitest run supabase/tests/negative-stock-guard.test.ts
 * ============================================================
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:54322/postgres";

const PFX = "TESTNG-";

let client: Client;
let partId: string;
let batchId: string;

async function query(sql: string, values?: unknown[]) {
  return client.query(sql, values);
}

describe("负库存 CHECK 约束 - 数据库集成测试", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();

    /* 清历史残留 + 造一个配件/批次/仓位 */
    await query(`DELETE FROM part_stock_locations WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
    await query(`DELETE FROM part_batches WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
    await query(`DELETE FROM parts WHERE part_number LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM part_names WHERE name LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM warehouses WHERE name LIKE $1`, [`${PFX}%`]);

    const pn = await query(`INSERT INTO part_names (name) VALUES ($1) RETURNING id`, [`${PFX}配件名`]);
    const p = await query(
      `INSERT INTO parts (part_number, part_name_id, name, quantity) VALUES ($1, $2, $3, 10) RETURNING id`,
      [`${PFX}PN001`, pn.rows[0].id, `${PFX}测试配件`]
    );
    partId = p.rows[0].id;
    const b = await query(
      `INSERT INTO part_batches (part_id, batch_no, quantity, remaining, unit_cost) VALUES ($1, $2, 10, 10, 50) RETURNING id`,
      [partId, `${PFX}B001`]
    );
    batchId = b.rows[0].id;
    const w = await query(`INSERT INTO warehouses (name) VALUES ($1) RETURNING id`, [`${PFX}仓库`]);
    await query(
      `INSERT INTO part_stock_locations (part_id, warehouse_id, location, quantity) VALUES ($1, $2, 'A-01', 10)`,
      [partId, w.rows[0].id]
    );
  });

  afterAll(async () => {
    await query(`DELETE FROM part_stock_locations WHERE part_id = $1`, [partId]);
    await query(`DELETE FROM part_batches WHERE part_id = $1`, [partId]);
    await query(`DELETE FROM parts WHERE id = $1`, [partId]);
    await query(`DELETE FROM part_names WHERE name LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM warehouses WHERE name LIKE $1`, [`${PFX}%`]);
    await client.end();
  });

  it("parts.quantity 改成负数 → 被约束拒绝", async () => {
    await expect(query(`UPDATE parts SET quantity = -1 WHERE id = $1`, [partId])).rejects.toThrow(/parts_quantity_nonnegative/);
    /* 正常扣减不受影响 */
    await expect(query(`UPDATE parts SET quantity = quantity - 3 WHERE id = $1`, [partId])).resolves.toBeDefined();
    const r = await query(`SELECT quantity FROM parts WHERE id = $1`, [partId]);
    expect(Number(r.rows[0].quantity)).toBe(7);
  });

  it("part_batches.remaining 改成负数 → 被约束拒绝", async () => {
    await expect(query(`UPDATE part_batches SET remaining = -1 WHERE id = $1`, [batchId])).rejects.toThrow(/part_batches_remaining_nonnegative/);
  });

  it("part_batches.quantity 改成负数 → 被约束拒绝", async () => {
    await expect(query(`UPDATE part_batches SET quantity = -5 WHERE id = $1`, [batchId])).rejects.toThrow(/part_batches_quantity_nonnegative/);
  });

  it("part_stock_locations.quantity 改成负数 → 被约束拒绝", async () => {
    await expect(
      query(`UPDATE part_stock_locations SET quantity = -2 WHERE part_id = $1`, [partId])
    ).rejects.toThrow(/part_stock_locations_quantity_nonnegative/);
    /* 值没变 */
    const r = await query(`SELECT quantity FROM part_stock_locations WHERE part_id = $1`, [partId]);
    expect(Number(r.rows[0].quantity)).toBe(10);
  });

  it("插入负数新行 → 被约束拒绝；插入 0 合法", async () => {
    await expect(
      query(`INSERT INTO part_batches (part_id, batch_no, quantity, remaining, unit_cost) VALUES ($1, $2, -1, -1, 50)`, [partId, `${PFX}B-NEG`])
    ).rejects.toThrow(/part_batches_.*_nonnegative/);

    const ok = await query(
      `INSERT INTO part_batches (part_id, batch_no, quantity, remaining, unit_cost) VALUES ($1, $2, 0, 0, 50) RETURNING id`,
      [partId, `${PFX}B-ZERO`]
    );
    expect(ok.rows[0].id).toBeTruthy();
    await query(`DELETE FROM part_batches WHERE id = $1`, [ok.rows[0].id]);
  });
});

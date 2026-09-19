import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

/**
 * ============================================================
 * 数据库集成测试：领料/退料/手工入库 的仓位账同步
 *   （2026-09-19 仓位版改造 f/g/k，此前零测试覆盖）
 *
 * 口径固化：
 *   领料带仓位   → 总库存+批次+仓位三方同扣（f）
 *   领料不带仓位 → 只扣总库存/批次，仓位不动（老路径兼容，f 的 IF 分支）
 *   退料回库     → 从哪拿退回哪，仓位同步加回（g）
 *   手工入库带仓位 → 总库存+批次+仓位三方同加（k）
 *   手工入库不带仓位 → 只加总库存（现状固化，阶段二后续会收口）
 *
 * 运行前提：
 *   1. 本地 Supabase 已启动且所有迁移已应用（含 20260919_f/g/k）
 *   2. 环境变量 TEST_DATABASE_URL（默认 postgresql://postgres:postgres@localhost:54322/postgres）
 *
 * 运行：npx vitest run supabase/tests/picking-location.test.ts
 * ============================================================
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:54322/postgres";

const TEST_USER_ID = "efefefef-efef-4fef-8fef-efefefefefef";
const PFX = "TESTPL-";

let client: Client;
let warehouseId: string;

interface Rpc结果 {
  success: boolean;
  error?: string;
  picking_order_id?: string;
  return_order_id?: string;
}

async function query(sql: string, values?: unknown[]) {
  return client.query(sql, values);
}

/* 在事务内注入登录身份后调用（函数返回 JSONB 不中断事务） */
async function withAuth<T>(fn: () => Promise<T>, userId: string = TEST_USER_ID): Promise<T> {
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

/* ═══ 造数（对齐 picking-order.test.ts 的口径） ═══ */

async function createPart(suffix: string, 初始库存: number) {
  const catRes = await query(`INSERT INTO part_categories (name) VALUES ($1) RETURNING id`, [`${PFX}分类${suffix}`]);
  const pnRes = await query(
    `INSERT INTO part_names (category_id, name) VALUES ($1, $2) RETURNING id`,
    [catRes.rows[0].id, `${PFX}配件名${suffix}`]
  );
  const pRes = await query(
    `INSERT INTO parts (part_number, part_name_id, name, quantity, purchase_price)
     VALUES ($1, $2, $3, $4, 10) RETURNING id`,
    [`${PFX}${suffix}`, pnRes.rows[0].id, `测试配件${suffix}`, 初始库存]
  );
  return { partId: pRes.rows[0].id as string, partNumber: `${PFX}${suffix}` };
}

async function createBatch(partId: string, suffix: string, 数量: number) {
  const res = await query(
    `INSERT INTO part_batches (part_id, batch_no, quantity, remaining, unit_cost)
     VALUES ($1, $2, $3, $3, 10) RETURNING id`,
    [partId, `${PFX}PC${suffix}`, 数量]
  );
  return res.rows[0].id as string;
}

async function 造仓位(partId: string, location: string, 数量: number) {
  await query(
    `INSERT INTO part_stock_locations (part_id, warehouse_id, location, quantity) VALUES ($1, $2, $3, $4)`,
    [partId, warehouseId, location, 数量]
  );
}

async function createWorkChain(suffix: string, partId: string, partNumber: string) {
  const custRes = await query(`INSERT INTO customers (name, phone) VALUES ($1, NULL) RETURNING id`, [`${PFX}客户${suffix}`]);
  const customerId = custRes.rows[0].id;
  const vehRes = await query(
    `INSERT INTO vehicles (customer_id, plate_number) VALUES ($1, $2) RETURNING id`,
    [customerId, `${PFX}${suffix}`]
  );
  const woRes = await query(
    `INSERT INTO work_orders (order_no, vehicle_id, customer_id, status)
     VALUES ($1, $2, $3, 'repairing') RETURNING id`,
    [`${PFX}WO-${suffix}`, vehRes.rows[0].id, customerId]
  );
  const workOrderId = woRes.rows[0].id;
  const woiRes = await query(
    `INSERT INTO work_order_items (work_order_id, name, item_type, quantity, unit_price)
     VALUES ($1, '测试项目', 'labor', 1, 100) RETURNING id`,
    [workOrderId]
  );
  const brRes = await query(
    `INSERT INTO work_order_item_parts (work_order_item_id, part_id, name, part_number, quantity, unit_cost, unit_price, customer_opinion, is_purchased)
     VALUES ($1, $2, $3, $4, 5, 10, 15, 'agree', true) RETURNING id`,
    [woiRes.rows[0].id, partId, `测试配件${suffix}`, partNumber]
  );
  return { workOrderId, branchId: brRes.rows[0].id as string };
}

async function 库存(partId: string): Promise<number> {
  const res = await query(`SELECT quantity FROM parts WHERE id = $1`, [partId]);
  return Number(res.rows[0].quantity);
}

async function 批次剩余(batchId: string): Promise<number> {
  const res = await query(`SELECT remaining FROM part_batches WHERE id = $1`, [batchId]);
  return Number(res.rows[0].remaining);
}

async function 仓位数量(partId: string, location: string): Promise<number | null> {
  const res = await query(
    `SELECT quantity FROM part_stock_locations WHERE part_id = $1 AND warehouse_id = $2 AND COALESCE(location,'') = $3`,
    [partId, warehouseId, location]
  );
  return res.rows.length ? Number(res.rows[0].quantity) : null;
}

async function cleanupAll() {
  await query(`DELETE FROM part_return_records WHERE work_order_item_part_id IN (SELECT id FROM work_order_item_parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM picking_order_items WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM part_picking_records WHERE work_order_item_part_id IN (SELECT id FROM work_order_item_parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM picking_orders WHERE work_order_id IN (SELECT id FROM work_orders WHERE order_no LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM work_order_item_parts WHERE part_number LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM work_order_items WHERE work_order_id IN (SELECT id FROM work_orders WHERE order_no LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM inventory_logs WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM part_stock_locations WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM part_batches WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM work_orders WHERE order_no LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM vehicles WHERE plate_number LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM customers WHERE name LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM parts WHERE part_number LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM part_names WHERE name LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM part_categories WHERE name LIKE $1`, [`${PFX}%`]);
}

describe("领料/退料/手工入库 仓位账同步 - 数据库集成测试", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    await cleanupAll();
    await query(`DELETE FROM warehouses WHERE name LIKE $1`, [`${PFX}%`]);

    /* 造仓管用户（所有相关函数的角色门禁都放行仓管） */
    await query(
      `INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
       VALUES ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '', now(), now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `${PFX.toLowerCase()}wh@example.com`]
    );
    await query(`INSERT INTO profiles (id, full_name) VALUES ($1, '仓位测试仓管') ON CONFLICT (id) DO NOTHING`, [TEST_USER_ID]);
    await query(`INSERT INTO roles (name, label) SELECT 'warehouse', '仓管' WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'warehouse')`);
    await query(
      `INSERT INTO profile_roles (profile_id, role_id)
       SELECT $1, id FROM roles WHERE name = 'warehouse'
       ON CONFLICT (profile_id, role_id) DO NOTHING`,
      [TEST_USER_ID]
    );

    const w = await query(`INSERT INTO warehouses (name) VALUES ($1) RETURNING id`, [`${PFX}主仓`]);
    warehouseId = w.rows[0].id;
  });

  afterAll(async () => {
    await cleanupAll();
    await query(`DELETE FROM warehouses WHERE name LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM profile_roles WHERE profile_id = $1`, [TEST_USER_ID]);
    await query(`DELETE FROM profiles WHERE id = $1`, [TEST_USER_ID]);
    await query(`DELETE FROM auth.users WHERE id = $1`, [TEST_USER_ID]);
    await client.end();
  });

  /* 1. 领料带仓位 → 三方同扣 */
  it("领料带仓位 → 总库存/批次/仓位三方同扣", async () => {
    const { partId, partNumber } = await createPart("A", 10);
    const batchId = await createBatch(partId, "A", 10);
    await 造仓位(partId, "A-01", 10);
    const { workOrderId, branchId } = await createWorkChain("A", partId, partNumber);

    const r = await withAuth(async () => {
      const res = await query(
        `SELECT create_picking_order($1::UUID, $2::JSONB, '测试领料人', '测试领料', $3::UUID, NULL) AS result`,
        [
          workOrderId,
          JSON.stringify([{ work_order_item_part_id: branchId, batch_id: batchId, quantity: 4, part_id: partId, part_number: partNumber, name: "测试配件A", warehouse_id: warehouseId, location: "A-01" }]),
          TEST_USER_ID,
        ]
      );
      return res.rows[0].result as Rpc结果;
    });
    expect(r.success, `领料失败: ${r.error ?? "无"}`).toBe(true);

    expect(await 库存(partId)).toBe(6);
    expect(await 批次剩余(batchId)).toBe(6);
    expect(await 仓位数量(partId, "A-01")).toBe(6);
  });

  /* 2. 领料不带仓位 → 只扣总库存/批次，仓位不动（老路径兼容固化） */
  it("领料不带仓位 → 只扣总库存/批次，仓位不动", async () => {
    const { partId, partNumber } = await createPart("B", 10);
    const batchId = await createBatch(partId, "B", 10);
    await 造仓位(partId, "A-01", 10);
    const { workOrderId, branchId } = await createWorkChain("B", partId, partNumber);

    const r = await withAuth(async () => {
      const res = await query(
        `SELECT create_picking_order($1::UUID, $2::JSONB, '测试领料人', '测试领料', $3::UUID, NULL) AS result`,
        [
          workOrderId,
          JSON.stringify([{ work_order_item_part_id: branchId, batch_id: batchId, quantity: 3, part_id: partId, part_number: partNumber, name: "测试配件B" }]),
          TEST_USER_ID,
        ]
      );
      return res.rows[0].result as Rpc结果;
    });
    expect(r.success, `领料失败: ${r.error ?? "无"}`).toBe(true);

    expect(await 库存(partId)).toBe(7);
    expect(await 批次剩余(batchId)).toBe(7);
    /* 仓位不动（老路径跳过仓位扣减——现状固化，提醒后续收口） */
    expect(await 仓位数量(partId, "A-01")).toBe(10);
  });

  /* 3. 退料回库 → 从哪拿退回哪，仓位同步加回 */
  it("带仓位领 4 退 2 → 仓位同步加回到 8", async () => {
    const { partId, partNumber } = await createPart("C", 10);
    const batchId = await createBatch(partId, "C", 10);
    await 造仓位(partId, "A-01", 10);
    const { workOrderId, branchId } = await createWorkChain("C", partId, partNumber);

    const r = await withAuth(async () => {
      const res = await query(
        `SELECT create_picking_order($1::UUID, $2::JSONB, '测试领料人', '测试领料', $3::UUID, NULL) AS result`,
        [
          workOrderId,
          JSON.stringify([{ work_order_item_part_id: branchId, batch_id: batchId, quantity: 4, part_id: partId, part_number: partNumber, name: "测试配件C", warehouse_id: warehouseId, location: "A-01" }]),
          TEST_USER_ID,
        ]
      );
      return res.rows[0].result as Rpc结果;
    });
    expect(r.success, `领料失败: ${r.error ?? "无"}`).toBe(true);
    expect(await 仓位数量(partId, "A-01")).toBe(6);

    /* 领料记录 id（退料要勾） */
    const recRes = await query(
      `SELECT id FROM part_picking_records WHERE picking_order_id = $1 LIMIT 1`,
      [r.picking_order_id]
    );
    const recordId = recRes.rows[0].id;

    const back = await withAuth(async () => {
      const res = await query(
        `SELECT create_material_return_order($1::UUID, $2::UUID, $3::JSONB, 'excess', '测试退料', NULL, $4::UUID) AS result`,
        [
          workOrderId,
          r.picking_order_id,
          JSON.stringify([{ work_order_item_part_id: branchId, picking_record_id: recordId, quantity: 2, part_id: partId, batch_id: batchId, part_number: partNumber, name: "测试配件C", unit_cost: "10" }]),
          TEST_USER_ID,
        ]
      );
      return res.rows[0].result as Rpc结果;
    });
    expect(back.success, `退料失败: ${back.error ?? "无"}`).toBe(true);

    expect(await 库存(partId)).toBe(8);
    expect(await 批次剩余(batchId)).toBe(8);
    expect(await 仓位数量(partId, "A-01")).toBe(8);
  });

  /* 4. 手工入库带仓位+批次号 → 三方同加 */
  it("手工入库带仓位+批次号 → 总库存/批次/仓位三方同加", async () => {
    const { partId } = await createPart("D", 5);
    const batchId = await createBatch(partId, "D", 5);
    await 造仓位(partId, "A-01", 5);

    const r = await withAuth(async () => {
      const res = await query(
        `SELECT manual_part_inbound($1::UUID, 6, 12.5, $2, NULL, $3, $4::UUID, 'A-01') AS result`,
        [partId, `${PFX}PC-D2`, `${PFX}手工入库`, warehouseId]
      );
      return res.rows[0].result as Rpc结果;
    });
    expect(r.success, `入库失败: ${r.error ?? "无"}`).toBe(true);

    expect(await 库存(partId)).toBe(11);
    expect(await 仓位数量(partId, "A-01")).toBe(11);
    /* 新批次（给了批次号 → 建批次行 remaining=6） */
    const b = await query(
      `SELECT remaining FROM part_batches WHERE part_id = $1 AND batch_no = $2`,
      [partId, `${PFX}PC-D2`]
    );
    expect(b.rows.length).toBe(1);
    expect(Number(b.rows[0].remaining)).toBe(6);
    /* 老批次不动 */
    expect(await 批次剩余(batchId)).toBe(5);
  });

  /* 5. 手工入库不带仓位 → 只加总库存（现状固化） */
  it("手工入库不带仓位 → 只加总库存，仓位不动", async () => {
    const { partId } = await createPart("E", 5);
    await createBatch(partId, "E", 5);
    await 造仓位(partId, "A-01", 5);

    const r = await withAuth(async () => {
      const res = await query(
        `SELECT manual_part_inbound($1::UUID, 4, NULL, NULL, NULL, $2, NULL, NULL) AS result`,
        [partId, `${PFX}无仓位入库`]
      );
      return res.rows[0].result as Rpc结果;
    });
    expect(r.success, `入库失败: ${r.error ?? "无"}`).toBe(true);

    expect(await 库存(partId)).toBe(9);
    expect(await 仓位数量(partId, "A-01")).toBe(5); /* 不动 */
  });
});

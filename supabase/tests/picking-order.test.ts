import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

/**
 * ============================================================
 * 数据库集成测试：领料出库 / 退料（create_picking_order /
 * confirm_picking_order / create_material_return_order +
 * 触发器 fn_deduct_batch_on_picking / fn_restore_batch_on_return）
 *
 * 背景（2026-09-15 全面诊断紧急项）：入库有并发回归测试、出库一条都没有，
 * 库存扣减主路径裸奔，事故风险不对称。本文件补上对称保护。
 *
 * 覆盖：
 *   1. 正常领料 → 批次/总库存/流水/快照/单状态全对
 *   2. 超领 → 整单回滚（库存不动、无单无记录）
 *   3. 并发 4+4 → 不丢更新（回归"读-改-写丢库存"同类风险）
 *   4. 并发 7+7 → 不超卖（一胜一负，批次不为负）
 *   5. 扫码管控：不扫码拒绝 / 错码拒绝 / 对码放行
 *   6. 确认管控：draft 不扣库存 → confirm 补扣 → 重复 confirm 拒绝
 *   7. 明细为空 → 拒绝
 *   8. confirm 权限拒绝路径：未登录 / 无角色
 *   9. 正常退料 → 库存加回、流水 return_in
 *  10. 退料超净领 → 拒绝
 *  11. draft 单退料 → 拒绝（防凭空加库存）
 *
 * 运行前提：本地 Supabase 已启动且所有迁移已应用；环境变量 TEST_DATABASE_URL
 * 运行：npm run test:db
 * ============================================================
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:54322/postgres";

/* 仓管身份（confirm_picking_order 要求 admin/boss/warehouse 角色） */
const TEST_USER_ID = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa";
/* 无角色身份（权限拒绝路径专用） */
const TEST_USER2_ID = "aaaaaaaa-2222-4aaa-8aaa-aaaaaaaaaaaa";
/* 测试数据统一前缀，便于兜底清理 */
const PFX = "TESTPK-";

let client: Client;

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

interface Rpc结果 {
  success: boolean;
  error?: string;
  picking_order_id?: string;
  picking_no?: string;
  status?: string;
  return_order_id?: string;
}

/* ═══ RPC 调用封装 ═══ */

async function 调领料(
  items: Record<string, unknown>[],
  opts: { workOrderId?: string; scanCodes?: Record<string, string>; operatorId?: string } = {},
  targetClient?: Client
): Promise<Rpc结果> {
  const c = targetClient || client;
  const res = await c.query(
    `SELECT create_picking_order($1::UUID, $2::JSONB, '测试领料人', '测试领料', $3::UUID, $4::JSONB) as result`,
    [opts.workOrderId ?? null, JSON.stringify(items), opts.operatorId ?? TEST_USER_ID, opts.scanCodes ? JSON.stringify(opts.scanCodes) : null]
  );
  return res.rows[0].result as Rpc结果;
}

async function 调确认出库(pickingOrderId: string, targetClient?: Client): Promise<Rpc结果> {
  const c = targetClient || client;
  const res = await c.query(
    `SELECT confirm_picking_order($1::UUID, $2::UUID) as result`,
    [pickingOrderId, TEST_USER_ID]
  );
  return res.rows[0].result as Rpc结果;
}

async function 调退料(
  pickingOrderId: string,
  items: Record<string, unknown>[],
  opts: { workOrderId?: string } = {}
): Promise<Rpc结果> {
  const res = await client.query(
    `SELECT create_material_return_order($1::UUID, $2::UUID, $3::JSONB, 'good', '测试退料', NULL, $4::UUID) as result`,
    [opts.workOrderId ?? null, pickingOrderId, JSON.stringify(items), TEST_USER_ID]
  );
  return res.rows[0].result as Rpc结果;
}

/* ═══ 造数 ═══ */

/* 造配件（含分类/名称；part_names.category_id 为 NOT NULL FK） */
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

/* 造批次（库存口径：parts.quantity = 批次 remaining 之和） */
async function createBatch(partId: string, suffix: string, 数量: number) {
  const res = await query(
    `INSERT INTO part_batches (part_id, batch_no, quantity, remaining, unit_cost)
     VALUES ($1, $2, $3, $3, 10) RETURNING id`,
    [partId, `${PFX}PC${suffix}`, 数量]
  );
  return res.rows[0].id as string;
}

/* 造工单链路：客户 → 车 → 工单 → 项目 → 配件分支（客户已同意） */
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

/* 按前缀兜底清理全部测试数据（反序删，绕过 FK） */
async function cleanupAll() {
  await query(`DELETE FROM inventory_logs WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM part_return_records WHERE work_order_item_part_id IN (SELECT id FROM work_order_item_parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM material_return_order_items WHERE return_order_id IN (SELECT id FROM material_return_orders WHERE work_order_id IN (SELECT id FROM work_orders WHERE order_no LIKE $1))`, [`${PFX}%`]);
  await query(`DELETE FROM material_return_orders WHERE work_order_id IN (SELECT id FROM work_orders WHERE order_no LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM part_picking_records WHERE work_order_item_part_id IN (SELECT id FROM work_order_item_parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM picking_order_items WHERE picking_order_id IN (SELECT id FROM picking_orders WHERE work_order_id IN (SELECT id FROM work_orders WHERE order_no LIKE $1))`, [`${PFX}%`]);
  await query(`DELETE FROM picking_orders WHERE work_order_id IN (SELECT id FROM work_orders WHERE order_no LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM work_order_item_parts WHERE part_number LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM work_order_items WHERE work_order_id IN (SELECT id FROM work_orders WHERE order_no LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM work_orders WHERE order_no LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM part_batches WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM parts WHERE part_number LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM part_names WHERE name LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM part_categories WHERE name LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM vehicles WHERE plate_number LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM customers WHERE name LIKE $1`, [`${PFX}%`]);
}

async function 库存(partId: string): Promise<number> {
  const res = await query(`SELECT quantity FROM parts WHERE id = $1`, [partId]);
  return res.rows[0].quantity as number;
}

async function 批次剩余(batchId: string): Promise<number> {
  const res = await query(`SELECT remaining FROM part_batches WHERE id = $1`, [batchId]);
  return res.rows[0].remaining as number;
}

/* 领料记录 id（退料要引用） */
async function 领料记录id(pickingOrderId: string): Promise<string> {
  const res = await query(`SELECT id FROM part_picking_records WHERE picking_order_id = $1`, [pickingOrderId]);
  return res.rows[0].id as string;
}

describe("领料出库/退料 - 数据库集成测试", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    await cleanupAll();

    /* 造测试用户（仓管角色：confirm_picking_order 要求 admin/boss/warehouse） */
    await query(
      `INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
       VALUES ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '', now(), now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `${PFX.toLowerCase()}warehouse@example.com`]
    );
    await query(
      `INSERT INTO profiles (id, full_name) VALUES ($1, '领料测试仓管') ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID]
    );
    await query(
      `INSERT INTO roles (name, label) SELECT 'warehouse', '仓管' WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'warehouse')`
    );
    await query(
      `INSERT INTO profile_roles (profile_id, role_id)
       SELECT $1, id FROM roles WHERE name = 'warehouse' ON CONFLICT DO NOTHING`,
      [TEST_USER_ID]
    );

    /* 无角色用户（权限拒绝路径专用，不给任何角色行） */
    await query(
      `INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
       VALUES ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '', now(), now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER2_ID, `${PFX.toLowerCase()}norole@example.com`]
    );
    await query(
      `INSERT INTO profiles (id, full_name) VALUES ($1, '无角色测试员') ON CONFLICT (id) DO NOTHING`,
      [TEST_USER2_ID]
    );
  });

  afterAll(async () => {
    await cleanupAll();
    await query(`DELETE FROM profile_roles WHERE profile_id IN ($1, $2)`, [TEST_USER_ID, TEST_USER2_ID]);
    await query(`DELETE FROM profiles WHERE id IN ($1, $2)`, [TEST_USER_ID, TEST_USER2_ID]);
    await query(`DELETE FROM auth.users WHERE id IN ($1, $2)`, [TEST_USER_ID, TEST_USER2_ID]);
    await client.end();
  });

  it("正常领料 → 批次/总库存/流水/快照/单状态全对", async () => {
    const { partId, partNumber } = await createPart("A", 10);
    const batchId = await createBatch(partId, "A", 10);
    const { workOrderId, branchId } = await createWorkChain("A", partId, partNumber);

    const r = await withAuth(() =>
      调领料(
        [{ work_order_item_part_id: branchId, batch_id: batchId, quantity: 4, part_id: partId, part_number: partNumber, name: "测试配件A", unit_cost: "10" }],
        { workOrderId }
      )
    );

    expect(r.success, `失败原因: ${r.error ?? "无"}`).toBe(true);
    expect(r.status).toBe("confirmed");
    expect(r.picking_no).toBeTruthy();
    expect(await 库存(partId)).toBe(6);
    expect(await 批次剩余(batchId)).toBe(6);

    /* 流水：outbound、前后数量 */
    const logRes = await query(
      `SELECT type, change_qty, before_qty, after_qty, reference_type FROM inventory_logs WHERE part_id = $1`,
      [partId]
    );
    expect(logRes.rows).toHaveLength(1);
    expect(logRes.rows[0].type).toBe("outbound");
    expect(logRes.rows[0].change_qty).toBe(-4);
    expect(logRes.rows[0].before_qty).toBe(10);
    expect(logRes.rows[0].after_qty).toBe(6);

    /* 快照行 + 主表合计 */
    const itemRes = await query(
      `SELECT quantity, part_number FROM picking_order_items WHERE picking_order_id = $1`,
      [r.picking_order_id]
    );
    expect(itemRes.rows).toHaveLength(1);
    expect(itemRes.rows[0].quantity).toBe(4);
    const orderRes = await query(
      `SELECT total_quantity, status FROM picking_orders WHERE id = $1`,
      [r.picking_order_id]
    );
    expect(orderRes.rows[0].total_quantity).toBe(4);
    expect(orderRes.rows[0].status).toBe("confirmed");

    await cleanupAll();
  });

  it("超领（领 20 > 批次 10）→ 整单回滚：库存不动、无单无记录", async () => {
    const { partId, partNumber } = await createPart("B", 10);
    const batchId = await createBatch(partId, "B", 10);
    const { workOrderId, branchId } = await createWorkChain("B", partId, partNumber);

    const r = await withAuth(() =>
      调领料(
        [{ work_order_item_part_id: branchId, batch_id: batchId, quantity: 20, part_id: partId, part_number: partNumber, name: "测试配件B" }],
        { workOrderId }
      )
    );

    expect(r.success).toBe(false);
    expect(r.error).toContain("批次剩余库存不足");
    expect(await 库存(partId)).toBe(10);
    expect(await 批次剩余(batchId)).toBe(10);
    /* 整单回滚：主表/记录/流水都不留痕 */
    const orderRes = await query(
      `SELECT COUNT(*) c FROM picking_orders WHERE work_order_id = $1`,
      [workOrderId]
    );
    expect(orderRes.rows[0].c).toBe("0");
    const recRes = await query(
      `SELECT COUNT(*) c FROM part_picking_records WHERE work_order_item_part_id = $1`,
      [branchId]
    );
    expect(recRes.rows[0].c).toBe("0");

    await cleanupAll();
  });

  it("并发 4+4 领同一批次 → 不丢更新：库存 = 10 - 8 = 2", async () => {
    const { partId, partNumber } = await createPart("C", 10);
    const batchId = await createBatch(partId, "C", 10);
    const { workOrderId, branchId } = await createWorkChain("C", partId, partNumber);

    const client2 = new Client({ connectionString: DATABASE_URL });
    await client2.connect();
    const items = [{ work_order_item_part_id: branchId, batch_id: batchId, quantity: 4, part_id: partId, part_number: partNumber, name: "测试配件C" }];

    await client.query("BEGIN");
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: TEST_USER_ID })]);
    const p1 = 调领料(items, { workOrderId })
      .then(async (r) => { await client.query("COMMIT"); return r; })
      .catch(async (e) => { await client.query("ROLLBACK"); throw e; });

    await client2.query("BEGIN");
    await client2.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: TEST_USER_ID })]);
    /* 必须传 client2：pg 单连接的 query 是排队的，不传会排在 client 的 COMMIT 之后 */
    const p2 = 调领料(items, { workOrderId }, client2)
      .then(async (r) => { await client2.query("COMMIT"); return r; })
      .catch(async (e) => { await client2.query("ROLLBACK"); throw e; });

    const [r1, r2] = await Promise.all([p1, p2]);
    await client2.end();

    expect(r1.success, `r1 失败: ${r1.error ?? "无"}; r2=${JSON.stringify(r2)}`).toBe(true);
    expect(r2.success, `r2 失败: ${r2.error ?? "无"}; r1=${JSON.stringify(r1)}`).toBe(true);
    /* 核心断言：两笔都不能丢 */
    expect(await 库存(partId)).toBe(2);
    expect(await 批次剩余(batchId)).toBe(2);

    /* 两条流水，排队执行各算各的（after_qty 为 6 和 2） */
    const logRes = await query(
      `SELECT before_qty, change_qty, after_qty FROM inventory_logs WHERE part_id = $1 ORDER BY after_qty DESC`,
      [partId]
    );
    expect(logRes.rows).toHaveLength(2);
    expect(logRes.rows.map((row) => row.after_qty)).toEqual([6, 2]);
    expect(logRes.rows.every((row) => row.before_qty + row.change_qty === row.after_qty)).toBe(true);

    await cleanupAll();
  });

  it("并发 7+7 抢 10 件 → 不超卖：一胜一负，批次不为负", async () => {
    const { partId, partNumber } = await createPart("D", 10);
    const batchId = await createBatch(partId, "D", 10);
    const { workOrderId, branchId } = await createWorkChain("D", partId, partNumber);

    const client2 = new Client({ connectionString: DATABASE_URL });
    await client2.connect();
    const items = [{ work_order_item_part_id: branchId, batch_id: batchId, quantity: 7, part_id: partId, part_number: partNumber, name: "测试配件D" }];

    await client.query("BEGIN");
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: TEST_USER_ID })]);
    const p1 = 调领料(items, { workOrderId })
      .then(async (r) => { await client.query("COMMIT"); return r; })
      .catch(async (e) => { await client.query("ROLLBACK"); throw e; });

    await client2.query("BEGIN");
    await client2.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: TEST_USER_ID })]);
    const p2 = 调领料(items, { workOrderId }, client2)
      .then(async (r) => { await client2.query("COMMIT"); return r; })
      .catch(async (e) => { await client2.query("ROLLBACK"); throw e; });

    const [r1, r2] = await Promise.all([p1, p2]);
    await client2.end();

    /* 恰好一胜一负：负者报"批次剩余库存不足"，绝不允许两单都成功（否则 remaining 变负） */
    const 成功数 = [r1, r2].filter((r) => r.success).length;
    expect(成功数, `r1=${JSON.stringify(r1)}; r2=${JSON.stringify(r2)}`).toBe(1);
    const 败者 = [r1, r2].find((r) => !r.success);
    expect(败者?.error).toContain("批次剩余库存不足");
    expect(await 库存(partId)).toBe(3);
    expect(await 批次剩余(batchId)).toBe(3);

    await cleanupAll();
  });

  it("扫码管控：不扫码拒绝 / 错码拒绝 / 对码（编码）放行", async () => {
    const { partId, partNumber } = await createPart("E", 10);
    await query(`UPDATE parts SET require_scan_check = true WHERE id = $1`, [partId]);
    const batchId = await createBatch(partId, "E", 10);
    const { workOrderId, branchId } = await createWorkChain("E", partId, partNumber);
    const items = [{ work_order_item_part_id: branchId, batch_id: batchId, quantity: 2, part_id: partId, part_number: partNumber, name: "测试配件E" }];

    /* ① 不扫码 → 拒绝 */
    const r1 = await withAuth(() => 调领料(items, { workOrderId }));
    expect(r1.success).toBe(false);
    expect(r1.error).toContain("要求扫码出库");

    /* ② 扫错码 → 拒绝 */
    const r2 = await withAuth(() => 调领料(items, { workOrderId, scanCodes: { [partId]: "WRONG-CODE" } }));
    expect(r2.success).toBe(false);
    expect(r2.error).toContain("扫码核对失败");

    /* 两次拒绝后库存分毫不动 */
    expect(await 库存(partId)).toBe(10);
    expect(await 批次剩余(batchId)).toBe(10);

    /* ③ 扫对码（编码 part_number 属三值之一）→ 放行 */
    const r3 = await withAuth(() => 调领料(items, { workOrderId, scanCodes: { [partId]: partNumber } }));
    expect(r3.success, `失败原因: ${r3.error ?? "无"}`).toBe(true);
    expect(await 库存(partId)).toBe(8);

    await cleanupAll();
  });

  it("确认管控：draft 占位不扣库存 → confirm 补扣 → 重复 confirm 拒绝", async () => {
    const { partId, partNumber } = await createPart("F", 10);
    await query(`UPDATE parts SET require_confirm = true WHERE id = $1`, [partId]);
    const batchId = await createBatch(partId, "F", 10);
    const { workOrderId, branchId } = await createWorkChain("F", partId, partNumber);

    /* 含需确认配件 → 整单 draft，库存不动 */
    const r = await withAuth(() =>
      调领料(
        [{ work_order_item_part_id: branchId, batch_id: batchId, quantity: 3, part_id: partId, part_number: partNumber, name: "测试配件F" }],
        { workOrderId }
      )
    );
    expect(r.success, `失败原因: ${r.error ?? "无"}`).toBe(true);
    expect(r.status).toBe("draft");
    expect(await 库存(partId)).toBe(10);
    expect(await 批次剩余(batchId)).toBe(10);

    /* 库管确认出库 → 补扣库存，单转 confirmed */
    const c = await withAuth(() => 调确认出库(r.picking_order_id!));
    expect(c.success, `确认失败: ${c.error ?? "无"}`).toBe(true);
    expect(await 库存(partId)).toBe(7);
    expect(await 批次剩余(batchId)).toBe(7);
    const orderRes = await query(`SELECT status FROM picking_orders WHERE id = $1`, [r.picking_order_id]);
    expect(orderRes.rows[0].status).toBe("confirmed");

    /* 重复确认 → 拒绝（防二次扣库存） */
    const c2 = await withAuth(() => 调确认出库(r.picking_order_id!));
    expect(c2.success).toBe(false);
    expect(c2.error).toContain("已确认出库或已作废");
    expect(await 库存(partId)).toBe(7);

    await cleanupAll();
  });

  it("领料明细为空 → 拒绝", async () => {
    const r = await withAuth(() => 调领料([]));
    expect(r.success).toBe(false);
    expect(r.error).toContain("领料明细不能为空");
  });

  it("confirm 权限拒绝路径：未登录拒绝、登录无角色拒绝", async () => {
    const { partId, partNumber } = await createPart("G", 10);
    await query(`UPDATE parts SET require_confirm = true WHERE id = $1`, [partId]);
    const batchId = await createBatch(partId, "G", 10);
    const { workOrderId, branchId } = await createWorkChain("G", partId, partNumber);
    const r = await withAuth(() =>
      调领料(
        [{ work_order_item_part_id: branchId, batch_id: batchId, quantity: 2, part_id: partId, part_number: partNumber, name: "测试配件G" }],
        { workOrderId }
      )
    );
    expect(r.status).toBe("draft");

    /* ① 未登录（不注入 claims，auth.uid() 为 NULL）→ 拒绝 */
    const c1 = await 调确认出库(r.picking_order_id!);
    expect(c1.success).toBe(false);
    expect(c1.error).toContain("未登录");

    /* ② 登录但无角色（TEST_USER2 没有任何 profile_roles 行）→ 拒绝 */
    const c2 = await withAuth(() => 调确认出库(r.picking_order_id!), TEST_USER2_ID);
    expect(c2.success).toBe(false);
    expect(c2.error).toContain("无权限");

    /* 两道拦截后：单仍 draft、库存仍 10 */
    const orderRes = await query(`SELECT status FROM picking_orders WHERE id = $1`, [r.picking_order_id]);
    expect(orderRes.rows[0].status).toBe("draft");
    expect(await 库存(partId)).toBe(10);

    await cleanupAll();
  });

  it("正常退料 → 批次/总库存加回、流水 return_in", async () => {
    const { partId, partNumber } = await createPart("H", 10);
    const batchId = await createBatch(partId, "H", 10);
    const { workOrderId, branchId } = await createWorkChain("H", partId, partNumber);

    /* 先领 6（批次 10→4），再退 2（批次 4→6） */
    const r = await withAuth(() =>
      调领料(
        [{ work_order_item_part_id: branchId, batch_id: batchId, quantity: 6, part_id: partId, part_number: partNumber, name: "测试配件H" }],
        { workOrderId }
      )
    );
    expect(r.success).toBe(true);
    const recordId = await 领料记录id(r.picking_order_id!);

    const back = await withAuth(() =>
      调退料(
        r.picking_order_id!,
        [{ work_order_item_part_id: branchId, picking_record_id: recordId, quantity: 2, part_id: partId, batch_id: batchId, part_number: partNumber, name: "测试配件H", unit_cost: "10" }],
        { workOrderId }
      )
    );
    expect(back.success, `退料失败: ${back.error ?? "无"}`).toBe(true);
    expect(await 库存(partId)).toBe(6);
    expect(await 批次剩余(batchId)).toBe(6);

    /* 流水：outbound -6 后又 return_in +2，前后数量衔接 */
    const logRes = await query(
      `SELECT type, change_qty, before_qty, after_qty FROM inventory_logs WHERE part_id = $1 ORDER BY after_qty, type`,
      [partId]
    );
    expect(logRes.rows).toHaveLength(2);
    const ret = logRes.rows.find((row) => row.type === "return_in");
    expect(ret).toBeTruthy();
    expect(ret!.change_qty).toBe(2);
    expect(ret!.before_qty).toBe(4);
    expect(ret!.after_qty).toBe(6);

    await cleanupAll();
  });

  it("退料超净领 → 拒绝，库存不变", async () => {
    const { partId, partNumber } = await createPart("I", 10);
    const batchId = await createBatch(partId, "I", 10);
    const { workOrderId, branchId } = await createWorkChain("I", partId, partNumber);

    const r = await withAuth(() =>
      调领料(
        [{ work_order_item_part_id: branchId, batch_id: batchId, quantity: 3, part_id: partId, part_number: partNumber, name: "测试配件I" }],
        { workOrderId }
      )
    );
    expect(r.success).toBe(true);
    const recordId = await 领料记录id(r.picking_order_id!);

    /* 领了 3 件要退 4 件 → 触发器拦截 */
    const back = await withAuth(() =>
      调退料(
        r.picking_order_id!,
        [{ work_order_item_part_id: branchId, picking_record_id: recordId, quantity: 4, part_id: partId, batch_id: batchId, part_number: partNumber, name: "测试配件I" }],
        { workOrderId }
      )
    );
    expect(back.success).toBe(false);
    expect(back.error).toContain("退料数量超出可退数量");
    expect(await 库存(partId)).toBe(7);
    expect(await 批次剩余(batchId)).toBe(7);

    await cleanupAll();
  });

  it("draft（待确认）单退料 → 拒绝：库存从未扣过，退了会凭空加库存", async () => {
    const { partId, partNumber } = await createPart("J", 10);
    await query(`UPDATE parts SET require_confirm = true WHERE id = $1`, [partId]);
    const batchId = await createBatch(partId, "J", 10);
    const { workOrderId, branchId } = await createWorkChain("J", partId, partNumber);

    const r = await withAuth(() =>
      调领料(
        [{ work_order_item_part_id: branchId, batch_id: batchId, quantity: 5, part_id: partId, part_number: partNumber, name: "测试配件J" }],
        { workOrderId }
      )
    );
    expect(r.status).toBe("draft");
    const recordId = await 领料记录id(r.picking_order_id!);

    const back = await withAuth(() =>
      调退料(
        r.picking_order_id!,
        [{ work_order_item_part_id: branchId, picking_record_id: recordId, quantity: 5, part_id: partId, batch_id: batchId, part_number: partNumber, name: "测试配件J" }],
        { workOrderId }
      )
    );
    expect(back.success).toBe(false);
    expect(back.error).toContain("待确认");
    /* 库存从头到尾必须是 10：draft 没扣、退料被拦 */
    expect(await 库存(partId)).toBe(10);
    expect(await 批次剩余(batchId)).toBe(10);

    await cleanupAll();
  });
});

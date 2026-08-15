import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

/**
 * ============================================================
 * 数据库集成测试：revoke_completed_inbound / revoke_supplier_returns
 * （2026-08-16 批次1 错账风险收口）
 *
 * 覆盖：
 *   1. 混合入库（正常+破损换货）回滚 → 库存精确还原（退库回补对称性）
 *   2. is_arrived 回退 + 其他已入库单关联时的防护保留
 *   3. 已生成采退单（completed 退货记录）→ 拒绝回滚且数据无变化
 *   4. 库存被消耗后不足扣回 → 报错、无钳制、整单无变化
 *   5. 未登录 → 拒绝
 *   6. 已登录但无采购角色 → 拒绝
 *   7. 重复回滚（已回 submitted）→ 拒绝
 *   8. revoke_supplier_returns 已入库分支回归（回补+标记回退+记录删除）
 *
 * 运行前提：
 *   1. 本地 Supabase 已启动且所有迁移已应用（含 20260816_revoke_inbound_rollback）
 *   2. 环境变量 TEST_DATABASE_URL（默认 postgresql://postgres:postgres@localhost:54322/postgres）
 *
 * 运行：npx vitest run supabase/tests/revoke-completed-inbound.test.ts
 *
 * 认证模拟：函数内 auth.uid() 读 request.jwt.claims 的 sub；
 * 测试在事务内用 set_config(..., true) 注入，COMMIT 后自动失效。
 * ============================================================
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:54322/postgres";

/* 固定测试用户 id（造数专用，避免与真实数据混淆） */
const TEST_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
/* 测试数据统一前缀，便于兜底清理 */
const PFX = "TESTRB-";

let client: Client;
let adminRoleId: string;

interface 链路句柄 {
  customerId: string;
  vehicleId: string;
  workOrderId: string;
  workOrderItemId: string;
  supplierId: string;
  partIds: string[];
  partNameIds: string[];
  branchIds: string[];
  purchaseOrderId: string;
  purchaseItemIds: string[];
}

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

async function callCompleteInbound(orderId: string, items: unknown[], freight = 0) {
  const res = await client.query(
    `SELECT complete_purchase_inbound($1::UUID, $2::JSONB, $3::DECIMAL, $4::UUID) as result`,
    [orderId, JSON.stringify(items), freight, TEST_USER_ID]
  );
  return res.rows[0].result as { success: boolean; error?: string; inbound_order_id?: string };
}

async function callRevokeCompleted(orderId: string) {
  const res = await client.query(
    `SELECT revoke_completed_inbound($1::UUID, $2::UUID) as result`,
    [orderId, TEST_USER_ID]
  );
  return res.rows[0].result as { success: boolean; error?: string };
}

async function callRevokeReturns(recordIds: string[]) {
  const res = await client.query(
    `SELECT revoke_supplier_returns($1::UUID[], $2::UUID) as result`,
    [JSON.stringify(recordIds).replace(/^\[/, "{").replace(/\]$/, "}"), TEST_USER_ID]
  );
  return res.rows[0].result as { success: boolean; error?: string };
}

/* 造一个配件（含 part_names） */
async function createPart(suffix: string, 初始库存: number, 采购价 = 10) {
  const pnRes = await query(
    `INSERT INTO part_names (name) VALUES ($1) RETURNING id`,
    [`${PFX}配件名${suffix}`]
  );
  const partNameId = pnRes.rows[0].id;
  const pRes = await query(
    `INSERT INTO parts (part_number, part_name_id, name, quantity, purchase_price)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [`${PFX}${suffix}-${Date.now() % 100000}`, partNameId, `测试配件${suffix}`, 初始库存, 采购价]
  );
  return { partId: pRes.rows[0].id as string, partNameId: partNameId as string };
}

/**
 * 造完整链路：客户/车/工单/项目 + 供应商 + 采购单(pending_storage) +
 * 两条明细（配件行关联），返回全部句柄。
 * items: [{ 后缀, 初始库存, 采购数, handle_action }]
 */
async function createPurchaseChain(
  items: Array<{ 后缀: string; 初始库存: number; 采购数: number; handle_action: string; 实收?: number }>
): Promise<链路句柄> {
  const custRes = await query(
    `INSERT INTO customers (name, phone) VALUES ($1, NULL) RETURNING id`,
    [`${PFX}客户`]
  );
  const customerId = custRes.rows[0].id;
  const vehRes = await query(
    `INSERT INTO vehicles (customer_id, plate_number) VALUES ($1, $2) RETURNING id`,
    [customerId, `${PFX}${Date.now() % 100000}`]
  );
  const vehicleId = vehRes.rows[0].id;
  const woRes = await query(
    `INSERT INTO work_orders (order_no, vehicle_id, customer_id, status)
     VALUES ($1, $2, $3, 'repairing') RETURNING id`,
    [`${PFX}WO-${Date.now() % 100000}`, vehicleId, customerId]
  );
  const workOrderId = woRes.rows[0].id;
  const woiRes = await query(
    `INSERT INTO work_order_items (work_order_id, name, item_type, quantity, unit_price)
     VALUES ($1, '测试项目', 'labor', 1, 100) RETURNING id`,
    [workOrderId]
  );
  const workOrderItemId = woiRes.rows[0].id;

  const supRes = await query(
    `INSERT INTO suppliers (name) VALUES ($1) RETURNING id`,
    [`${PFX}供应商`]
  );
  const supplierId = supRes.rows[0].id;

  const poRes = await query(
    `INSERT INTO purchase_orders (supplier_id, status, total_amount)
     VALUES ($1, 'pending_storage', 0) RETURNING id`,
    [supplierId]
  );
  const purchaseOrderId = poRes.rows[0].id;

  const partIds: string[] = [];
  const partNameIds: string[] = [];
  const branchIds: string[] = [];
  const purchaseItemIds: string[] = [];

  for (const it of items) {
    const { partId, partNameId } = await createPart(it.后缀, it.初始库存);
    partIds.push(partId);
    partNameIds.push(partNameId);

    const brRes = await query(
      `INSERT INTO work_order_item_parts (work_order_item_id, part_id, name, part_number, quantity, unit_cost, unit_price, customer_opinion, is_purchased)
       VALUES ($1, $2, $3, $4, $5, 10, 15, 'agree', true) RETURNING id`,
      [workOrderItemId, partId, `测试配件${it.后缀}`, `${PFX}PN${it.后缀}`, it.采购数]
    );
    const branchId = brRes.rows[0].id;
    branchIds.push(branchId);

    const poiRes = await query(
      `INSERT INTO purchase_order_items (order_id, part_id, name, part_number, quantity, unit_cost, received_qty, handle_action, work_order_item_part_id)
       VALUES ($1, $2, $3, $4, $5, 10, $6, $7, $8) RETURNING id`,
      [purchaseOrderId, partId, `测试配件${it.后缀}`, `${PFX}PN${it.后缀}`, it.采购数, it.实收 ?? it.采购数, it.handle_action, branchId]
    );
    purchaseItemIds.push(poiRes.rows[0].id);
  }

  return { customerId, vehicleId, workOrderId, workOrderItemId, supplierId, partIds, partNameIds, branchIds, purchaseOrderId, purchaseItemIds };
}

/* 按前缀兜底清理全部测试数据（反序删，绕过 FK） */
async function cleanupAll() {
  await query(`DELETE FROM supplier_return_records WHERE work_order_item_part_id IN (SELECT id FROM work_order_item_parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM supplier_transactions WHERE reference_type = 'inbound_order' AND reference_id IN (SELECT id FROM inbound_orders WHERE supplier_name LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM inventory_logs WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM inbound_order_items WHERE part_number LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM inbound_orders WHERE supplier_name LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM part_batches WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM part_stock_locations WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM purchase_order_items WHERE part_number LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM purchase_orders WHERE id IN (SELECT order_id FROM purchase_order_items WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM purchase_orders WHERE order_no LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM work_order_item_parts WHERE part_number LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM work_order_items WHERE work_order_id IN (SELECT id FROM work_orders WHERE order_no LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM work_orders WHERE order_no LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM vehicles WHERE plate_number LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM customers WHERE name LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM parts WHERE part_number LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM part_names WHERE name LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM suppliers WHERE name LIKE $1`, [`${PFX}%`]);
}

async function 库存(partId: string): Promise<number> {
  const res = await query(`SELECT quantity FROM parts WHERE id = $1`, [partId]);
  return res.rows[0].quantity as number;
}

async function 到货标记(branchId: string): Promise<boolean> {
  const res = await query(`SELECT is_arrived FROM work_order_item_parts WHERE id = $1`, [branchId]);
  return res.rows[0].is_arrived as boolean;
}

describe("revoke_completed_inbound / revoke_supplier_returns - 数据库集成测试", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();

    /* 兜底清理上次可能残留的测试数据 */
    await cleanupAll();

    /* 造测试用户：auth.users → profiles → profile_roles(admin) */
    await query(
      `INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
       VALUES ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '', now(), now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `${PFX.toLowerCase()}test@example.com`]
    );
    await query(
      `INSERT INTO profiles (id, full_name) VALUES ($1, '回滚测试员') ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID]
    );
    await query(`INSERT INTO roles (name, label) VALUES ('admin', '管理员') ON CONFLICT (name) DO NOTHING`);
    const roleRes = await query(`SELECT id FROM roles WHERE name = 'admin'`);
    adminRoleId = roleRes.rows[0].id;
    await query(
      `INSERT INTO profile_roles (profile_id, role_id) VALUES ($1, $2) ON CONFLICT (profile_id, role_id) DO NOTHING`,
      [TEST_USER_ID, adminRoleId]
    );
  });

  afterAll(async () => {
    await cleanupAll();
    await query(`DELETE FROM profile_roles WHERE profile_id = $1`, [TEST_USER_ID]);
    await query(`DELETE FROM profiles WHERE id = $1`, [TEST_USER_ID]);
    await query(`DELETE FROM auth.users WHERE id = $1`, [TEST_USER_ID]);
    await client.end();
  });

  /* ============================================================
     1. 核心断言：混合入库回滚 → 库存精确还原（破损行净效果 0）
     ============================================================ */
  it("正常+破损换货混合入库 → 回滚后两配件库存精确还原", async () => {
    const h = await createPurchaseChain([
      { 后缀: "A", 初始库存: 10, 采购数: 5, handle_action: "normal" },
      { 后缀: "B", 初始库存: 20, 采购数: 3, handle_action: "broken_exchange" },
    ]);
    const [partA, partB] = h.partIds;

    /* 入库：A +5；B +3(第4步) -3(第6步退库) = 净 0 */
    const inb = await withAuth(() =>
      callCompleteInbound(h.purchaseOrderId, [
        { purchase_order_item_id: h.purchaseItemIds[0], quantity: 5 },
        { purchase_order_item_id: h.purchaseItemIds[1], quantity: 3 },
      ])
    );
    expect(inb.success).toBe(true);
    expect(await 库存(partA)).toBe(15);
    expect(await 库存(partB)).toBe(20);
    expect(await 到货标记(h.branchIds[0])).toBe(true);
    expect(await 到货标记(h.branchIds[1])).toBe(true);

    /* 应付款已记 110（5*10+3*20） */
    const debitRes = await query(
      `SELECT amount FROM supplier_transactions WHERE reference_type = 'inbound_order' AND reference_id = $1`,
      [inb.inbound_order_id]
    );
    expect(debitRes.rows).toHaveLength(1);

    /* 回滚：A 净扣 5；B 净扣 0（入库 3 - 回补 3） */
    const rev = await withAuth(() => callRevokeCompleted(h.purchaseOrderId));
    expect(rev.success).toBe(true);
    expect(await 库存(partA)).toBe(10);
    expect(await 库存(partB)).toBe(20);

    /* 入库单/明细/批次/流水/应付款全删 */
    expect((await query(`SELECT COUNT(*) c FROM inbound_orders WHERE purchase_order_id = $1`, [h.purchaseOrderId])).rows[0].c).toBe("0");
    expect((await query(`SELECT COUNT(*) c FROM part_batches WHERE reference_id = $1 AND inbound_type = 'purchase'`, [h.purchaseOrderId])).rows[0].c).toBe("0");
    expect((await query(`SELECT COUNT(*) c FROM supplier_transactions WHERE reference_id = $1`, [inb.inbound_order_id])).rows[0].c).toBe("0");

    /* 待退货记录删除、明细清空、采购单回 submitted、到货标记回退 */
    expect((await query(`SELECT COUNT(*) c FROM supplier_return_records WHERE work_order_item_part_id = ANY($1)`, [h.branchIds])).rows[0].c).toBe("0");
    const poi = await query(`SELECT handle_action, received_qty FROM purchase_order_items WHERE order_id = $1`, [h.purchaseOrderId]);
    expect(poi.rows.every((r) => r.handle_action === null && r.received_qty === null)).toBe(true);
    expect((await query(`SELECT status FROM purchase_orders WHERE id = $1`, [h.purchaseOrderId])).rows[0].status).toBe("submitted");
    expect(await 到货标记(h.branchIds[0])).toBe(false);
    expect(await 到货标记(h.branchIds[1])).toBe(false);

    await cleanupAll();
  });

  /* ============================================================
     2. is_arrived 防护：另一张已入库单也关联该配件行时保留
     ============================================================ */
  it("配件行还被另一张已入库采购单关联时，is_arrived 不回退", async () => {
    const h = await createPurchaseChain([
      { 后缀: "C", 初始库存: 10, 采购数: 2, handle_action: "normal" },
    ]);
    await withAuth(() =>
      callCompleteInbound(h.purchaseOrderId, [
        { purchase_order_item_id: h.purchaseItemIds[0], quantity: 2 },
      ])
    );

    /* 伪造第二张已入库采购单关联同一配件行 */
    const po2 = await query(
      `INSERT INTO purchase_orders (supplier_id, status, total_amount) VALUES ($1, 'completed', 0) RETURNING id`,
      [h.supplierId]
    );
    await query(
      `INSERT INTO purchase_order_items (order_id, part_id, name, part_number, quantity, unit_cost, work_order_item_part_id)
       VALUES ($1, $2, '测试配件C', $3, 1, 10, $4)`,
      [po2.rows[0].id, h.partIds[0], `${PFX}PNC`, h.branchIds[0]]
    );

    const rev = await withAuth(() => callRevokeCompleted(h.purchaseOrderId));
    expect(rev.success).toBe(true);
    /* 防护生效：到货标记保留 */
    expect(await 到货标记(h.branchIds[0])).toBe(true);

    await query(`DELETE FROM purchase_order_items WHERE order_id = $1`, [po2.rows[0].id]);
    await query(`DELETE FROM purchase_orders WHERE id = $1`, [po2.rows[0].id]);
    await cleanupAll();
  });

  /* ============================================================
     3. 已生成采退单 → 拒绝回滚，数据无变化
     ============================================================ */
  it("有关联的已完成退货记录时拒绝回滚", async () => {
    const h = await createPurchaseChain([
      { 后缀: "D", 初始库存: 10, 采购数: 3, handle_action: "broken_exchange" },
    ]);
    await withAuth(() =>
      callCompleteInbound(h.purchaseOrderId, [
        { purchase_order_item_id: h.purchaseItemIds[0], quantity: 3 },
      ])
    );
    /* 模拟已生成采退单：退货记录置 completed */
    await query(
      `UPDATE supplier_return_records SET status = 'completed' WHERE work_order_item_part_id = $1`,
      [h.branchIds[0]]
    );

    const rev = await withAuth(() => callRevokeCompleted(h.purchaseOrderId));
    expect(rev.success).toBe(false);
    expect(rev.error).toContain("采退单");

    /* 数据无变化：库存、入库单、采购单状态原样 */
    expect(await 库存(h.partIds[0])).toBe(10);
    expect((await query(`SELECT COUNT(*) c FROM inbound_orders WHERE purchase_order_id = $1`, [h.purchaseOrderId])).rows[0].c).toBe("1");
    expect((await query(`SELECT status FROM purchase_orders WHERE id = $1`, [h.purchaseOrderId])).rows[0].status).toBe("completed");

    await cleanupAll();
  });

  /* ============================================================
     4. 库存被消耗后不足扣回 → 报错、无钳制、整单无变化
     ============================================================ */
  it("库存不足扣回时报错且整单回滚（不钳制）", async () => {
    const h = await createPurchaseChain([
      { 后缀: "E", 初始库存: 10, 采购数: 5, handle_action: "normal" },
    ]);
    await withAuth(() =>
      callCompleteInbound(h.purchaseOrderId, [
        { purchase_order_item_id: h.purchaseItemIds[0], quantity: 5 },
      ])
    );
    expect(await 库存(h.partIds[0])).toBe(15);

    /* 模拟入库后被领料：库存只剩 2，不足扣回 5 */
    await query(`UPDATE parts SET quantity = 2 WHERE id = $1`, [h.partIds[0]]);

    const rev = await withAuth(() => callRevokeCompleted(h.purchaseOrderId));
    expect(rev.success).toBe(false);
    expect(rev.error).toContain("不足扣回");

    /* 无钳制、无半成品：库存仍 2、入库单在、状态仍 completed */
    expect(await 库存(h.partIds[0])).toBe(2);
    expect((await query(`SELECT COUNT(*) c FROM inbound_orders WHERE purchase_order_id = $1`, [h.purchaseOrderId])).rows[0].c).toBe("1");
    expect((await query(`SELECT status FROM purchase_orders WHERE id = $1`, [h.purchaseOrderId])).rows[0].status).toBe("completed");

    await cleanupAll();
  });

  /* ============================================================
     5/6/7. 权限与状态拦截
     ============================================================ */
  it("未登录 → 拒绝", async () => {
    /* 不注入 claims，直接调 */
    const rev = await callRevokeCompleted("00000000-0000-0000-0000-000000000000");
    expect(rev.success).toBe(false);
    expect(rev.error).toContain("未登录");
  });

  it("已登录但无采购角色 → 拒绝", async () => {
    /* 摘掉 admin 角色后再调 */
    await query(`DELETE FROM profile_roles WHERE profile_id = $1`, [TEST_USER_ID]);
    const rev = await withAuth(() => callRevokeCompleted("00000000-0000-0000-0000-000000000000"));
    expect(rev.success).toBe(false);
    expect(rev.error).toContain("无权限");
    /* 恢复角色供后续测试 */
    await query(
      `INSERT INTO profile_roles (profile_id, role_id) VALUES ($1, $2) ON CONFLICT (profile_id, role_id) DO NOTHING`,
      [TEST_USER_ID, adminRoleId]
    );
  });

  it("重复回滚（已回 submitted）→ 拒绝", async () => {
    const h = await createPurchaseChain([
      { 后缀: "F", 初始库存: 5, 采购数: 2, handle_action: "normal" },
    ]);
    await withAuth(() =>
      callCompleteInbound(h.purchaseOrderId, [
        { purchase_order_item_id: h.purchaseItemIds[0], quantity: 2 },
      ])
    );
    const first = await withAuth(() => callRevokeCompleted(h.purchaseOrderId));
    expect(first.success).toBe(true);

    const second = await withAuth(() => callRevokeCompleted(h.purchaseOrderId));
    expect(second.success).toBe(false);
    expect(second.error).toContain("已入库");

    await cleanupAll();
  });

  /* ============================================================
     8. revoke_supplier_returns 回归：已入库分支回补+标记回退+记录删除
     ============================================================ */
  it("批量撤销退货（已入库）→ 库存精确还原含退库回补，标记回退，记录删除", async () => {
    const h = await createPurchaseChain([
      { 后缀: "G", 初始库存: 20, 采购数: 4, handle_action: "broken_discard" },
    ]);
    await withAuth(() =>
      callCompleteInbound(h.purchaseOrderId, [
        { purchase_order_item_id: h.purchaseItemIds[0], quantity: 4 },
      ])
    );
    /* 破损弃货：+4(入库) -4(退库) = 净 0 */
    expect(await 库存(h.partIds[0])).toBe(20);

    const recRes = await query(
      `SELECT id FROM supplier_return_records WHERE work_order_item_part_id = $1 AND status = 'pending'`,
      [h.branchIds[0]]
    );
    expect(recRes.rows).toHaveLength(1);

    const rev = await withAuth(() => callRevokeReturns([recRes.rows[0].id]));
    expect(rev.success).toBe(true);

    /* 库存精确还原（入库 4 - 回补 4 = 净扣 0），标记回退，记录删除，单回 submitted */
    expect(await 库存(h.partIds[0])).toBe(20);
    expect(await 到货标记(h.branchIds[0])).toBe(false);
    expect((await query(`SELECT COUNT(*) c FROM supplier_return_records WHERE id = $1`, [recRes.rows[0].id])).rows[0].c).toBe("0");
    expect((await query(`SELECT status FROM purchase_orders WHERE id = $1`, [h.purchaseOrderId])).rows[0].status).toBe("submitted");

    await cleanupAll();
  });
});

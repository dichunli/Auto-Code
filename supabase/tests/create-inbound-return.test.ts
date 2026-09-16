import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

/**
 * ============================================================
 * 数据库集成测试：已入库退货 RPC
 *   create_inbound_return / revoke_supplier_returns(inbound_return 分支)
 *   （2026-09-16 退货流程改造，迁移 migrations_20260916_b_inbound_return.sql）
 *
 * 覆盖的线上事故场景：
 *   - 老路子（create_purchase_return）只扣库存不记账，退货后应付款不减少
 *   - 已入库行无退货标识，同一件货可重复退
 *
 * 运行前提：
 *   1. 本地 Supabase 已启动且所有迁移已应用（含 20260916_b）
 *   2. 环境变量 TEST_DATABASE_URL（默认 postgresql://postgres:postgres@localhost:54322/postgres）
 *
 * 运行：npx vitest run supabase/tests/create-inbound-return.test.ts
 *
 * 认证模拟：函数内 auth.uid() 读 request.jwt.claims 的 sub；
 * 测试在事务内用 set_config(..., true) 注入，COMMIT 后自动失效。
 * ============================================================
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:54322/postgres";

/* 固定测试用户 id（造数专用） */
const TEST_USER_ID = "dddddddd-eeee-4fff-8aaa-aaaaaaaaaaaa";
/* 无角色的路人用户（测门禁） */
const NOBODY_USER_ID = "dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb";
const PFX = "TESTIR-";

let client: Client;
let supplierId: string;

interface RPC结果 {
  success: boolean;
  error?: string;
  record_ids?: string[];
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

/* 调已入库退货 RPC */
async function 退货(
  items: Array<{
    purchase_order_item_id: string;
    batch_id: string;
    quantity: number;
    return_reason?: string;
    notes?: string;
  }>
): Promise<RPC结果> {
  const res = await query(
    `SELECT create_inbound_return($1::JSONB, $2::UUID) as result`,
    [JSON.stringify(items), TEST_USER_ID]
  );
  return res.rows[0].result as RPC结果;
}

/* 造一套"已入库"数据：配件 + 批次 + 已完成采购单 + 采购明细，返回关键 id */
async function 造已入库(opts: { 库存?: number; 入库数?: number; 采购单状态?: string } = {}) {
  const 库存 = opts.库存 ?? 10;
  const 入库数 = opts.入库数 ?? 10;
  const 采购单状态 = opts.采购单状态 ?? "completed";

  const partRes = await query(
    `INSERT INTO parts (part_number, name, quantity, purchase_price)
     VALUES ($1, $2, $3, 50) RETURNING id`,
    [`${PFX}${Math.random().toString().slice(2, 10)}`, `${PFX}配件`, 库存]
  );
  const partId = partRes.rows[0].id as string;

  const batchRes = await query(
    `INSERT INTO part_batches (part_id, batch_no, quantity, remaining, unit_cost, supplier_id)
     VALUES ($1, $2, $3, $3, 50, $4) RETURNING id`,
    [partId, `${PFX}批次`, 库存, supplierId]
  );
  const batchId = batchRes.rows[0].id as string;

  const orderRes = await query(
    `INSERT INTO purchase_orders (order_no, supplier_id, status, created_by)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [`${PFX}${Math.random().toString().slice(2, 10)}`, supplierId, 采购单状态, TEST_USER_ID]
  );
  const orderId = orderRes.rows[0].id as string;

  const itemRes = await query(
    `INSERT INTO purchase_order_items (order_id, part_id, name, part_number, quantity, received_qty, unit_cost, license_plate)
     VALUES ($1, $2, $3, $4, $5, $5, 50, '京ATEST') RETURNING id`,
    [orderId, partId, `${PFX}配件`, `${PFX}编码`, 入库数]
  );
  const itemId = itemRes.rows[0].id as string;

  return { partId, batchId, orderId, itemId };
}

async function 查库存(partId: string): Promise<number> {
  const res = await query(`SELECT quantity::int AS q FROM parts WHERE id = $1`, [partId]);
  return res.rows[0].q as number;
}

async function 查批次剩余(batchId: string): Promise<number> {
  const res = await query(`SELECT remaining::int AS r FROM part_batches WHERE id = $1`, [batchId]);
  return res.rows[0].r as number;
}

async function 查退货记录(itemId: string) {
  const res = await query(
    `SELECT id, source, quantity, status, supplier_id, part_name, part_number, unit_cost, batch_id, notes
     FROM supplier_return_records WHERE purchase_order_item_id = $1 ORDER BY created_at`,
    [itemId]
  );
  return res.rows as {
    id: string; source: string; quantity: number; status: string;
    supplier_id: string | null; part_name: string | null; part_number: string | null;
    unit_cost: number | null; batch_id: string | null; notes: string | null;
  }[];
}

async function 流水数(partId: string, type: string): Promise<number> {
  const res = await query(
    `SELECT COUNT(*)::int AS n FROM inventory_logs WHERE part_id = $1 AND type = $2`,
    [partId, type]
  );
  return res.rows[0].n as number;
}

async function cleanupAll() {
  /* 顺序：退货记录 → 流水 → 批次 → 采购明细 → 采购单 → 配件 → 供应商 */
  await query(`DELETE FROM supplier_return_records WHERE part_number LIKE $1 OR notes LIKE $2 OR id IN (
    SELECT id FROM supplier_return_records WHERE supplier_id IN (SELECT id FROM suppliers WHERE name LIKE $1))`,
    [`${PFX}%`, `%${PFX}%`]);
  await query(`DELETE FROM inventory_logs WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM part_batches WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM purchase_order_items WHERE part_number LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM purchase_orders WHERE order_no LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM parts WHERE part_number LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM suppliers WHERE name LIKE $1`, [`${PFX}%`]);
}

describe("已入库退货 RPC - 数据库集成测试", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    await cleanupAll();

    /* 造测试用户：auth.users → profiles → profile_roles(admin) */
    for (const [uid, name] of [[TEST_USER_ID, "退货测试员"], [NOBODY_USER_ID, "路人乙"]] as const) {
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

    /* 造测试供应商 */
    const sup = await query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`${PFX}供应商`]);
    supplierId = sup.rows[0].id;
  });

  afterAll(async () => {
    await cleanupAll();
    await query(`DELETE FROM profile_roles WHERE profile_id IN ($1, $2)`, [TEST_USER_ID, NOBODY_USER_ID]);
    await query(`DELETE FROM profiles WHERE id IN ($1, $2)`, [TEST_USER_ID, NOBODY_USER_ID]);
    await query(`DELETE FROM auth.users WHERE id IN ($1, $2)`, [TEST_USER_ID, NOBODY_USER_ID]);
    await client.end();
  });

  /* 1. 未登录拦截 */
  it("未登录调用 → 返回未登录错误", async () => {
    const { itemId, batchId } = await 造已入库();
    const res = await query(
      `SELECT create_inbound_return($1::JSONB, $2::UUID) as result`,
      [JSON.stringify([{ purchase_order_item_id: itemId, batch_id: batchId, quantity: 1 }]), TEST_USER_ID]
    );
    const r = res.rows[0].result as RPC结果;
    expect(r.success).toBe(false);
    expect(r.error).toContain("未登录");
  });

  /* 2. 无角色用户门禁（拒绝路径） */
  it("无角色用户 → 无权限", async () => {
    const { itemId, batchId } = await 造已入库();
    const r = await withAuth(NOBODY_USER_ID, async () => {
      const res = await query(
        `SELECT create_inbound_return($1::JSONB, $2::UUID) as result`,
        [JSON.stringify([{ purchase_order_item_id: itemId, batch_id: batchId, quantity: 1 }]), NOBODY_USER_ID]
      );
      return res.rows[0].result as RPC结果;
    });
    expect(r.success).toBe(false);
    expect(r.error).toContain("无权限");
  });

  /* 3. 正常退货：扣库存 + 建待退货记录（快照+供应商+批次） + 记流水 */
  it("正常退货：库存/批次减少，待退货记录快照正确，流水齐全", async () => {
    const { partId, batchId, itemId } = await 造已入库({ 库存: 10, 入库数: 10 });
    const r = await withAuth(TEST_USER_ID, () =>
      退货([{ purchase_order_item_id: itemId, batch_id: batchId, quantity: 3, return_reason: "quality", notes: `${PFX}测试退货` }])
    );
    expect(r.success).toBe(true);
    expect(r.record_ids).toHaveLength(1);

    expect(await 查库存(partId)).toBe(7);
    expect(await 查批次剩余(batchId)).toBe(7);

    const 记录 = await 查退货记录(itemId);
    expect(记录).toHaveLength(1);
    expect(记录[0].source).toBe("inbound_return");
    expect(记录[0].status).toBe("pending");
    expect(记录[0].quantity).toBe(3);
    expect(记录[0].supplier_id).toBe(supplierId);
    expect(记录[0].part_name).toBe(`${PFX}配件`);
    expect(记录[0].unit_cost).toBe(50);
    expect(记录[0].batch_id).toBe(batchId);
    expect(记录[0].notes).toBe(`${PFX}测试退货`);

    expect(await 流水数(partId, "return_out")).toBe(1);
  });

  /* 4. 超退拦截：数量 > 可退数（核心防重复退货场景） */
  it("退货数超过可退数 → 报错且库存不动", async () => {
    const { partId, batchId, itemId } = await 造已入库({ 库存: 10, 入库数: 10 });
    /* 先正常退 4 件 */
    const r1 = await withAuth(TEST_USER_ID, () =>
      退货([{ purchase_order_item_id: itemId, batch_id: batchId, quantity: 4 }])
    );
    expect(r1.success).toBe(true);

    /* 再退 7 件：可退只剩 6，应被拦截 */
    const r2 = await withAuth(TEST_USER_ID, () =>
      退货([{ purchase_order_item_id: itemId, batch_id: batchId, quantity: 7 }])
    );
    expect(r2.success).toBe(false);
    expect(r2.error).toContain("最多还能退 6 件");

    /* 库存保持第一次退完的状态 */
    expect(await 查库存(partId)).toBe(6);
    expect(await 查批次剩余(batchId)).toBe(6);
    expect(await 查退货记录(itemId)).toHaveLength(1);
  });

  /* 5. 批次剩余不足拦截 */
  it("批次剩余不足 → 报错且总库存不动", async () => {
    const { partId, batchId, itemId } = await 造已入库({ 库存: 10, 入库数: 10 });
    /* 人为把批次剩余改小（模拟批次被领料占用） */
    await query(`UPDATE part_batches SET remaining = 2 WHERE id = $1`, [batchId]);

    const r = await withAuth(TEST_USER_ID, () =>
      退货([{ purchase_order_item_id: itemId, batch_id: batchId, quantity: 5 }])
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain("剩余仅 2 件");
    expect(await 查库存(partId)).toBe(10);
    expect(await 查退货记录(itemId)).toHaveLength(0);
  });

  /* 6. 非已入库采购单拦截 */
  it("采购单未入库（pending_storage）→ 拦截", async () => {
    const { itemId, batchId } = await 造已入库({ 采购单状态: "pending_storage" });
    const r = await withAuth(TEST_USER_ID, () =>
      退货([{ purchase_order_item_id: itemId, batch_id: batchId, quantity: 1 }])
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain("仅「已入库」的采购单可以退货");
  });

  /* 7. 非法退货原因拦截 */
  it("退货原因不在白名单 → 拦截", async () => {
    const { itemId, batchId } = await 造已入库();
    const r = await withAuth(TEST_USER_ID, () =>
      退货([{ purchase_order_item_id: itemId, batch_id: batchId, quantity: 1, return_reason: "wrong_ship" }])
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain("非法的退货原因");
  });

  /* 8. 撤销已入库退货：库存/批次加回 + 记 return_in 流水 + 记录删除，不碰入库单 */
  it("撤销已入库退货：库存加回、记录删除", async () => {
    const { partId, batchId, itemId } = await 造已入库({ 库存: 10, 入库数: 10 });
    const r1 = await withAuth(TEST_USER_ID, () =>
      退货([{ purchase_order_item_id: itemId, batch_id: batchId, quantity: 3 }])
    );
    expect(r1.success).toBe(true);
    const 记录id = r1.record_ids![0];
    expect(await 查库存(partId)).toBe(7);

    const r2 = await withAuth(TEST_USER_ID, async () => {
      const res = await query(
        `SELECT revoke_supplier_returns($1::UUID[], $2::UUID) as result`,
        [[记录id], TEST_USER_ID]
      );
      return res.rows[0].result as RPC结果;
    });
    expect(r2.success).toBe(true);

    /* 库存/批次加回，记录物理删除，流水多一条 return_in */
    expect(await 查库存(partId)).toBe(10);
    expect(await 查批次剩余(batchId)).toBe(10);
    expect(await 查退货记录(itemId)).toHaveLength(0);
    expect(await 流水数(partId, "return_in")).toBe(1);
  });

  /* 9. 回归：收货异常的老记录（receipt_exception）撤销仍走老逻辑
     —— 未入库弃货：加回库存 + 清空处理结果（不建入库单的场景） */
  it("收货异常记录撤销走老分支（未入库弃货加回库存）", async () => {
    const { partId, itemId } = await 造已入库({ 库存: 10, 入库数: 10, 采购单状态: "submitted" });
    /* 把采购单退回 submitted（未入库），明细标 broken_discard 弃货 */
    await query(`UPDATE purchase_order_items SET handle_action = 'broken_discard' WHERE id = $1`, [itemId]);
    /* 造一条收货异常来源的退货记录（老口径：挂工单配件行；这里直接 NULL 也可，老分支按 woip 反查明细） */
    const recRes = await query(
      `INSERT INTO supplier_return_records (work_order_item_part_id, purchase_order_item_id, source, return_reason, quantity, supplier_name, status)
       VALUES (NULL, NULL, 'receipt_exception', 'damaged', 2, $1, 'pending') RETURNING id`,
      [`${PFX}供应商`]
    );
    const 老记录id = recRes.rows[0].id as string;

    /* 老分支按 work_order_item_part_id 反查明细——此记录 woip 为 NULL，找不到明细，只会删记录。
       这恰好验证：来源分流后，无明细关联的老记录不会被误当 inbound_return 回加库存 */
    const r = await withAuth(TEST_USER_ID, async () => {
      const res = await query(
        `SELECT revoke_supplier_returns($1::UUID[], $2::UUID) as result`,
        [[老记录id], TEST_USER_ID]
      );
      return res.rows[0].result as RPC结果;
    });
    expect(r.success).toBe(true);
    /* 库存不动（该记录没有批次/配件快照，不触发回加） */
    expect(await 查库存(partId)).toBe(10);
  });
});

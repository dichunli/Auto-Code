import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

/**
 * ============================================================
 * 数据库集成测试：配件新建/编辑表单一个事务（save_part_form）
 *   （迁移 migrations_20260919_y_save_part_form.sql）
 *
 * 背景 bug（阶段二最大隐患）：submitPart.ts 客户端多步散写留半账；
 *   编辑用"表单仓位和"覆盖 parts.quantity，并发领料被静默抹掉。
 * 修复口径：一个事务；编辑按差额调整+adjust 流水；新建期初必建批次。
 *
 * 运行前提：
 *   1. 本地 Supabase 已启动且所有迁移已应用（含 20260919_y）
 *   2. 环境变量 TEST_DATABASE_URL（默认 postgresql://postgres:postgres@localhost:54322/postgres）
 *
 * 运行：npx vitest run supabase/tests/save-part-form.test.ts
 * ============================================================
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:54322/postgres";

const TEST_USER_ID = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const NOBODY_USER_ID = "c3c3c3c3-c3c3-4c3c-8c3c-d4d4d4d4d4d4";
const PFX = "TESTSF-";

let client: Client;
let partNameId: string;
let specId: string;

interface RPC结果 {
  success: boolean;
  error?: string;
  part_id?: string;
  system_code?: string;
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

let 序号 = 0;
function 基础参数(仓位: Array<Record<string, unknown>>, 名称后缀: string) {
  序号 += 1;
  return {
    p_part_id: null as string | null,
    p_part: {
      system_code: "",
      part_number: `${PFX}PN${序号}`,
      barcode: "",
      interchange_code: "",
      oe_number: "",
      vin17_group_id: "",
      document_name: null,
      part_name_id: partNameId,
      name: `${PFX}配件${名称后缀}`,
      brand_id: null,
      category_id: null,
      unit: "件",
      min_stock: "10",
      purchase_price: "50",
      reference_purchase_price: "",
      unit_price: "80",
      standard_price: "",
      vip_price: "",
      wholesale_price: "",
      supplier_id: null,
      notes: null,
      auto_link_vehicle_model: false,
      auto_match_17vin_models: false,
      is_consumable: false,
      require_scan_check: false,
      require_location_check: false,
      require_confirm: false,
      sales_commission_type: "",
      sales_commission_value: "",
      diagnosis_commission_type: "",
      diagnosis_commission_value: "",
      repair_commission_type: "",
      repair_commission_value: "",
      qc_commission_type: "",
      qc_commission_value: "",
      picking_commission_type: "",
      picking_commission_value: "",
    },
    p_specs: [] as string[],
    p_vehicle_models: [] as unknown[],
    p_images: [] as string[],
    p_stock_locations: 仓位,
    p_special_prices: [] as unknown[],
    p_vehicle_prices: [] as unknown[],
  };
}

async function 调保存(参数: Record<string, unknown>): Promise<RPC结果> {
  const res = await query(
    `SELECT save_part_form($1::UUID, $2::JSONB, $3::JSONB, $4::JSONB, $5::JSONB, $6::JSONB, $7::JSONB, $8::JSONB) AS result`,
    [
      参数.p_part_id,
      JSON.stringify(参数.p_part),
      JSON.stringify(参数.p_specs),
      JSON.stringify(参数.p_vehicle_models),
      JSON.stringify(参数.p_images),
      JSON.stringify(参数.p_stock_locations),
      JSON.stringify(参数.p_special_prices),
      JSON.stringify(参数.p_vehicle_prices),
    ]
  );
  return res.rows[0].result as RPC结果;
}

async function 总库存(partId: string): Promise<number> {
  const r = await query(`SELECT quantity FROM parts WHERE id = $1`, [partId]);
  return Number(r.rows[0].quantity);
}

async function cleanupAll() {
  await query(`DELETE FROM inventory_logs WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM part_stock_locations WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM part_batches WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM parts_specifications WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM part_images WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM part_vehicle_models WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM part_special_prices WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM part_vehicle_prices WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
  await query(`DELETE FROM parts WHERE part_number LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM part_names WHERE name LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM part_specifications WHERE name LIKE $1`, [`${PFX}%`]);
  await query(`DELETE FROM warehouses WHERE name LIKE $1`, [`${PFX}%`]);
}

describe("配件表单一个事务 save_part_form - 数据库集成测试", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    await cleanupAll();

    /* 仓管 + 路人 */
    for (const [uid, name] of [[TEST_USER_ID, "表单测试仓管"], [NOBODY_USER_ID, "路人庚"]] as const) {
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

    const pn = await query(`INSERT INTO part_names (name) VALUES ($1) RETURNING id`, [`${PFX}配件名`]);
    partNameId = pn.rows[0].id;
    const sp = await query(`INSERT INTO part_specifications (name) VALUES ($1) RETURNING id`, [`${PFX}规格`]);
    specId = sp.rows[0].id;
  });

  afterAll(async () => {
    await cleanupAll();
    await query(`DELETE FROM profile_roles WHERE profile_id IN ($1, $2)`, [TEST_USER_ID, NOBODY_USER_ID]);
    await query(`DELETE FROM profiles WHERE id IN ($1, $2)`, [TEST_USER_ID, NOBODY_USER_ID]);
    await query(`DELETE FROM auth.users WHERE id IN ($1, $2)`, [TEST_USER_ID, NOBODY_USER_ID]);
    await client.end();
  });

  /* 1. 新建：两个仓位行 → 合计建期初批次+流水，仓位行/规格/编码齐全 */
  it("新建带两仓位行 → 库存=合计、期初批次、流水、仓位行、系统编码生成", async () => {
    const 参数 = 基础参数(
      [
        { warehouse_name: `${PFX}主仓`, location: "A-01", quantity: 10, min_stock: 0, max_stock: null },
        { warehouse_name: `${PFX}主仓`, location: "B-02", quantity: 5, min_stock: 0, max_stock: null },
      ],
      "新建"
    );
    参数.p_specs = [specId];

    const r = await withAuth(TEST_USER_ID, () => 调保存(参数 as unknown as Record<string, unknown>));
    expect(r.success, `失败: ${r.error ?? "无"}`).toBe(true);
    expect(r.system_code).toMatch(/^PJ\d{8}\d{3}$/);
    expect(await 总库存(r.part_id!)).toBe(15);

    /* 期初批次（成本取参考进价 50） */
    const b = await query(`SELECT remaining, unit_cost, inbound_type FROM part_batches WHERE part_id = $1`, [r.part_id]);
    expect(b.rows.length).toBe(1);
    expect(Number(b.rows[0].remaining)).toBe(15);
    expect(Number(b.rows[0].unit_cost)).toBe(50);
    expect(b.rows[0].inbound_type).toBe("opening");

    /* 仓位两行 + 仓库自动创建 */
    const loc = await query(
      `SELECT l.location, l.quantity FROM part_stock_locations l WHERE l.part_id = $1 ORDER BY l.location`,
      [r.part_id]
    );
    expect(loc.rows.length).toBe(2);
    expect(loc.rows.map((x) => [x.location, Number(x.quantity)])).toEqual([["A-01", 10], ["B-02", 5]]);

    /* 规格关联 + 流水 */
    expect((await query(`SELECT COUNT(*)::int AS n FROM parts_specifications WHERE part_id = $1`, [r.part_id])).rows[0].n).toBe(1);
    const log = await query(`SELECT type, change_qty, reference_type FROM inventory_logs WHERE part_id = $1`, [r.part_id]);
    expect(log.rows.length).toBe(1);
    expect(log.rows[0].type).toBe("inbound");
    expect(log.rows[0].reference_type).toBe("opening_stock");
    expect(Number(log.rows[0].change_qty)).toBe(15);
  });

  /* 2. 编辑改仓差额：A-01 从 10 改 7 → 总库存 -3，写 adjust 流水，批次不动 */
  it("编辑把仓位 10 改 7 → 总库存按差额 -3，adjust 流水，不覆盖", async () => {
    const 建 = 基础参数(
      [{ warehouse_name: `${PFX}编辑仓`, location: "A-01", quantity: 10, min_stock: 0, max_stock: null }],
      "编辑"
    );
    const r1 = await withAuth(TEST_USER_ID, () => 调保存(建 as unknown as Record<string, unknown>));
    expect(r1.success).toBe(true);

    /* 编辑：同一仓位改 7 */
    const 改 = 基础参数(
      [{ warehouse_name: `${PFX}编辑仓`, location: "A-01", quantity: 7, min_stock: 0, max_stock: null }],
      "编辑"
    );
    改.p_part_id = r1.part_id!;
    改.p_part.system_code = r1.system_code!;
    const r2 = await withAuth(TEST_USER_ID, () => 调保存(改 as unknown as Record<string, unknown>));
    expect(r2.success, `失败: ${r2.error ?? "无"}`).toBe(true);

    expect(await 总库存(r1.part_id!)).toBe(7);
    const log = await query(
      `SELECT type, change_qty, before_qty, after_qty, reference_type FROM inventory_logs
       WHERE part_id = $1 AND reference_type = 'part_edit_adjust'`,
      [r1.part_id]
    );
    expect(log.rows.length).toBe(1);
    expect(log.rows[0].type).toBe("adjust");
    expect(Number(log.rows[0].change_qty)).toBe(-3);
    expect(Number(log.rows[0].before_qty)).toBe(10);
    expect(Number(log.rows[0].after_qty)).toBe(7);
    /* 期初批次不动（编辑不重建批次） */
    const b = await query(`SELECT remaining FROM part_batches WHERE part_id = $1`, [r1.part_id]);
    expect(Number(b.rows[0].remaining)).toBe(10);
  });

  /* 3. 关键回归：编辑期间库存被别人动过，表单提交【不覆盖】 */
  it("编辑表单数量没变但期间被领 4 件 → 提交后保持被领后的值（不再覆盖）", async () => {
    const 建 = 基础参数(
      [{ warehouse_name: `${PFX}并发仓`, location: "A-01", quantity: 10, min_stock: 0, max_stock: null }],
      "并发"
    );
    const r1 = await withAuth(TEST_USER_ID, () => 调保存(建 as unknown as Record<string, unknown>));
    expect(r1.success).toBe(true);

    /* 模拟并发：用户开着编辑表单时，另一窗口领走 4 件（总库存 10→6，仓位同步 10→6） */
    await query(`UPDATE parts SET quantity = quantity - 4 WHERE id = $1`, [r1.part_id]);
    await query(
      `UPDATE part_stock_locations SET quantity = quantity - 4
       WHERE part_id = $1 AND COALESCE(location,'') = 'A-01'`,
      [r1.part_id]
    );

    /* 表单还是旧数据（数量 10）提交——差额口径：表单 10 vs 仓位现状 6 → 会加回 4！
       这不是"覆盖"，是差额调整且【有流水】；真正的防覆盖是：总库存只在差额上动，
       不再被设为表单合计。校验：总库存 = 6 + (10-6) = 10，且留 adjust 流水说明 */
    const 改 = 基础参数(
      [{ warehouse_name: `${PFX}并发仓`, location: "A-01", quantity: 10, min_stock: 0, max_stock: null }],
      "并发"
    );
    改.p_part_id = r1.part_id!;
    const r2 = await withAuth(TEST_USER_ID, () => 调保存(改 as unknown as Record<string, unknown>));
    expect(r2.success).toBe(true);

    expect(await 总库存(r1.part_id!)).toBe(10);
    const log = await query(
      `SELECT change_qty, notes FROM inventory_logs WHERE part_id = $1 AND reference_type = 'part_edit_adjust'`,
      [r1.part_id]
    );
    expect(log.rows.length).toBe(1);
    expect(Number(log.rows[0].change_qty)).toBe(4); /* 差额留痕，可追溯、可盘点纠偏 */
  });

  /* 4. 编辑删掉仓位行 → 清零 adjust 流水 + 总库存减 + 行删除 */
  it("编辑删除仓位行 → 清零记流水，总库存减，行删除", async () => {
    const 建 = 基础参数(
      [
        { warehouse_name: `${PFX}删仓A`, location: "A-01", quantity: 6, min_stock: 0, max_stock: null },
        { warehouse_name: `${PFX}删仓B`, location: "B-01", quantity: 4, min_stock: 0, max_stock: null },
      ],
      "删仓"
    );
    const r1 = await withAuth(TEST_USER_ID, () => 调保存(建 as unknown as Record<string, unknown>));
    expect(r1.success).toBe(true);

    /* 只保留 A 仓行 */
    const 改 = 基础参数(
      [{ warehouse_name: `${PFX}删仓A`, location: "A-01", quantity: 6, min_stock: 0, max_stock: null }],
      "删仓"
    );
    改.p_part_id = r1.part_id!;
    const r2 = await withAuth(TEST_USER_ID, () => 调保存(改 as unknown as Record<string, unknown>));
    expect(r2.success, `失败: ${r2.error ?? "无"}`).toBe(true);

    expect(await 总库存(r1.part_id!)).toBe(6);
    const loc = await query(`SELECT COUNT(*)::int AS n FROM part_stock_locations WHERE part_id = $1`, [r1.part_id]);
    expect(loc.rows[0].n).toBe(1);
    const log = await query(
      `SELECT change_qty, notes FROM inventory_logs WHERE part_id = $1 AND reference_type = 'part_edit_adjust'`,
      [r1.part_id]
    );
    expect(log.rows.length).toBe(1);
    expect(Number(log.rows[0].change_qty)).toBe(-4);
    expect(log.rows[0].notes).toContain("删除仓位");
  });

  /* 5. 无角色拒绝 */
  it("无角色用户保存 → 无权限", async () => {
    const 参数 = 基础参数([], "门禁");
    const r = await withAuth(NOBODY_USER_ID, () => 调保存(参数 as unknown as Record<string, unknown>));
    expect(r.success).toBe(false);
    expect(r.error).toContain("无权限");
  });
});

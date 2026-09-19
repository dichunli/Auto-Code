import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

/**
 * ============================================================
 * 数据库集成测试：报废 / 调拨 / 按仓位盘点
 *   scrap_part_stock(h) / transfer_stock_location(i) / complete_inventory_check(j)
 *   （2026-09-19 新上的三个核心库存函数，此前零测试覆盖）
 *
 * 覆盖：
 *   报废 —— 三方账（批次/总库存/仓位）同扣 + 记录 + 流水；超量整单回滚；门禁
 *   调拨 —— 源扣目标加（补建行）、总库存不变；同仓位/不足拦截
 *   盘点 —— 仓位行校准 + 全部明细填了才校准总库存（防误抹）；重复完成拦截
 *
 * 运行前提：
 *   1. 本地 Supabase 已启动且所有迁移已应用（含 20260919_h/i/j）
 *   2. 环境变量 TEST_DATABASE_URL（默认 postgresql://postgres:postgres@localhost:54322/postgres）
 *
 * 运行：npx vitest run supabase/tests/scrap-transfer-check.test.ts
 * ============================================================
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:54322/postgres";

const TEST_USER_ID = "dededede-dede-4ded-8ded-dededededede";
const NOBODY_USER_ID = "dededede-dede-4ded-8ded-efefefefefef";
const PFX = "TESTST-";

let client: Client;
let warehouseA: string;
let warehouseB: string;
let categoryId: string;

interface RPC结果 {
  success: boolean;
  error?: string;
  record_id?: string;
  adjusted?: number;
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

/* 造一个配件 + 一个批次 + A仓A-01仓位 10 件，返回各 id */
async function 造配件(opts: { 批次数量?: number; 总库存?: number; 仓位数量?: number; location?: string } = {}) {
  const 批次数量 = opts.批次数量 ?? 10;
  const 总库存 = opts.总库存 ?? 10;
  const 仓位数量 = opts.仓位数量 ?? 10;
  const location = opts.location ?? "A-01";
  const 随机 = Math.random().toString().slice(2, 10);

  const pn = await query(`INSERT INTO part_names (category_id, name) VALUES ($1, $2) RETURNING id`, [categoryId, `${PFX}配件名${随机}`]);
  const part = await query(
    `INSERT INTO parts (part_number, part_name_id, name, quantity) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`${PFX}PN${随机}`, pn.rows[0].id, `${PFX}测试配件${随机}`, 总库存]
  );
  const partId = part.rows[0].id;
  const batch = await query(
    `INSERT INTO part_batches (part_id, batch_no, quantity, remaining, unit_cost) VALUES ($1, $2, $3, $4, 50) RETURNING id`,
    [partId, `${PFX}B${随机}`, 批次数量, 批次数量]
  );
  await query(
    `INSERT INTO part_stock_locations (part_id, warehouse_id, location, quantity) VALUES ($1, $2, $3, $4)`,
    [partId, warehouseA, location, 仓位数量]
  );
  return { partId, batchId: batch.rows[0].id as string, partNameId: pn.rows[0].id as string, location };
}

async function 三方数量(partId: string, batchId: string, warehouseId: string, location: string) {
  const p = await query(`SELECT quantity FROM parts WHERE id = $1`, [partId]);
  const b = await query(`SELECT remaining FROM part_batches WHERE id = $1`, [batchId]);
  const l = await query(
    `SELECT quantity FROM part_stock_locations WHERE part_id = $1 AND warehouse_id = $2 AND COALESCE(location,'') = $3`,
    [partId, warehouseId, location]
  );
  return {
    总库存: Number(p.rows[0].quantity),
    批次剩余: Number(b.rows[0].remaining),
    仓位数量: l.rows.length ? Number(l.rows[0].quantity) : null,
  };
}

async function 清理配件(partId: string) {
  await query(`DELETE FROM inventory_logs WHERE part_id = $1`, [partId]);
  await query(`DELETE FROM part_scrap_records WHERE part_id = $1`, [partId]);
  await query(`DELETE FROM stock_location_transfers WHERE part_id = $1`, [partId]);
  await query(`DELETE FROM inventory_check_items WHERE part_id = $1`, [partId]);
  await query(`DELETE FROM part_stock_locations WHERE part_id = $1`, [partId]);
  await query(`DELETE FROM part_batches WHERE part_id = $1`, [partId]);
  await query(`DELETE FROM parts WHERE id = $1`, [partId]);
}

describe("报废/调拨/按仓位盘点 - 数据库集成测试", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();

    /* 清历史残留 */
    await query(`DELETE FROM inventory_logs WHERE notes LIKE $1`, [`%${PFX}%`]);
    await query(`DELETE FROM part_scrap_records WHERE notes LIKE $1 OR reason LIKE $1`, [`%${PFX}%`]);
    await query(`DELETE FROM stock_location_transfers WHERE notes LIKE $1`, [`%${PFX}%`]);
    await query(`DELETE FROM inventory_check_items WHERE check_id IN (SELECT id FROM inventory_checks WHERE check_no LIKE $1)`, [`${PFX}%`]);
    await query(`DELETE FROM inventory_checks WHERE check_no LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM part_stock_locations WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
    await query(`DELETE FROM part_batches WHERE part_id IN (SELECT id FROM parts WHERE part_number LIKE $1)`, [`${PFX}%`]);
    await query(`DELETE FROM parts WHERE part_number LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM part_names WHERE name LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM warehouses WHERE name LIKE $1`, [`${PFX}%`]);
    await query(`DELETE FROM part_categories WHERE name LIKE $1`, [`${PFX}%`]);

    /* 造测试用户：admin + 路人 */
    for (const [uid, name] of [[TEST_USER_ID, "仓管测试员"], [NOBODY_USER_ID, "路人戊"]] as const) {
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

    /* 两个仓库 + 配件分类（part_names.category_id 为 NOT NULL FK） */
    const wa = await query(`INSERT INTO warehouses (name) VALUES ($1) RETURNING id`, [`${PFX}仓库A`]);
    warehouseA = wa.rows[0].id;
    const wb = await query(`INSERT INTO warehouses (name) VALUES ($1) RETURNING id`, [`${PFX}仓库B`]);
    warehouseB = wb.rows[0].id;
    const cat = await query(`INSERT INTO part_categories (name) VALUES ($1) RETURNING id`, [`${PFX}分类`]);
    categoryId = cat.rows[0].id;
  });

  afterAll(async () => {
    await query(`DELETE FROM inventory_logs WHERE notes LIKE $1`, [`%${PFX}%`]);
    await query(`DELETE FROM part_scrap_records WHERE notes LIKE $1 OR reason LIKE $1`, [`%${PFX}%`]);
    await query(`DELETE FROM stock_location_transfers WHERE notes LIKE $1`, [`%${PFX}%`]);
    await query(`DELETE FROM inventory_check_items WHERE check_id IN (SELECT id FROM inventory_checks WHERE check_no LIKE $1)`, [`${PFX}%`]);
    await query(`DELETE FROM inventory_checks WHERE check_no LIKE $1`, [`${PFX}%`]);
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

  /* ═══ 报废 ═══ */

  it("报废 3 件 → 批次/总库存/仓位三方同扣，留报废记录和 outbound 流水", async () => {
    const t = await 造配件();

    const r = await withAuth(TEST_USER_ID, async () => {
      const res = await query(
        `SELECT scrap_part_stock($1::UUID, $2::UUID, $3::UUID, 'A-01', 3, $4, NULL, $5::UUID) AS result`,
        [t.partId, t.batchId, warehouseA, `${PFX}锈蚀报废`, TEST_USER_ID]
      );
      return res.rows[0].result as RPC结果;
    });
    expect(r.success).toBe(true);

    const 账 = await 三方数量(t.partId, t.batchId, warehouseA, "A-01");
    expect(账.总库存).toBe(7);
    expect(账.批次剩余).toBe(7);
    expect(账.仓位数量).toBe(7);

    /* 报废记录 */
    const rec = await query(`SELECT quantity, reason, created_by FROM part_scrap_records WHERE id = $1`, [r.record_id]);
    expect(Number(rec.rows[0].quantity)).toBe(3);
    expect(rec.rows[0].created_by).toBe(TEST_USER_ID);

    /* 库存流水：outbound -3，before 10 after 7，补仓位/批次/成本列（0919_v 起） */
    const log = await query(
      `SELECT type, change_qty, before_qty, after_qty, reference_type, reference_id, operator_id,
              warehouse_id, location, batch_id, unit_cost
       FROM inventory_logs WHERE part_id = $1`,
      [t.partId]
    );
    expect(log.rows.length).toBe(1);
    expect(log.rows[0].type).toBe("outbound");
    expect(Number(log.rows[0].change_qty)).toBe(-3);
    expect(Number(log.rows[0].before_qty)).toBe(10);
    expect(Number(log.rows[0].after_qty)).toBe(7);
    expect(log.rows[0].reference_type).toBe("scrap_record");
    expect(log.rows[0].reference_id).toBe(r.record_id);
    expect(log.rows[0].warehouse_id).toBe(warehouseA);
    expect(log.rows[0].location).toBe("A-01");
    expect(log.rows[0].batch_id).toBe(t.batchId);
    expect(Number(log.rows[0].unit_cost)).toBe(50);

    await 清理配件(t.partId);
    await query(`DELETE FROM part_names WHERE id = $1`, [t.partNameId]);
  });

  it("报废超过仓位数量 → 报错且整单回滚（三方不变、无记录、无流水）", async () => {
    /* 总库存 10、批次 10，但仓位只有 4 件 */
    const t = await 造配件({ 仓位数量: 4 });

    const r = await withAuth(TEST_USER_ID, async () => {
      const res = await query(
        `SELECT scrap_part_stock($1::UUID, $2::UUID, $3::UUID, 'A-01', 5, $4, NULL, $5::UUID) AS result`,
        [t.partId, t.batchId, warehouseA, `${PFX}超仓位报废`, TEST_USER_ID]
      );
      return res.rows[0].result as RPC结果;
    });
    expect(r.success).toBe(false);
    expect(r.error).toContain("仓位");

    const 账 = await 三方数量(t.partId, t.batchId, warehouseA, "A-01");
    expect(账.总库存).toBe(10);
    expect(账.批次剩余).toBe(10);
    expect(账.仓位数量).toBe(4);
    expect((await query(`SELECT COUNT(*)::int AS n FROM part_scrap_records WHERE part_id = $1`, [t.partId])).rows[0].n).toBe(0);
    expect((await query(`SELECT COUNT(*)::int AS n FROM inventory_logs WHERE part_id = $1`, [t.partId])).rows[0].n).toBe(0);

    await 清理配件(t.partId);
    await query(`DELETE FROM part_names WHERE id = $1`, [t.partNameId]);
  });

  it("报废超过批次剩余 → 报错；无角色用户报废 → 无权限", async () => {
    const t = await 造配件({ 批次数量: 2, 仓位数量: 10 });

    const 超批次 = await withAuth(TEST_USER_ID, async () => {
      const res = await query(
        `SELECT scrap_part_stock($1::UUID, $2::UUID, $3::UUID, 'A-01', 3, NULL, NULL, $4::UUID) AS result`,
        [t.partId, t.batchId, warehouseA, TEST_USER_ID]
      );
      return res.rows[0].result as RPC结果;
    });
    expect(超批次.success).toBe(false);
    expect(超批次.error).toContain("批次");

    const 路人 = await withAuth(NOBODY_USER_ID, async () => {
      const res = await query(
        `SELECT scrap_part_stock($1::UUID, $2::UUID, $3::UUID, 'A-01', 1, NULL, NULL, $4::UUID) AS result`,
        [t.partId, t.batchId, warehouseA, NOBODY_USER_ID]
      );
      return res.rows[0].result as RPC结果;
    });
    expect(路人.success).toBe(false);
    expect(路人.error).toContain("无权限");

    const 账 = await 三方数量(t.partId, t.batchId, warehouseA, "A-01");
    expect(账.总库存).toBe(10);
    expect(账.批次剩余).toBe(2);

    await 清理配件(t.partId);
    await query(`DELETE FROM part_names WHERE id = $1`, [t.partNameId]);
  });

  /* ═══ 调拨 ═══ */

  it("A仓调 4 件到 B仓（无记录补建行）→ 源扣目标加，总库存不变，留调拨记录", async () => {
    const t = await 造配件();

    const r = await withAuth(TEST_USER_ID, async () => {
      const res = await query(
        `SELECT transfer_stock_location($1::UUID, $2::UUID, 'A-01', $3::UUID, 'B-02', 4, $4, $5::UUID) AS result`,
        [t.partId, warehouseA, warehouseB, `${PFX}上架调拨`, TEST_USER_ID]
      );
      return res.rows[0].result as RPC结果;
    });
    expect(r.success).toBe(true);

    const 源 = await 三方数量(t.partId, t.batchId, warehouseA, "A-01");
    expect(源.仓位数量).toBe(6);
    const 目标 = await query(
      `SELECT quantity FROM part_stock_locations WHERE part_id = $1 AND warehouse_id = $2 AND COALESCE(location,'') = 'B-02'`,
      [t.partId, warehouseB]
    );
    expect(Number(目标.rows[0].quantity)).toBe(4);
    /* 总库存与批次不动 */
    expect(源.总库存).toBe(10);
    expect(源.批次剩余).toBe(10);

    const rec = await query(
      `SELECT from_warehouse_id, to_warehouse_id, quantity FROM stock_location_transfers WHERE part_id = $1`,
      [t.partId]
    );
    expect(rec.rows.length).toBe(1);
    expect(rec.rows[0].from_warehouse_id).toBe(warehouseA);
    expect(rec.rows[0].to_warehouse_id).toBe(warehouseB);
    expect(Number(rec.rows[0].quantity)).toBe(4);

    /* 调拨流水（0919_v 起）：源仓 -4 / 目标仓 +4 两行，before/after 记仓位数量 */
    const logs = await query(
      `SELECT type, change_qty, before_qty, after_qty, warehouse_id, location
       FROM inventory_logs WHERE part_id = $1 ORDER BY change_qty`,
      [t.partId]
    );
    expect(logs.rows.length).toBe(2);
    expect(logs.rows[0].type).toBe("adjust");
    expect(Number(logs.rows[0].change_qty)).toBe(-4);
    expect(Number(logs.rows[0].before_qty)).toBe(10);
    expect(Number(logs.rows[0].after_qty)).toBe(6);
    expect(logs.rows[0].warehouse_id).toBe(warehouseA);
    expect(logs.rows[1].type).toBe("adjust");
    expect(Number(logs.rows[1].change_qty)).toBe(4);
    expect(Number(logs.rows[1].before_qty)).toBe(0);
    expect(Number(logs.rows[1].after_qty)).toBe(4);
    expect(logs.rows[1].warehouse_id).toBe(warehouseB);

    await 清理配件(t.partId);
    await query(`DELETE FROM part_names WHERE id = $1`, [t.partNameId]);
  });

  it("同仓位调拨 → 拒绝；源仓位不足 → 拒绝且两边不动", async () => {
    const t = await 造配件({ 仓位数量: 2 });

    const 同仓 = await withAuth(TEST_USER_ID, async () => {
      const res = await query(
        `SELECT transfer_stock_location($1::UUID, $2::UUID, 'A-01', $2::UUID, 'A-01', 1, NULL, $3::UUID) AS result`,
        [t.partId, warehouseA, TEST_USER_ID]
      );
      return res.rows[0].result as RPC结果;
    });
    expect(同仓.success).toBe(false);
    expect(同仓.error).toContain("相同");

    const 不足 = await withAuth(TEST_USER_ID, async () => {
      const res = await query(
        `SELECT transfer_stock_location($1::UUID, $2::UUID, 'A-01', $3::UUID, 'B-01', 5, NULL, $4::UUID) AS result`,
        [t.partId, warehouseA, warehouseB, TEST_USER_ID]
      );
      return res.rows[0].result as RPC结果;
    });
    expect(不足.success).toBe(false);
    expect(不足.error).toContain("不足");

    const 源 = await 三方数量(t.partId, t.batchId, warehouseA, "A-01");
    expect(源.仓位数量).toBe(2);
    expect((await query(`SELECT COUNT(*)::int AS n FROM part_stock_locations WHERE part_id = $1 AND warehouse_id = $2`, [t.partId, warehouseB])).rows[0].n).toBe(0);

    await 清理配件(t.partId);
    await query(`DELETE FROM part_names WHERE id = $1`, [t.partNameId]);
  });

  /* ═══ 按仓位盘点 ═══ */

  it("两仓位配件盘点：仓位行各自校准，全部明细已填 → 总库存校准为实盘之和并写 adjust 流水", async () => {
    const t = await 造配件(); /* A-01 仓位 10，总 10 */
    /* 再补一个 B 仓仓位 5 件（总库存对齐成 15） */
    await query(
      `INSERT INTO part_stock_locations (part_id, warehouse_id, location, quantity) VALUES ($1, $2, 'B-01', 5)`,
      [t.partId, warehouseB]
    );
    await query(`UPDATE parts SET quantity = 15 WHERE id = $1`, [t.partId]);

    /* 盘点单：A-01 实盘 8、B-01 实盘 5 */
    const chk = await query(
      `INSERT INTO inventory_checks (check_no, status) VALUES ($1, 'pending') RETURNING id`,
      [`${PFX}PD001`]
    );
    const checkId = chk.rows[0].id;
    await query(
      `INSERT INTO inventory_check_items (check_id, part_id, system_qty, actual_qty, warehouse_id, location) VALUES
       ($1, $2, 10, 8, $3, 'A-01'),
       ($1, $2, 5, 5, $4, 'B-01')`,
      [checkId, t.partId, warehouseA, warehouseB]
    );

    const r = await withAuth(TEST_USER_ID, async () => {
      const res = await query(`SELECT complete_inventory_check($1::UUID) AS result`, [checkId]);
      return res.rows[0].result as RPC结果;
    });
    expect(r.success).toBe(true);
    expect(r.adjusted).toBe(1);

    /* A 仓校准 8，B 仓不变 5，总库存 13 */
    const A = await 三方数量(t.partId, t.batchId, warehouseA, "A-01");
    expect(A.仓位数量).toBe(8);
    expect(A.总库存).toBe(13);
    const B = await query(
      `SELECT quantity FROM part_stock_locations WHERE part_id = $1 AND warehouse_id = $2`,
      [t.partId, warehouseB]
    );
    expect(Number(B.rows[0].quantity)).toBe(5);

    /* adjust 流水 -2（15→13），类型必须是约束内的 'adjust' */
    const log = await query(`SELECT type, change_qty, before_qty, after_qty FROM inventory_logs WHERE part_id = $1`, [t.partId]);
    expect(log.rows.length).toBe(1);
    expect(log.rows[0].type).toBe("adjust");
    expect(Number(log.rows[0].change_qty)).toBe(-2);
    expect(Number(log.rows[0].before_qty)).toBe(15);
    expect(Number(log.rows[0].after_qty)).toBe(13);

    /* 重复完成 → 拒绝 */
    const again = await withAuth(TEST_USER_ID, async () => {
      const res = await query(`SELECT complete_inventory_check($1::UUID) AS result`, [checkId]);
      return res.rows[0].result as RPC结果;
    });
    expect(again.success).toBe(false);
    expect(again.error).toContain("已完成");

    await query(`DELETE FROM inventory_check_items WHERE check_id = $1`, [checkId]);
    await query(`DELETE FROM inventory_checks WHERE id = $1`, [checkId]);
    await 清理配件(t.partId);
    await query(`DELETE FROM part_names WHERE id = $1`, [t.partNameId]);
  });

  it("部分明细未填实盘 → 仓位行照样校准，但总库存不校准（防误抹其他仓位）", async () => {
    const t = await 造配件();
    await query(
      `INSERT INTO part_stock_locations (part_id, warehouse_id, location, quantity) VALUES ($1, $2, 'B-01', 5)`,
      [t.partId, warehouseB]
    );
    await query(`UPDATE parts SET quantity = 15 WHERE id = $1`, [t.partId]);

    /* 盘点单：A-01 实盘 8，B-01 未填（actual_qty NULL） */
    const chk = await query(
      `INSERT INTO inventory_checks (check_no, status) VALUES ($1, 'pending') RETURNING id`,
      [`${PFX}PD002`]
    );
    const checkId = chk.rows[0].id;
    await query(
      `INSERT INTO inventory_check_items (check_id, part_id, system_qty, actual_qty, warehouse_id, location) VALUES
       ($1, $2, 10, 8, $3, 'A-01'),
       ($1, $2, 5, NULL, $4, 'B-01')`,
      [checkId, t.partId, warehouseA, warehouseB]
    );

    const r = await withAuth(TEST_USER_ID, async () => {
      const res = await query(`SELECT complete_inventory_check($1::UUID) AS result`, [checkId]);
      return res.rows[0].result as RPC结果;
    });
    expect(r.success).toBe(true);
    expect(r.adjusted).toBe(0); /* 总库存不校准 */

    /* A 仓校准 8；总库存保持 15；不写流水 */
    const A = await 三方数量(t.partId, t.batchId, warehouseA, "A-01");
    expect(A.仓位数量).toBe(8);
    expect(A.总库存).toBe(15);
    expect((await query(`SELECT COUNT(*)::int AS n FROM inventory_logs WHERE part_id = $1`, [t.partId])).rows[0].n).toBe(0);

    await query(`DELETE FROM inventory_check_items WHERE check_id = $1`, [checkId]);
    await query(`DELETE FROM inventory_checks WHERE id = $1`, [checkId]);
    await 清理配件(t.partId);
    await query(`DELETE FROM part_names WHERE id = $1`, [t.partNameId]);
  });
});

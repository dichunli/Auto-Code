/* 重复车辆现状分析（2026-08-27，只读，不写任何数据）
   用途：为"清理重复 VIN/车牌 → 上唯一锁"生成处理清单。
   输出：每组重复的各条记录详情（创建时间、客户、工单数、保养提醒数），供人工拍板。 */
const fs = require("fs");
const env = {};
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  /* 1. 拉全部车辆的 id/vin/plate_number/customer_id/created_at（Supabase 单页上限1000，循环拉全量） */
  const vehicles = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("vehicles")
      .select("id, vin, plate_number, customer_id, created_at, brand, model")
      .range(from, from + 999);
    if (error) { console.error("查询失败:", error.message); process.exit(1); }
    vehicles.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }

  const 规范化vin = (v) => (v || "").trim().toUpperCase();
  const 规范化车牌 = (v) => (v || "").trim().toUpperCase();

  /* 2. VIN 分组找重复（非空） */
  const vin组 = new Map();
  for (const v of vehicles) {
    const vin = 规范化vin(v.vin);
    if (!vin) continue;
    if (!vin组.has(vin)) vin组.set(vin, []);
    vin组.get(vin).push(v);
  }
  const 重复vin组 = [...vin组.entries()].filter(([, list]) => list.length > 1);

  /* 3. 车牌分组找重复 */
  const 牌组 = new Map();
  for (const v of vehicles) {
    const p = 规范化车牌(v.plate_number);
    if (!p) continue;
    if (!牌组.has(p)) 牌组.set(p, []);
    牌组.get(p).push(v);
  }
  const 重复牌组 = [...牌组.entries()].filter(([, list]) => list.length > 1);

  console.log(`车辆总数: ${vehicles.length}`);
  console.log(`重复VIN组数: ${重复vin组.length}（8-13明细为44组）`);
  console.log(`重复车牌组数: ${重复牌组.length}（8-13明细为2组）`);

  /* 4. 收集重复组涉及的车辆 id，查各自工单数/保养提醒数/客户名 */
  const 涉及车辆ids = [...new Set([...重复vin组, ...重复牌组].flatMap(([, l]) => l.map((v) => v.id)))];
  const 涉及客户ids = [...new Set([...重复vin组, ...重复牌组].flatMap(([, l]) => l.map((v) => v.customer_id).filter(Boolean)))];

  const 工单数 = new Map(), 提醒数 = new Map(), 客户名 = new Map();
  if (涉及车辆ids.length > 0) {
    const { data: 工单 } = await sb.from("work_orders").select("vehicle_id").in("vehicle_id", 涉及车辆ids);
    for (const w of 工单 || []) 工单数.set(w.vehicle_id, (工单数.get(w.vehicle_id) || 0) + 1);
    const { data: 提醒 } = await sb.from("maintenance_reminders").select("vehicle_id").in("vehicle_id", 涉及车辆ids);
    for (const r of 提醒 || []) 提醒数.set(r.vehicle_id, (提醒数.get(r.vehicle_id) || 0) + 1);
  }
  if (涉及客户ids.length > 0) {
    const { data: 客户 } = await sb.from("customers").select("id, name, phone").in("id", 涉及客户ids);
    for (const c of 客户 || []) 客户名.set(c.id, `${c.name}(${c.phone || "无电话"})`);
  }

  function 打印组(标签, 组们) {
    console.log(`\n========== ${标签} ==========`);
    let 序号 = 0;
    for (const [键, list] of 组们) {
      序号++;
      console.log(`\n【组${序号}】${键} —— ${list.length} 条记录`);
      /* 排序：工单多的在前（建议保留的一般是工单多的那条） */
      list.sort((a, b) => (工单数.get(b.id) || 0) - (工单数.get(a.id) || 0));
      for (const v of list) {
        console.log(
          `  ${v.id.slice(0, 8)}… | 建:${(v.created_at || "").slice(0, 10)} | 客户:${客户名.get(v.customer_id) || "无"} | 工单:${工单数.get(v.id) || 0} | 提醒:${提醒数.get(v.id) || 0} | ${v.brand || ""} ${v.model || ""}`
        );
      }
    }
  }
  打印组("重复 VIN 组", 重复vin组);
  打印组("重复车牌组", 重复牌组);
})();

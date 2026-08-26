/* 体检配套探测脚本（2026-08-21）：检查 8 月中下旬迁移是否已在数据库执行。
   覆盖 check-rpc-exists.js 的盲区：
     A. 0821 运单豁免迁移的 7 个新列（purchase_orders / purchase_order_items）
     B. woip_rpc 6 个函数（代码动态拼接调用，grep 抓不到）
     C. 0820 到货单批次的新表和新函数
     D. 0820 其他新函数（revoke_purchase_item_to_pending / settle_waybill_freight）
   原理：函数都有登录兜底——用 service key（无用户上下文）调用，
   函数存在则返回"未登录"业务错；不存在则报 PGRST202。不会写任何数据。 */
const fs = require("fs");
const env = {};
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const Z = "00000000-0000-0000-0000-000000000000";

/* B+D：函数探测清单（参数名必须与迁移文件完全一致，否则 PGRST202 误报） */
const 函数们 = {
  // woip_rpc（migrations_20260819_woip_rpc.sql）——工单配件行操作全靠它们
  delete_part_branch: { p_part_id: Z },
  delete_part_group: { p_part_id: Z },
  add_work_order_item_parts: { p_item_id: Z, p_parts: [] },
  add_part_branch: { p_source_part_id: Z },
  select_part_branch: { p_part_id: Z },
  set_part_purchase_flag: { p_part_id: Z, p_flag: "x", p_value: false },
  // 0820 到货单批次（migrations_20260820_arrival_*.sql）
  create_arrival_receipt: { p_waybill_id: Z, p_supplier_id: Z, p_supplier_order_no: "x", p_photos: [] },
  handle_arrival_item: { p_arrival_item_id: Z, p_handle_action: "x", p_received_qty: 1, p_warehouse_id: Z, p_location: "x", p_evidence_photos: [], p_set_evidence: false },
  add_arrival_extra_item: { p_arrival_id: Z, p_part_name: "x", p_part_id: Z, p_received_qty: 1, p_handling: "x", p_warehouse_id: Z, p_location: "x", p_photos: [] },
  delete_arrival_extra_item: { p_arrival_item_id: Z },
  confirm_arrival_receipt: { p_arrival_id: Z },
  complete_arrival_inbound: { p_arrival_id: Z, p_freight_amount: 0, p_operator_id: Z },
  // 0820 其他（revoke_item_to_pending / logistics_freight_payable）
  revoke_purchase_item_to_pending: { p_order_id: Z, p_item_id: Z, p_operator_id: Z },
  settle_waybill_freight: { p_waybill_id: Z },
};

/* C：0820 批次新建的表 */
const 表们 = ["arrival_receipts", "arrival_receipt_items"];

(async () => {
  console.log("========== A. 0821 运单豁免迁移（新列） ==========");
  const { error: e1 } = await sb.from("purchase_orders").select("waybill_exempt,exempt_freight,exempt_note").limit(1);
  console.log(e1 ? "  ❌ purchase_orders 豁免三列不存在：" + e1.message : "  ✅ purchase_orders 豁免三列已存在");
  const { error: e2 } = await sb.from("purchase_order_items").select("waybill_id,waybill_exempt,exempt_freight,exempt_note").limit(1);
  console.log(e2 ? "  ❌ purchase_order_items 运单关联+豁免四列不存在：" + e2.message : "  ✅ purchase_order_items 运单关联+豁免四列已存在");

  console.log("\n========== C. 0820 到货单批次（新表） ==========");
  for (const 表 of 表们) {
    const { error } = await sb.from(表).select("id").limit(1);
    console.log(error ? `  ❌ 表 ${表} 不存在：${error.message}` : `  ✅ 表 ${表} 已存在`);
  }

  console.log("\n========== C2. 0816 考核照片自检计分（新列） ==========");
  const { error: e3 } = await sb.from("behavior_score_items").select("guide_images").limit(1);
  console.log(e3 ? "  ❌ behavior_score_items.guide_images 不存在：" + e3.message : "  ✅ behavior_score_items.guide_images 已存在");
  const { error: e4 } = await sb.from("behavior_check_records").select("review_score_record_id").limit(1);
  console.log(e4 ? "  ❌ behavior_check_records.review_score_record_id 不存在：" + e4.message : "  ✅ behavior_check_records.review_score_record_id 已存在");

  console.log("\n========== B+D. 函数存在性 ==========");
  const 存在 = [], 缺失 = [];
  for (const [名, 参] of Object.entries(函数们)) {
    const { error } = await sb.rpc(名, 参);
    if (error && error.code === "PGRST202") 缺失.push(名);
    else 存在.push(名 + (error ? `（存在，业务报错: ${String(error.message).slice(0, 30)}）` : "（存在）"));
  }
  console.log("=== 已存在 (" + 存在.length + ") ===");
  存在.forEach((x) => console.log("  ✅ " + x));
  console.log("=== 不存在 (" + 缺失.length + ") ===");
  缺失.forEach((x) => console.log("  ❌ " + x));
})();

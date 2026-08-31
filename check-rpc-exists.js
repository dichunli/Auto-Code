/* 临时探测脚本：检查采购事务化迁移的 15 个 RPC 函数是否已在数据库中存在。
   原理：函数都有登录兜底——用 service key（无用户上下文）调用，函数存在则报"未登录/无权限"业务错；
   不存在则报 PGRST202。所有函数是事务且第一行就校验登录，不会写任何数据。 */
const fs = require("fs");
const env = {};
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const Z = "00000000-0000-0000-0000-000000000000";
const 函数们 = {
  complete_purchase_inbound: { p_purchase_order_id: Z, p_items: [], p_freight_amount: 0, p_operator_id: Z },
  create_purchase_orders: { p_orders: [], p_staging_ids: [], p_operator_id: Z },
  create_purchase_return_orders: { p_groups: [], p_operator_id: Z },
  delete_purchase_item: { p_order_id: Z, p_item_id: Z, p_operator_id: Z },
  receive_purchase_item: { p_order_id: Z, p_item_id: Z, p_handle_action: "normal", p_received_qty: 1, p_evidence_photos: [], p_set_evidence: false },
  receive_purchase_item_partial: { p_order_id: Z, p_item_id: Z, p_qty: 1, p_operator_id: Z },
  revoke_pending_storage: { p_purchase_order_id: Z, p_operator_id: Z },
  revoke_purchase_receipt: { p_order_id: Z, p_item_id: Z, p_operator_id: Z },
  revoke_supplier_returns: { p_record_ids: [], p_operator_id: Z },
  save_supplier_full: { p_supplier: {}, p_contacts: [], p_category_ids: [], p_part_name_ids: [], p_brand_ids: [], p_vehicle_model_ids: [], p_operator_id: Z },
  revoke_completed_inbound: { p_purchase_order_id: Z, p_operator_id: Z },
  revoke_purchase_return_order: { p_record_id: Z, p_operator_id: Z },
  reset_outsource_finance: { p_order_no: "x", p_supplier_id: Z, p_amount: 0, p_paid: false, p_operator_id: Z },
  cancel_purchase_order: { p_purchase_order_id: Z, p_mode: "revoke", p_operator_id: Z },
  complete_return_record: { p_record_id: Z, p_operator_id: Z },
};

(async () => {
  const 存在 = [], 缺失 = [];
  for (const [名, 参] of Object.entries(函数们)) {
    const { error } = await sb.rpc(名, 参);
    if (error && error.code === "PGRST202") 缺失.push(名);
    else 存在.push(名 + (error ? `（报错: ${String(error.message).slice(0, 40)}）` : "（居然成功了?!）"));
  }
  console.log("=== 已存在 (" + 存在.length + ") ===");
  存在.forEach((x) => console.log("  ✅ " + x));
  console.log("=== 不存在 (" + 缺失.length + ") ===");
  缺失.forEach((x) => console.log("  ❌ " + x));
})();

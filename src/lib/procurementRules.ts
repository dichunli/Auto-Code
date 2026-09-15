/* ═══════════════════════════════════════════════════════════
 * 采购域业务规则（全站唯一口径，2026-09-15 诊断第1批收敛）
 *
 * 背景：这些规则曾复制多份且注释自认"与 XXX 原样一致"：
 *   - 状态过滤：PartBranchStatusList.行符合本阶段 ↔ procurement/page 两处内联
 *   - 待采购谓词：PendingPurchaseList.行符合待采购 ↔ procurement/page 内联
 *   - 供应商打分/匹配原因：PartBranchEditor ↔ PartBranchStatusList
 *   - 查询字段串：PendingReceiptList ↔ procurement/page
 * 复制必然漂移，全部收进本文件；命中判定所需的数据适配（名称比对还是
 * ID 比对）留在调用点，这里只收"规则本身"：谓词、权重、文案。
 * ═══════════════════════════════════════════════════════════ */

/* ────────────────── 一、工单配件行的流程状态谓词 ────────────────── */

/* 结构化输入：只要给得出这些字段的行都能判（各列表页的行类型不同，
   字段全部可选，调用点直接传行对象即可，TS 结构类型自动兼容） */
export interface 分支行状态输入 {
  work_order_items?: {
    work_orders?: {
      settled_at?: string | null;
      order_type?: string | null;
    } | null;
  } | null;
  is_purchased?: boolean | null;
  is_arrived?: boolean | null;
  unit_cost?: number | null;
  unit_price?: number | null;
  customer_opinion?: string | null;
  part_id?: string | null;
  parts?: { quantity?: number | null } | null;
}

/* 基础门禁：已结算/作废/保养单/已采购/已到货 的行不进采购流程各阶段 */
export function 行可进采购流程(r: 分支行状态输入): boolean {
  const wo = r.work_order_items?.work_orders;
  if (!wo) return false;
  if (wo.settled_at) return false;
  if (wo.order_type === "cancelled") return false;
  /* 保养单不走询价/报价等采购流程（用户定的规则） */
  if (wo.order_type === "maintenance") return false;
  if (r.is_purchased || r.is_arrived) return false;
  return true;
}

/* 待询价：还没填成本价 */
export function 行符合待询价(r: 分支行状态输入): boolean {
  if (!行可进采购流程(r)) return false;
  return Number(r.unit_cost || 0) <= 0;
}

/* 待报价：有成本价，还没填销售价 */
export function 行符合待报价(r: 分支行状态输入): boolean {
  if (!行可进采购流程(r)) return false;
  return Number(r.unit_cost || 0) > 0 && Number(r.unit_price || 0) <= 0;
}

/* 待确认：价格都填了，客户还没表态 */
export function 行符合待确认(r: 分支行状态输入): boolean {
  if (!行可进采购流程(r)) return false;
  const opinion = r.customer_opinion || "pending";
  return Number(r.unit_cost || 0) > 0 && Number(r.unit_price || 0) > 0 && opinion === "pending";
}

export type 采购阶段 = "pending_inquiry" | "pending_quote" | "pending_confirm";

/* 按阶段分派（PartBranchStatusList / procurement 页的状态过滤用） */
export function 行符合采购阶段(r: 分支行状态输入, status: 采购阶段 | string): boolean {
  if (!行可进采购流程(r)) return false;
  if (status === "pending_inquiry") return Number(r.unit_cost || 0) <= 0;
  if (status === "pending_quote") return Number(r.unit_cost || 0) > 0 && Number(r.unit_price || 0) <= 0;
  if (status === "pending_confirm") {
    return Number(r.unit_cost || 0) > 0 && Number(r.unit_price || 0) > 0 && (r.customer_opinion || "pending") === "pending";
  }
  return false;
}

/* 待采购：价格齐全、已采购/已到货另行排除，且关联库存没货才要采购
   （注意：只适用于工单配件行；自定义采购暂存行无工单，不走此谓词） */
export function 行符合待采购(r: 分支行状态输入): boolean {
  const wo = r.work_order_items?.work_orders;
  if (!wo) return false;
  if (wo.settled_at) return false;
  if (wo.order_type === "cancelled") return false;
  /* 保养单不走采购流程 */
  if (wo.order_type === "maintenance") return false;
  const cost = Number(r.unit_cost || 0);
  const price = Number(r.unit_price || 0);
  if (cost <= 0 || price <= 0) return false;
  const inventoryQty = Number(r.parts?.quantity || 0);
  if (r.part_id && inventoryQty > 0) return false;
  return true;
}

/* ────────────────── 二、供应商推荐打分与匹配原因 ────────────────── */

/* 分值权重（全站唯一口径，改排序只改这里） */
export const 供应商分值 = {
  车型匹配: 1000,
  配件匹配: 500,
  分类匹配: 200,
  品牌匹配: 200,
  推荐等级每星: 10,
} as const;

/* 命中判定结果（名称比对/ID 比对的适配在调用点做，这里只收结果） */
export interface 供应商命中输入 {
  车型命中?: boolean;
  配件命中?: boolean;
  分类命中?: boolean;
  品牌命中?: boolean;
  推荐等级?: number | null;
}

export function 计算供应商得分(命中: 供应商命中输入): number {
  let score = 0;
  if (命中.车型命中) score += 供应商分值.车型匹配;
  if (命中.配件命中) score += 供应商分值.配件匹配;
  if (命中.分类命中) score += 供应商分值.分类匹配;
  if (命中.品牌命中) score += 供应商分值.品牌匹配;
  score += (命中.推荐等级 || 0) * 供应商分值.推荐等级每星;
  return score;
}

/* 匹配原因文案。opts.车型描述：命中时拼"匹配车型:厂商-品牌-车系"；
   opts.带星级：推荐等级 > 0 时追加 "⭐"×n（PartBranchStatusList 的口径） */
export function 供应商匹配原因(
  命中: 供应商命中输入,
  opts: { 车型描述?: string; 带星级?: boolean } = {}
): string[] {
  const reasons: string[] = [];
  if (命中.车型命中) {
    reasons.push(opts.车型描述 ? `匹配车型:${opts.车型描述}` : "匹配车型");
  }
  if (命中.配件命中) reasons.push("匹配配件");
  if (命中.分类命中) reasons.push("匹配分类");
  if (命中.品牌命中) reasons.push("匹配品牌");
  if (opts.带星级 && 命中.推荐等级 && 命中.推荐等级 > 0) {
    reasons.push("⭐".repeat(命中.推荐等级));
  }
  return reasons;
}

/* ────────────────── 三、配件分组键（PartBranchStatusList 分组用） ────────────────── */

export interface 分组行输入 {
  name?: string | null;
  supplier_name?: string | null;
  part_names?: { part_categories?: { name?: string | null } | null } | null;
  work_order_items?: {
    work_orders?: { vehicles?: { plate_number?: string | null } | null } | null;
  } | null;
}

export function 配件分组键(
  row: 分组行输入,
  groupBy: "plate" | "category" | "name" | "supplier" | string
): string {
  if (groupBy === "plate") return row.work_order_items?.work_orders?.vehicles?.plate_number || "(无车牌)";
  if (groupBy === "category") return row.part_names?.part_categories?.name || "(未分类)";
  if (groupBy === "name") return row.name || "(未命名)";
  if (groupBy === "supplier") return row.supplier_name || "(未指定供应商)";
  return "";
}

/* ────────────────── 四、查询字段串（select 口径唯一来源） ────────────────── */

/* 待收货明细字段（原 PendingReceiptList.明细查询字段） */
export const 采购明细查询字段 = `
  id, name, brand, specification, quantity, unit_cost, received_qty,
  part_id, work_order_item_part_id, part_number, supplier_part_name,
  unit, category, license_plate, photos, notes, handle_action,
  discount_amount, evidence_photos, return_reason, waybill_id, waybill_exempt,
  staged_qty, staged_action, staged_at, staged_by,
  logistics_waybills:waybill_id(
    id, tracking_no, logistics_company_name, freight_amount, cod_amount, status,
    logistics_companies(name)
  )
`;

/* 待收货整单字段（原 PendingReceiptList.待收货查询字段；procurement 页桌面端同口径） */
export const 待收货查询字段 = `
  id, order_no, supplier_id, status, total_amount, notes, waybill_id, waybill_exempt, created_at, logistics_company_id,
  supplier_order_no, supplier_order_amount, supplier_slip_photos,
  suppliers(id, name, region, phone),
  logistics_companies:logistics_company_id(name),
  purchase_order_items(${采购明细查询字段}),
  logistics_waybills:waybill_id(
    id, tracking_no, logistics_company_name, freight_amount, cod_amount, status,
    logistics_companies(name)
  )
`;

/* 待采购整行字段（原 PendingPurchaseList.待采购查询字段） */
export const 待采购查询字段 = `
  id, name, brand, specification, unit, quantity, unit_cost, unit_price,
  customer_opinion, supplier_name, part_id, part_number, part_name_id,
  alias_name, notes, purchase_reason, work_order_item_id, document_name,
  work_order_items(
    name,
    work_orders(
      id, order_no, settled_at, order_type,
      customers(name, phone),
      vehicles(plate_number, vin)
    )
  ),
  parts(quantity)
`;

/* ═══════════════════════════════════════════════════════════
 * 领域类型（全站唯一口径，2026-09-15 诊断第5批收敛）
 *
 * 背景：这些类型曾各文件重复定义（PurchaseOrder 6 份且字段漂移、
 * Profile 12 份、Supplier 10 份、PurchaseOrderItem 6 份、
 * 操作结果 7 份逐字相同），重复必然漂移，全部收进本文件。
 * 原则：这里放"数据库行/通用返回"的共享结构，取各份的字段并集；
 * 页面特有的扩展字段留在页面文件里用 extends 继承，不强塞进公共类型。
 * ═══════════════════════════════════════════════════════════ */

/* Server Action / RPC 的统一返回结构（原 7 个 actions.ts 逐字重复） */
export interface 操作结果 {
  success: boolean;
  error?: string;
}

/* 员工（原 12 份：最小核心就这两个字段；
   需要分组/角色/等级等扩展的页面用 extends 加，见 WorkOrdersContent） */
export interface Profile {
  id: string;
  full_name?: string | null;
}

/* 供应商（原 10 份：核心 id+name，扩展字段可选并集） */
export interface Supplier {
  id: string;
  name: string;
  recommendation_level?: number | null;
  region?: string | null;
  phone?: string | null;
}

/* 物流运单（原 PendingReceiptList 本地定义） */
export interface Waybill {
  id: string;
  tracking_no: string;
  logistics_company_name: string | null;
  supplier_name: string | null;
  freight_amount: number | null;
  cod_amount: number | null;
  status: string;
  logistics_companies: { name: string } | null;
}

/* 入库单（原 CompletedStorageList 本地定义） */
export interface InboundOrder {
  id: string;
  inbound_no: string;
  total_quantity: number;
  total_amount: number | null;
  created_at: string;
}

/* 采购明细行（原 6 份，取字段并集：
   核心 20 列各份一致；暂存/运单/批次/到货单关联为各流程扩展，全可选） */
export interface PurchaseOrderItem {
  id: string;
  name: string;
  brand: string | null;
  specification: string | null;
  quantity: number;
  unit_cost: number | null;
  received_qty: number | null;
  part_id: string | null;
  work_order_item_part_id: string | null;
  part_number: string | null;
  supplier_part_name: string | null;
  unit: string | null;
  category: string | null;
  license_plate: string | null;
  photos: string[] | null;
  notes: string | null;
  handle_action: string | null;
  discount_amount: number | null;
  evidence_photos: string[] | null;
  return_reason: string | null;
  /* 配件级运单关联/豁免（待收货） */
  waybill_id?: string | null;
  waybill_exempt?: boolean | null;
  /* 收货暂存（2026-09-04）：确认收货先暂存不入账，手动提交统一入账 */
  staged_qty?: number | null;
  staged_action?: string | null;
  staged_at?: string | null;
  /* 暂存操作人（提交核对弹窗显示收货人） */
  staged_by?: string | null;
  /* 配件级运单详情（已暂存区顶部显示关联运单） */
  logistics_waybills?: Waybill | null;
  /* 到货确认单/收货批次关联（待入库排除用，黄卡流程不走按单入库） */
  arrival_item_id?: string | null;
  receiving_batch_id?: string | null;
  /* 库存配件快照（已入库列表显示条码 + 当前库存数，quantity 为 NULL 表示故意留空） */
  parts?: { barcode: string | null; quantity: number | null } | null;
}

/* 采购单（原 6 份，核心各份一致，扩展可选并集） */
export interface PurchaseOrder {
  id: string;
  order_no: string | null;
  supplier_id: string | null;
  status: string;
  total_amount: number | null;
  notes: string | null;
  created_at: string;
  suppliers: { id: string; name: string; region?: string | null; phone?: string | null } | null;
  purchase_order_items: PurchaseOrderItem[];
  /* 整单运单（待收货） */
  waybill_id?: string | null;
  waybill_exempt?: boolean | null;
  logistics_company_id?: string | null;
  logistics_companies?: { name: string } | null;
  logistics_waybills?: Waybill | null;
  /* 供应商销售单（收货对账用） */
  supplier_order_no?: string | null;
  supplier_order_amount?: number | null;
  supplier_slip_photos?: string[] | null;
  /* 已入库列表的入库单 */
  inbound_orders?: InboundOrder[] | null;
}

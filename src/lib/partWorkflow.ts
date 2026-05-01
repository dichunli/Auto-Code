export type PartWorkflowStatus =
  | "pending_inquiry"
  | "pending_quote"
  | "pending_confirm"
  | "pending_purchase"
  | "pending_receipt"
  | "pending_inbound"
  | "pending_picking"
  | "returned"
  | "supplier_return"
  | "picked";

export interface PartWorkflowContext {
  unit_cost: number | null;
  unit_price: number | null;
  customer_opinion: string | null;
  is_purchased: boolean;
  is_arrived: boolean;
  part_id: string | null;
  quantity: number;
  inventoryQty: number;
  pickedQty: number;
  hasReturnRecords: boolean;
  hasPendingSupplierReturn: boolean;
}

export function getPartWorkflowStatus(ctx: PartWorkflowContext): PartWorkflowStatus {
  if (ctx.hasPendingSupplierReturn) return "supplier_return";
  if (ctx.pickedQty >= ctx.quantity) return "picked";
  if (ctx.hasReturnRecords && ctx.pickedQty === 0) return "returned";

  if (!ctx.unit_cost) return "pending_inquiry";
  if (ctx.unit_cost && !ctx.unit_price) return "pending_quote";
  if (ctx.unit_price && ctx.customer_opinion === "pending") return "pending_confirm";

  if (ctx.customer_opinion === "agree") {
    if (!ctx.is_purchased) {
      if (ctx.part_id && ctx.inventoryQty > 0) return "pending_picking";
      return "pending_purchase";
    }
    if (ctx.is_purchased && !ctx.is_arrived) return "pending_receipt";
    if (ctx.is_arrived && !ctx.part_id) return "pending_inbound";
    if (ctx.is_arrived && ctx.part_id) return "pending_picking";
  }

  // customer_opinion === 'reject' or other fallback
  return "pending_confirm";
}

export const WORKFLOW_STATUS_LABELS: Record<PartWorkflowStatus, string> = {
  pending_inquiry: "待询价",
  pending_quote: "待报价",
  pending_confirm: "待确认",
  pending_purchase: "待采购",
  pending_receipt: "待收货",
  pending_inbound: "待入库",
  pending_picking: "待领料",
  returned: "退库",
  supplier_return: "退货",
  picked: "已领料",
};

export const WORKFLOW_STATUS_COLORS: Record<PartWorkflowStatus, string> = {
  pending_inquiry: "bg-gray-50 text-gray-600 border-gray-200",
  pending_quote: "bg-yellow-50 text-yellow-700 border-yellow-200",
  pending_confirm: "bg-blue-50 text-blue-700 border-blue-200",
  pending_purchase: "bg-orange-50 text-orange-700 border-orange-200",
  pending_receipt: "bg-indigo-50 text-indigo-700 border-indigo-200",
  pending_inbound: "bg-teal-50 text-teal-700 border-teal-200",
  pending_picking: "bg-purple-50 text-purple-700 border-purple-200",
  returned: "bg-red-50 text-red-700 border-red-200",
  supplier_return: "bg-rose-50 text-rose-700 border-rose-200",
  picked: "bg-green-50 text-green-700 border-green-200",
};

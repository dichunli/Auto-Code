import { createClient } from "@/lib/supabase/server";
import { getStatusLabel } from "@/lib/utils";
import { getPartWorkflowStatus } from "@/lib/partWorkflow";
import Link from "next/link";

export default async function DashboardPage() {
  const supabase = await createClient();

  // 1. 工单状态统计
  const { data: orderStatusCounts } = await supabase
    .from("work_orders")
    .select("status")
    .not("status", "in", "(settled,delivered)");

  const orderCounts: Record<string, number> = {};
  orderStatusCounts?.forEach((o: any) => {
    orderCounts[o.status] = (orderCounts[o.status] || 0) + 1;
  });

  const orderStatusList = [
    { key: "pending_diagnosis", label: "待诊断" },
    { key: "pending_repair", label: "待维修" },
    { key: "repairing", label: "维修中" },
    { key: "pending_quality_check", label: "待质检" },
    { key: "pending_close", label: "待结单" },
    { key: "pending_settlement", label: "待结算" },
  ];

  // 2. 配件状态统计（只查最近 200 条未完成的配件分支）
  const { data: parts } = await supabase
    .from("work_order_item_parts")
    .select("id, unit_cost, unit_price, customer_opinion, is_purchased, is_arrived, part_id, quantity, work_order_item_id")
    .order("created_at", { ascending: false })
    .limit(500);

  const partIds = parts?.map((p: any) => p.id) || [];
  const relatedPartIds = parts?.map((p: any) => p.part_id).filter(Boolean) || [];

  const [{ data: pickingRecords }, { data: returnRecords }, { data: supplierReturnRecords }, { data: partBatches }] =
    await Promise.all([
      supabase.from("part_picking_records").select("work_order_item_part_id, quantity").in("work_order_item_part_id", partIds),
      supabase.from("part_return_records").select("work_order_item_part_id, quantity").in("work_order_item_part_id", partIds),
      supabase.from("supplier_return_records").select("work_order_item_part_id, status").in("work_order_item_part_id", partIds),
      relatedPartIds.length > 0
        ? supabase.from("part_batches").select("part_id, quantity").in("part_id", relatedPartIds)
        : Promise.resolve({ data: [] }),
    ]);

  const inventoryByPart: Record<string, number> = {};
  partBatches?.forEach((b: any) => {
    inventoryByPart[b.part_id] = (inventoryByPart[b.part_id] || 0) + b.quantity;
  });

  const pickingByPart: Record<string, number> = {};
  pickingRecords?.forEach((r: any) => {
    pickingByPart[r.work_order_item_part_id] = (pickingByPart[r.work_order_item_part_id] || 0) + r.quantity;
  });

  const returnByPart: Record<string, number> = {};
  returnRecords?.forEach((r: any) => {
    returnByPart[r.work_order_item_part_id] = (returnByPart[r.work_order_item_part_id] || 0) + r.quantity;
  });

  const pendingSupplierReturnByPart: Record<string, boolean> = {};
  supplierReturnRecords?.forEach((r: any) => {
    if (r.status === "pending") pendingSupplierReturnByPart[r.work_order_item_part_id] = true;
  });

  const partStatusCounts: Record<string, number> = {};
  parts?.forEach((p: any) => {
    const pPickedQty = pickingByPart[p.id] || 0;
    const pReturnQty = returnByPart[p.id] || 0;
    const pNetPicked = pPickedQty - pReturnQty;
    const pInventory = inventoryByPart[p.part_id] || 0;
    const pHasPendingSupplierReturn = pendingSupplierReturnByPart[p.id] || false;

    const status = getPartWorkflowStatus({
      unit_cost: p.unit_cost,
      unit_price: p.unit_price,
      customer_opinion: p.customer_opinion,
      is_purchased: p.is_purchased,
      is_arrived: p.is_arrived,
      part_id: p.part_id,
      quantity: p.quantity,
      inventoryQty: pInventory,
      pickedQty: pNetPicked,
      hasReturnRecords: pReturnQty > 0,
      hasPendingSupplierReturn: pHasPendingSupplierReturn,
    });

    partStatusCounts[status] = (partStatusCounts[status] || 0) + 1;
  });

  const partStatusList = [
    { key: "pending_inquiry", label: "待询价" },
    { key: "pending_quote", label: "待报价" },
    { key: "pending_confirm", label: "待确认" },
    { key: "pending_purchase", label: "待采购" },
    { key: "pending_receipt", label: "待收货" },
    { key: "pending_inbound", label: "待入库" },
    { key: "pending_picking", label: "待领料" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-gray-900 mb-1">工作台</h1>
        <p className="text-sm text-gray-500">待办事项提醒与快捷入口</p>
      </div>

      {/* 工单状态提醒 */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">工单状态提醒</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          {orderStatusList.map((s) => {
            const count = orderCounts[s.key] || 0;
            return (
              <Link
                key={s.key}
                href={`/work-orders?status=${s.key}`}
                className="relative bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow"
              >
                {count > 0 && (
                  <span className="absolute -top-2 -right-2 min-w-[20px] h-5 px-1 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                    {count > 99 ? "99+" : count}
                  </span>
                )}
                <div className="text-sm text-gray-500">{s.label}</div>
                <div className="text-2xl font-bold text-gray-900 mt-1">{count}</div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* 配件状态提醒 */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">配件状态提醒</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {partStatusList.map((s) => {
            const count = partStatusCounts[s.key] || 0;
            return (
              <Link
                key={s.key}
                href={`/work-orders/part-board?status=${s.key}`}
                className="relative bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow"
              >
                {count > 0 && (
                  <span className="absolute -top-2 -right-2 min-w-[20px] h-5 px-1 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                    {count > 99 ? "99+" : count}
                  </span>
                )}
                <div className="text-sm text-gray-500">{s.label}</div>
                <div className="text-2xl font-bold text-gray-900 mt-1">{count}</div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* 快捷入口 */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">快捷入口</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Link
            href="/work-orders/new"
            className="bg-blue-50 text-blue-700 rounded-xl border border-blue-100 p-4 text-sm font-medium hover:bg-blue-100 transition-colors"
          >
            + 新建工单
          </Link>
          <Link
            href="/work-orders/board"
            className="bg-purple-50 text-purple-700 rounded-xl border border-purple-100 p-4 text-sm font-medium hover:bg-purple-100 transition-colors"
          >
            维修看板
          </Link>
        </div>
      </section>
    </div>
  );
}

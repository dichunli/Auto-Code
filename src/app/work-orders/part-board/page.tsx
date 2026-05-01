import { createClient } from "@/lib/supabase/server";
import { getPartWorkflowStatus, WORKFLOW_STATUS_LABELS, type PartWorkflowStatus } from "@/lib/partWorkflow";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";

export default async function PartBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: filterStatus } = await searchParams;
  const supabase = await createClient();

  const { data: parts } = await supabase
    .from("work_order_item_parts")
    .select(`
      id, unit_cost, unit_price, customer_opinion, is_purchased, is_arrived, part_id, quantity,
      name, alias_name, part_number, brand,
      work_order_items(id, name, work_order_id, work_orders(id, order_no, vehicles(plate_number))),
      part_names(name, unit),
      parts(name, part_brands(name))
    `)
    .order("created_at", { ascending: false })
    .limit(300);

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

  const partStatusList = [
    { key: "pending_inquiry", label: "待询价" },
    { key: "pending_quote", label: "待报价" },
    { key: "pending_confirm", label: "待确认" },
    { key: "pending_purchase", label: "待采购" },
    { key: "pending_receipt", label: "待收货" },
    { key: "pending_inbound", label: "待入库" },
    { key: "pending_picking", label: "待领料" },
    { key: "returned", label: "退库" },
    { key: "supplier_return", label: "退货" },
    { key: "picked", label: "已领料" },
  ];

  const processedParts = (parts || []).map((p: any) => {
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

    return { ...p, status };
  }).filter((p: any) => !filterStatus || p.status === filterStatus);

  return (
    <div>
      <PageHeader
        title="配件状态看板"
        description={filterStatus ? `筛选: ${WORKFLOW_STATUS_LABELS[filterStatus as PartWorkflowStatus] || filterStatus}` : "所有配件分支状态一览"}
      />

      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        <Link
          href="/work-orders/part-board"
          className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
            !filterStatus ? "bg-blue-600 text-white" : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
          }`}
        >
          全部
        </Link>
        {partStatusList.map((s) => (
          <Link
            key={s.key}
            href={`/work-orders/part-board?status=${s.key}`}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              filterStatus === s.key
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">配件</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">数量</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">所属工单</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">车辆</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {processedParts.map((p: any) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="font-medium text-gray-900">
                      {p.alias_name || p.parts?.name || p.name || p.part_names?.name || "未命名"}
                    </div>
                    {(p.brand || p.parts?.part_brands?.name) && (
                      <div className="text-xs text-gray-500">品牌: {p.brand || p.parts?.part_brands?.name}</div>
                    )}
                    {p.part_number && (
                      <div className="text-xs text-gray-400">编号: {p.part_number}</div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                      p.status === 'pending_inquiry' ? 'bg-gray-50 text-gray-600 border-gray-200' :
                      p.status === 'pending_quote' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                      p.status === 'pending_confirm' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                      p.status === 'pending_purchase' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                      p.status === 'pending_receipt' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                      p.status === 'pending_inbound' ? 'bg-teal-50 text-teal-700 border-teal-200' :
                      p.status === 'pending_picking' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                      p.status === 'returned' ? 'bg-red-50 text-red-700 border-red-200' :
                      p.status === 'supplier_return' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                      'bg-green-50 text-green-700 border-green-200'
                    }`}>
                      {WORKFLOW_STATUS_LABELS[p.status as PartWorkflowStatus] || p.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{p.quantity} {p.part_names?.unit || "个"}</td>
                  <td className="px-6 py-4">
                    <Link
                      href={`/work-orders/${p.work_order_items?.work_orders?.id}`}
                      className="text-blue-600 hover:text-blue-700 font-medium"
                    >
                      {p.work_order_items?.work_orders?.order_no || "-"}
                    </Link>
                    <div className="text-xs text-gray-500">项目: {p.work_order_items?.name}</div>
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {p.work_order_items?.work_orders?.vehicles?.plate_number || "-"}
                  </td>
                </tr>
              ))}
              {processedParts.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-400">
                    暂无配件数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

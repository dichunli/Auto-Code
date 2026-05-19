import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

interface InboundOrderItem {
  id: string;
  part_number: string | null;
  name: string | null;
  brand: string | null;
  specification: string | null;
  unit: string | null;
  quantity: number;
  unit_cost: number | null;
  allocated_cost: number | null;
  batch_no: string | null;
  notes: string | null;
  warehouse_id: string | null;
  location: string | null;
  warehouses: { name: string } | null;
}

interface InboundOrder {
  id: string;
  inbound_no: string;
  supplier_name: string | null;
  total_quantity: number;
  total_amount: number | null;
  freight_amount: number | null;
  status: string;
  notes: string | null;
  created_at: string;
  purchase_orders: { id: string; order_no: string | null } | null;
  profiles: { full_name: string | null } | null;
}

interface InventoryLog {
  id: string;
  change_qty: number;
  type: string;
  notes: string | null;
  created_at: string;
  parts: { name: string | null } | null;
}

export default async function InboundOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("inbound_orders")
    .select(
      "id, inbound_no, supplier_name, total_quantity, total_amount, freight_amount, status, notes, created_at, purchase_orders(id, order_no), profiles(full_name)"
    )
    .eq("id", id)
    .single();

  if (!order) notFound();

  const { data: items } = await supabase
    .from("inbound_order_items")
    .select("id, part_number, name, brand, specification, unit, quantity, unit_cost, allocated_cost, batch_no, notes, warehouse_id, location, warehouses(name)")
    .eq("inbound_order_id", id)
    .order("created_at", { ascending: true });

  const { data: logs } = await supabase
    .from("inventory_logs")
    .select("id, change_qty, type, notes, created_at, parts(name)")
    .eq("reference_type", "inbound_order")
    .eq("reference_id", id)
    .order("created_at", { ascending: true });

  const inboundOrder = order as unknown as InboundOrder;
  const inboundItems = (items || []) as unknown as InboundOrderItem[];
  const inventoryLogs = (logs || []) as unknown as InventoryLog[];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link href="/inbound-orders" className="text-sm text-blue-600 hover:text-blue-700">
          ← 返回入库单列表
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="px-3 py-1.5 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          打印
        </button>
      </div>

      {/* 打印专用页头 */}
      <div className="hidden print:block text-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">入库单</h1>
        <p className="text-sm text-gray-500 mt-1">{inboundOrder.inbound_no}</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6 print:border-black print:rounded-none">
        <div className="px-6 py-4 border-b border-gray-100 print:border-black">
          <h1 className="text-lg font-bold text-gray-900 print:hidden">入库单详情</h1>
        </div>
        <div className="px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs text-gray-500">入库单号</div>
            <div className="font-medium text-gray-900">{inboundOrder.inbound_no}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">关联采购单</div>
            <div className="font-medium text-gray-900">
              {inboundOrder.purchase_orders ? (
                <Link
                  href={`/procurement/${inboundOrder.purchase_orders.id}`}
                  className="text-blue-600 hover:text-blue-700"
                >
                  {inboundOrder.purchase_orders.order_no || inboundOrder.purchase_orders.id.slice(0, 8)}
                </Link>
              ) : (
                "-"
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">供应商</div>
            <div className="font-medium text-gray-900">{inboundOrder.supplier_name || "-"}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">状态</div>
            <div className="font-medium text-gray-900">
              <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700">
                {inboundOrder.status === "completed" ? "已完成" : inboundOrder.status}
              </span>
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">总数量</div>
            <div className="font-medium text-gray-900">{inboundOrder.total_quantity}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">总金额</div>
            <div className="font-medium text-gray-900">
              {inboundOrder.total_amount != null ? `¥${inboundOrder.total_amount.toFixed(2)}` : "-"}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">运费</div>
            <div className="font-medium text-gray-900">
              {inboundOrder.freight_amount != null ? `¥${inboundOrder.freight_amount.toFixed(2)}` : "-"}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">操作人</div>
            <div className="font-medium text-gray-900">{inboundOrder.profiles?.full_name || "-"}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">日期</div>
            <div className="font-medium text-gray-900">
              {new Date(inboundOrder.created_at).toLocaleString("zh-CN")}
            </div>
          </div>
          {inboundOrder.notes && (
            <div className="col-span-2 md:col-span-4">
              <div className="text-xs text-gray-500">备注</div>
              <div className="font-medium text-gray-900">{inboundOrder.notes}</div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-900">入库明细</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500 w-10">序号</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">商品名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">零件编码</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">品牌</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">规格</th>
                <th className="px-6 py-3 text-right font-medium text-gray-500">数量</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">单位</th>
                <th className="px-6 py-3 text-right font-medium text-gray-500">单价</th>
                <th className="px-6 py-3 text-right font-medium text-gray-500">分摊运费</th>
                <th className="px-6 py-3 text-right font-medium text-gray-500">成本价</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">批次号</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">仓库</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">仓位</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">备注</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {inboundItems.map((it, idx) => {
                const unitCost = it.unit_cost || 0;
                const allocCost = it.allocated_cost || 0;
                const finalCost = unitCost + allocCost;
                return (
                  <tr key={it.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-gray-500">{idx + 1}</td>
                    <td className="px-6 py-4 text-gray-900 font-medium">{it.name || "-"}</td>
                    <td className="px-6 py-4 text-gray-600">{it.part_number || "-"}</td>
                    <td className="px-6 py-4 text-gray-600">{it.brand || "-"}</td>
                    <td className="px-6 py-4 text-gray-600">{it.specification || "-"}</td>
                    <td className="px-6 py-4 text-right text-gray-900">{it.quantity}</td>
                    <td className="px-6 py-4 text-gray-600">{it.unit || "-"}</td>
                    <td className="px-6 py-4 text-right text-gray-900">
                      {it.unit_cost != null ? `¥${it.unit_cost.toFixed(2)}` : "-"}
                    </td>
                    <td className="px-6 py-4 text-right text-gray-600">
                      {allocCost > 0 ? `¥${allocCost.toFixed(2)}` : "-"}
                    </td>
                    <td className="px-6 py-4 text-right text-gray-900 font-medium">
                      {finalCost > 0 ? `¥${finalCost.toFixed(2)}` : "-"}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{it.batch_no || "-"}</td>
                    <td className="px-6 py-4 text-gray-600">{it.warehouses?.name || "-"}</td>
                    <td className="px-6 py-4 text-gray-600">{it.location || "-"}</td>
                    <td className="px-6 py-4 text-gray-600">{it.notes || "-"}</td>
                  </tr>
                );
              })}
              {inboundItems.length === 0 && (
                <tr>
                  <td colSpan={14} className="px-6 py-8 text-center text-gray-400">
                    暂无入库明细
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 打印专用签字栏 */}
      <div className="hidden print:block mt-8 pt-8 border-t border-black">
        <div className="grid grid-cols-3 gap-8 text-sm">
          <div>
            <div className="text-gray-500 mb-8">收货人签字：</div>
            <div className="border-b border-gray-400 h-6"></div>
          </div>
          <div>
            <div className="text-gray-500 mb-8">验收人签字：</div>
            <div className="border-b border-gray-400 h-6"></div>
          </div>
          <div>
            <div className="text-gray-500 mb-8">日期：</div>
            <div className="border-b border-gray-400 h-6"></div>
          </div>
        </div>
      </div>

      {inventoryLogs.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mt-6 print:hidden">
          <div className="px-6 py-3 border-b border-gray-100 bg-gray-50">
            <h3 className="text-sm font-semibold text-gray-900">库存变动记录</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left font-medium text-gray-500 w-10">序号</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">配件名称</th>
                  <th className="px-6 py-3 text-right font-medium text-gray-500">变动数量</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">类型</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">备注</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {inventoryLogs.map((log, idx) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-gray-500">{idx + 1}</td>
                    <td className="px-6 py-4 text-gray-900">{log.parts?.name || "-"}</td>
                    <td className="px-6 py-4 text-right text-gray-900 font-medium">
                      {log.change_qty > 0 ? `+${log.change_qty}` : log.change_qty}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{log.type}</td>
                    <td className="px-6 py-4 text-gray-600">{log.notes || "-"}</td>
                    <td className="px-6 py-4 text-gray-500 text-xs">
                      {new Date(log.created_at).toLocaleString("zh-CN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

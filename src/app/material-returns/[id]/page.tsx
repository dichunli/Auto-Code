import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { 退料类型标签 } from "@/lib/returnTypes";

interface 退料单明细 {
  id: string;
  part_number: string | null;
  name: string | null;
  brand: string | null;
  specification: string | null;
  unit: string | null;
  batch_no: string | null;
  unit_cost: number | null;
  quantity: number;
  return_type: string | null;
}

interface 退料单 {
  id: string;
  return_no: string;
  status: string;
  total_quantity: number;
  return_type: string | null;
  reason: string | null;
  notes: string | null;
  created_at: string;
  work_orders: {
    id: string;
    order_no: string;
    vehicles: { plate_number: string } | null;
    customers: { name: string } | null;
  } | null;
  picking_orders: { id: string; picking_no: string } | null;
  profiles: { full_name: string | null } | null;
}

export default async function MaterialReturnDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("material_return_orders")
    .select(
      "id, return_no, status, total_quantity, return_type, reason, notes, created_at, work_orders(id, order_no, vehicles(plate_number), customers(name)), picking_orders(id, picking_no), profiles(full_name)"
    )
    .eq("id", id)
    .single();

  if (!order) notFound();

  const { data: items } = await supabase
    .from("material_return_order_items")
    .select("id, part_number, name, brand, specification, unit, batch_no, unit_cost, quantity, return_type")
    .eq("return_order_id", id)
    .order("created_at", { ascending: true });

  const 退料单 = order as unknown as 退料单;
  const 明细 = (items || []) as unknown as 退料单明细[];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link href="/material-returns" className="text-sm text-blue-600 hover:text-blue-700">
          ← 返回退料单列表
        </Link>
        <PrintButton />
      </div>

      {/* 打印专用页头 */}
      <div className="hidden print:block text-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">退料单</h1>
        <p className="text-sm text-gray-500 mt-1">{退料单.return_no}</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6 print:border-black print:rounded-none">
        <div className="px-6 py-4 border-b border-gray-100 print:border-black">
          <h1 className="text-lg font-bold text-gray-900 print:hidden">退料单详情</h1>
        </div>
        <div className="px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs text-gray-500">退料单号</div>
            <div className="font-medium text-gray-900">{退料单.return_no}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">关联工单</div>
            <div className="font-medium text-gray-900">
              {退料单.work_orders ? (
                <Link
                  href={`/work-orders/${退料单.work_orders.id}`}
                  className="text-blue-600 hover:text-blue-700 print:text-black print:no-underline"
                >
                  {退料单.work_orders.order_no}
                </Link>
              ) : (
                "-"
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">车牌号</div>
            <div className="font-medium text-gray-900">
              {退料单.work_orders?.vehicles?.plate_number || "-"}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">客户</div>
            <div className="font-medium text-gray-900">
              {退料单.work_orders?.customers?.name || "-"}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">关联领料单</div>
            <div className="font-medium text-gray-900">
              {退料单.picking_orders ? (
                <Link
                  href={`/picking-orders/${退料单.picking_orders.id}`}
                  className="text-blue-600 hover:text-blue-700 print:text-black print:no-underline"
                >
                  {退料单.picking_orders.picking_no}
                </Link>
              ) : (
                "-"
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">总数量</div>
            <div className="font-medium text-gray-900">{退料单.total_quantity}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">退料类型</div>
            <div className="font-medium text-gray-900">
              {(退料单.return_type && 退料类型标签[退料单.return_type]) || 退料单.return_type || "-"}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">操作人</div>
            <div className="font-medium text-gray-900">{退料单.profiles?.full_name || "-"}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">日期</div>
            <div className="font-medium text-gray-900">
              {new Date(退料单.created_at).toLocaleString("zh-CN")}
            </div>
          </div>
          {退料单.reason && (
            <div className="col-span-2">
              <div className="text-xs text-gray-500">退料原因</div>
              <div className="font-medium text-gray-900">{退料单.reason}</div>
            </div>
          )}
          {退料单.notes && (
            <div className="col-span-2">
              <div className="text-xs text-gray-500">备注</div>
              <div className="font-medium text-gray-900">{退料单.notes}</div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden print:border-black print:rounded-none">
        <div className="px-6 py-3 border-b border-gray-100 bg-gray-50 print:bg-white print:border-black">
          <h3 className="text-sm font-semibold text-gray-900">退料明细</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 print:bg-white">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500 w-10">序号</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">配件名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">零件编码</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">品牌</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">批次号</th>
                <th className="px-6 py-3 text-right font-medium text-gray-500">数量</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">单位</th>
                <th className="px-6 py-3 text-right font-medium text-gray-500">成本价</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">退料类型</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {明细.map((it, idx) => (
                <tr key={it.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-gray-500">{idx + 1}</td>
                  <td className="px-6 py-4 text-gray-900 font-medium">{it.name || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{it.part_number || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{it.brand || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{it.batch_no || "-"}</td>
                  <td className="px-6 py-4 text-right text-gray-900">{it.quantity}</td>
                  <td className="px-6 py-4 text-gray-600">{it.unit || "-"}</td>
                  <td className="px-6 py-4 text-right text-gray-900">
                    {it.unit_cost != null ? `¥${it.unit_cost.toFixed(2)}` : "-"}
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {(it.return_type && 退料类型标签[it.return_type]) || it.return_type || "-"}
                  </td>
                </tr>
              ))}
              {明细.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-6 py-8 text-center text-gray-400">
                    暂无退料明细
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
            <div className="text-gray-500 mb-8">退料人签字：</div>
            <div className="border-b border-gray-400 h-6"></div>
          </div>
          <div>
            <div className="text-gray-500 mb-8">仓库签收：</div>
            <div className="border-b border-gray-400 h-6"></div>
          </div>
          <div>
            <div className="text-gray-500 mb-8">日期：</div>
            <div className="border-b border-gray-400 h-6"></div>
          </div>
        </div>
      </div>
    </div>
  );
}

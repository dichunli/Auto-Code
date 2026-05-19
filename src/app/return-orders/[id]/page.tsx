import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

interface ReturnOrderItem {
  id: string;
  part_number: string | null;
  name: string | null;
  brand: string | null;
  specification: string | null;
  quantity: number;
  return_reason: string | null;
  unit_cost: number | null;
  notes: string | null;
}

interface ReturnOrder {
  id: string;
  return_no: string;
  supplier_name: string | null;
  total_quantity: number;
  status: string;
  logistics_company: string | null;
  tracking_no: string | null;
  return_shipping_fee: number | null;
  shipping_fee_payer: string | null;
  notes: string | null;
  created_at: string;
  profiles: { full_name: string | null } | null;
}

const returnReasonMap: Record<string, string> = {
  wrong_ship: "错发",
  excess: "多发退货",
  damaged: "损坏",
  cancel: "客户悔单",
  quality: "质量问题",
};

export default async function ReturnOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("purchase_return_orders")
    .select(
      "id, return_no, supplier_name, total_quantity, status, logistics_company, tracking_no, return_shipping_fee, shipping_fee_payer, notes, created_at, profiles(full_name)"
    )
    .eq("id", id)
    .single();

  if (!order) notFound();

  const { data: items } = await supabase
    .from("purchase_return_order_items")
    .select("id, part_number, name, brand, specification, quantity, return_reason, unit_cost, notes")
    .eq("return_order_id", id)
    .order("created_at", { ascending: true });

  const returnOrder = order as unknown as ReturnOrder;
  const returnItems = (items || []) as unknown as ReturnOrderItem[];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link href="/return-orders" className="text-sm text-blue-600 hover:text-blue-700">
          ← 返回采退单列表
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
        <h1 className="text-2xl font-bold text-gray-900">采退单</h1>
        <p className="text-sm text-gray-500 mt-1">{returnOrder.return_no}</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6 print:border-black print:rounded-none">
        <div className="px-6 py-4 border-b border-gray-100 print:border-black">
          <h1 className="text-lg font-bold text-gray-900 print:hidden">采退单详情</h1>
        </div>
        <div className="px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs text-gray-500">采退单号</div>
            <div className="font-medium text-gray-900">{returnOrder.return_no}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">供应商</div>
            <div className="font-medium text-gray-900">{returnOrder.supplier_name || "-"}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">状态</div>
            <div className="font-medium text-gray-900">
              <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700">
                {returnOrder.status === "completed" ? "已完成" : returnOrder.status}
              </span>
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">总数量</div>
            <div className="font-medium text-gray-900">{returnOrder.total_quantity}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">物流公司</div>
            <div className="font-medium text-gray-900">{returnOrder.logistics_company || "-"}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">运单号</div>
            <div className="font-medium text-gray-900">{returnOrder.tracking_no || "-"}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">退货运费</div>
            <div className="font-medium text-gray-900">
              {returnOrder.return_shipping_fee != null ? `¥${returnOrder.return_shipping_fee.toFixed(2)}` : "-"}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">运费支付方</div>
            <div className="font-medium text-gray-900">
              {returnOrder.shipping_fee_payer === "self"
                ? "我方承担"
                : returnOrder.shipping_fee_payer === "supplier"
                ? "供应商承担"
                : "-"}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">操作人</div>
            <div className="font-medium text-gray-900">{returnOrder.profiles?.full_name || "-"}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">日期</div>
            <div className="font-medium text-gray-900">
              {new Date(returnOrder.created_at).toLocaleString("zh-CN")}
            </div>
          </div>
          {returnOrder.notes && (
            <div className="col-span-2 md:col-span-4">
              <div className="text-xs text-gray-500">备注</div>
              <div className="font-medium text-gray-900">{returnOrder.notes}</div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-900">退货明细</h3>
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
                <th className="px-6 py-3 text-left font-medium text-gray-500">退货原因</th>
                <th className="px-6 py-3 text-right font-medium text-gray-500">成本价</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">备注</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {returnItems.map((it, idx) => (
                <tr key={it.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-gray-500">{idx + 1}</td>
                  <td className="px-6 py-4 text-gray-900 font-medium">{it.name || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{it.part_number || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{it.brand || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{it.specification || "-"}</td>
                  <td className="px-6 py-4 text-right text-gray-900">{it.quantity}</td>
                  <td className="px-6 py-4 text-gray-600">
                    {returnReasonMap[it.return_reason || ""] || it.return_reason || "-"}
                  </td>
                  <td className="px-6 py-4 text-right text-gray-900">
                    {it.unit_cost != null ? `¥${it.unit_cost.toFixed(2)}` : "-"}
                  </td>
                  <td className="px-6 py-4 text-gray-600">{it.notes || "-"}</td>
                </tr>
              ))}
              {returnItems.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-6 py-8 text-center text-gray-400">
                    暂无退货明细
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
            <div className="text-gray-500 mb-8">退货人签字：</div>
            <div className="border-b border-gray-400 h-6"></div>
          </div>
          <div>
            <div className="text-gray-500 mb-8">审核人签字：</div>
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

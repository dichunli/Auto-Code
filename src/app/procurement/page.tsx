import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";

const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  submitted: "已提交",
  approved: "已审批",
  partial_received: "部分收货",
  fully_received: "全部收货",
  cancelled: "已取消",
};

const STATUS_CLASS: Record<string, string> = {
  draft: "bg-gray-50 text-gray-600",
  submitted: "bg-blue-50 text-blue-700",
  approved: "bg-purple-50 text-purple-700",
  partial_received: "bg-yellow-50 text-yellow-700",
  fully_received: "bg-green-50 text-green-700",
  cancelled: "bg-red-50 text-red-600",
};

export default async function ProcurementPage() {
  const supabase = await createClient();
  const { data: orders } = await supabase
    .from("purchase_orders")
    .select("*, suppliers(name), purchase_order_items(count)")
    .order("created_at", { ascending: false });

  return (
    <div>
      <PageHeader
        title="采购订单"
        description="管理配件采购、收货与入库"
        action={{ href: "/procurement/new", label: "新建采购单" }}
      />

      <div className="flex flex-wrap gap-2 mb-6">
        <Link
          href="/suppliers"
          className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          供应商管理
        </Link>
        <Link
          href="/inventory/in"
          className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          入库登记
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">订单号</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">供应商</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">总金额</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">备注</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">创建时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orders?.map((o: any) => (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <Link href={`/procurement/${o.id}`} className="font-medium text-blue-600 hover:text-blue-700">
                      {o.order_no || o.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{o.suppliers?.name || "-"}</td>
                  <td className="px-6 py-4">
                    <span className={`text-xs px-2 py-0.5 rounded ${STATUS_CLASS[o.status] || "bg-gray-50 text-gray-600"}`}>
                      {STATUS_LABELS[o.status] || o.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-900">
                    {o.total_amount != null ? `¥${o.total_amount.toFixed(2)}` : "-"}
                  </td>
                  <td className="px-6 py-4 text-gray-500">{o.notes || "-"}</td>
                  <td className="px-6 py-4 text-gray-500">
                    {new Date(o.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {(!orders || orders.length === 0) && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                    暂无采购订单
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

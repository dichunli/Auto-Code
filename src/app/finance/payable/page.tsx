import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatDate } from "@/lib/utils";

export default async function PayablePage() {
  const supabase = await createClient();

  const { data: items } = await supabase
    .from("accounts_payable")
    .select("*, suppliers(name, contact), purchase_orders(order_no, total_amount)")
    .order("created_at", { ascending: false });

  const statusMap: Record<string, { label: string; class: string }> = {
    pending: { label: "待付款", class: "bg-yellow-50 text-yellow-700" },
    partial: { label: "部分付款", class: "bg-blue-50 text-blue-700" },
    paid: { label: "已结清", class: "bg-green-50 text-green-700" },
    cancelled: { label: "已取消", class: "bg-gray-50 text-gray-600" },
  };

  const totalAmount = items?.reduce((sum, r) => sum + (r.amount || 0), 0) || 0;
  const totalPaid = items?.reduce((sum, r) => sum + (r.paid_amount || 0), 0) || 0;
  const totalPending = totalAmount - totalPaid;

  return (
    <div className="space-y-6">
      <PageHeader title="应付账款" description="管理供应商采购未付款项" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">应付总额</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(totalAmount)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">已付金额</div>
          <div className="text-xl font-bold text-green-600 mt-1">{formatCurrency(totalPaid)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">未付金额</div>
          <div className="text-xl font-bold text-red-600 mt-1">{formatCurrency(totalPending)}</div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">供应商</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">采购单</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">应付金额</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">已付金额</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">未付金额</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">到期日</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">备注</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items?.map((r: any) => {
                const s = statusMap[r.status] || { label: r.status, class: "bg-gray-50 text-gray-600" };
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{r.suppliers?.name || "-"}</div>
                      <div className="text-xs text-gray-500">{r.suppliers?.contact || "-"}</div>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{r.purchase_orders?.order_no || "-"}</td>
                    <td className="px-6 py-4 font-medium text-gray-900">{formatCurrency(r.amount)}</td>
                    <td className="px-6 py-4 text-green-600">{formatCurrency(r.paid_amount)}</td>
                    <td className="px-6 py-4 text-red-600 font-medium">{formatCurrency(r.amount - r.paid_amount)}</td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2 py-0.5 rounded ${s.class}`}>{s.label}</span>
                    </td>
                    <td className="px-6 py-4 text-gray-500">{r.due_date ? formatDate(r.due_date) : "-"}</td>
                    <td className="px-6 py-4 text-gray-500">{r.notes || "-"}</td>
                  </tr>
                );
              })}
              {(!items || items.length === 0) && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-400">暂无应付账款</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

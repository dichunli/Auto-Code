import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";

/* 应收记录（含关联客户与工单） */
interface 应收记录 {
  id: string;
  status: string;
  amount: number | null;
  paid_amount: number | null;
  due_date: string | null;
  notes: string | null;
  customers: { name: string | null; phone: string | null } | null;
  work_orders: { order_no: string | null; total_cost: number | null } | null;
}

export default async function ReceivablePage({ searchParams }: { searchParams?: Promise<{ page?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();

  /* 列表分页（每页 50 条，数据库层取数）；
   * 汇总卡片需要全量总额——单独查一趟只取两个金额列（不带关联、不带其他字段），数据量很小 */
  const page = Math.max(1, parseInt(params?.page || "1", 10) || 1);
  const pageSize = 50;
  const from = (page - 1) * pageSize;

  const [{ data: items, count }, { data: 金额行 }] = await Promise.all([
    supabase
      .from("accounts_receivable")
      .select("*, customers(name, phone), work_orders(order_no, total_cost)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1),
    supabase.from("accounts_receivable").select("amount, paid_amount"),
  ]);

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / pageSize));

  const statusMap: Record<string, { label: string; class: string }> = {
    pending: { label: "待收款", class: "bg-yellow-50 text-yellow-700" },
    partial: { label: "部分收款", class: "bg-blue-50 text-blue-700" },
    paid: { label: "已结清", class: "bg-green-50 text-green-700" },
    cancelled: { label: "已取消", class: "bg-gray-50 text-gray-600" },
  };

  const totalAmount = 金额行?.reduce((sum, r) => sum + (r.amount || 0), 0) || 0;
  const totalPaid = 金额行?.reduce((sum, r) => sum + (r.paid_amount || 0), 0) || 0;
  const totalPending = totalAmount - totalPaid;

  return (
    <div className="space-y-6">
      <PageHeader title="应收账款" description="管理客户未结清的维修款项" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">应收总额</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(totalAmount)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">已收金额</div>
          <div className="text-xl font-bold text-green-600 mt-1">{formatCurrency(totalPaid)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">未收金额</div>
          <div className="text-xl font-bold text-red-600 mt-1">{formatCurrency(totalPending)}</div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">客户</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">工单</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">应收金额</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">已收金额</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">未收金额</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">到期日</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">备注</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items?.map((r: 应收记录) => {
                const s = statusMap[r.status] || { label: r.status, class: "bg-gray-50 text-gray-600" };
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{r.customers?.name || "-"}</div>
                      <div className="text-xs text-gray-500">{r.customers?.phone || "-"}</div>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{r.work_orders?.order_no || "-"}</td>
                    <td className="px-6 py-4 font-medium text-gray-900">{formatCurrency(r.amount)}</td>
                    <td className="px-6 py-4 text-green-600">{formatCurrency(r.paid_amount)}</td>
                    <td className="px-6 py-4 text-red-600 font-medium">{formatCurrency((r.amount ?? 0) - (r.paid_amount ?? 0))}</td>
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
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-400">暂无应收账款</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 分页 */}
      <div className="flex items-center justify-center gap-2">
        <Link
          href={`/finance/receivable?page=${Math.max(1, page - 1)}`}
          className={`px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 ${page <= 1 ? "pointer-events-none opacity-50" : ""}`}
        >
          上一页
        </Link>
        <span className="text-sm text-gray-600 px-2">
          {page} / {totalPages}（共 {count ?? 0} 条）
        </span>
        <Link
          href={`/finance/receivable?page=${Math.min(totalPages, page + 1)}`}
          className={`px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 ${page >= totalPages ? "pointer-events-none opacity-50" : ""}`}
        >
          下一页
        </Link>
      </div>
    </div>
  );
}

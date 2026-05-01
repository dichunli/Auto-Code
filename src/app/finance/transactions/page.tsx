import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";

export default async function TransactionsPage({ searchParams }: { searchParams?: Promise<{ type?: string; account?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("finance_transactions")
    .select("*, finance_accounts(name), finance_categories(name), profiles(full_name)")
    .order("transaction_date", { ascending: false });

  if (params?.type) query = query.eq("type", params.type);
  if (params?.account) query = query.eq("account_id", params.account);

  const { data: transactions } = await query;
  const { data: accounts } = await supabase.from("finance_accounts").select("id, name").eq("is_active", true);

  return (
    <div>
      <PageHeader
        title="收支流水"
        description="查看和管理所有资金收支记录"
        action={{ href: "/finance/transactions/new", label: "记一笔" }}
      />

      <div className="flex flex-wrap gap-2 mb-6">
        <Link
          href="/finance/transactions"
          className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${!params?.type ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}
        >
          全部
        </Link>
        <Link
          href="/finance/transactions?type=income"
          className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${params?.type === "income" ? "bg-green-50 text-green-700 border-green-200" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}
        >
          收入
        </Link>
        <Link
          href="/finance/transactions?type=expense"
          className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${params?.type === "expense" ? "bg-red-50 text-red-700 border-red-200" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}
        >
          支出
        </Link>
        {accounts?.map((a: any) => (
          <Link
            key={a.id}
            href={`/finance/transactions?account=${a.id}`}
            className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${params?.account === a.id ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}
          >
            {a.name}
          </Link>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">日期</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">类型</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">分类</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">账户</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">金额</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">备注</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">记录人</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {transactions?.map((t: any) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-gray-600">{formatDate(t.transaction_date)}</td>
                  <td className="px-6 py-4">
                    <span className={`text-xs px-2 py-0.5 rounded ${t.type === "income" ? "bg-green-50 text-green-700" : t.type === "expense" ? "bg-red-50 text-red-700" : "bg-gray-50 text-gray-600"}`}>
                      {t.type === "income" ? "收入" : t.type === "expense" ? "支出" : "转账"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{t.finance_categories?.name || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{t.finance_accounts?.name || "-"}</td>
                  <td className={`px-6 py-4 font-medium ${t.type === "income" ? "text-green-600" : "text-red-600"}`}>
                    {t.type === "income" ? "+" : "-"}{formatCurrency(t.amount)}
                  </td>
                  <td className="px-6 py-4 text-gray-500">{t.description || "-"}</td>
                  <td className="px-6 py-4 text-gray-500">{t.profiles?.full_name || "-"}</td>
                </tr>
              ))}
              {(!transactions || transactions.length === 0) && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-400">
                    暂无收支记录
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

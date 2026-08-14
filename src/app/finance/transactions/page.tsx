import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";

interface 账户 {
  id: string;
  name: string;
}

interface 交易记录 {
  id: string;
  type: string;
  amount: number;
  description: string | null;
  transaction_date: string;
  finance_accounts: { name: string } | null;
  finance_categories: { name: string } | null;
  profiles: { full_name: string } | null;
}

export default async function TransactionsPage({ searchParams }: { searchParams?: Promise<{ type?: string; account?: string; page?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();

  /* 分页：流水会随时间不断增长，数据库层分页，每页 50 条 */
  const page = Math.max(1, parseInt(params?.page || "1", 10) || 1);
  const pageSize = 50;

  let query = supabase
    .from("finance_transactions")
    .select("*, finance_accounts(name), finance_categories(name), profiles(full_name)", { count: "exact" })
    .order("transaction_date", { ascending: false });

  if (params?.type) query = query.eq("type", params.type);
  if (params?.account) query = query.eq("account_id", params.account);

  const from = (page - 1) * pageSize;
  const { data: transactions, count } = await query.range(from, from + pageSize - 1);
  const { data: accounts } = await supabase.from("finance_accounts").select("id, name").eq("is_active", true);

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / pageSize));

  /* 翻页链接保留当前筛选条件 */
  function 翻页链接(目标页: number) {
    const p = new URLSearchParams();
    if (params?.type) p.set("type", params.type);
    if (params?.account) p.set("account", params.account);
    p.set("page", String(目标页));
    return `/finance/transactions?${p.toString()}`;
  }

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
        {accounts?.map((a: 账户) => (
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
              {transactions?.map((t: 交易记录) => (
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

      {/* 分页 */}
      <div className="flex items-center justify-center gap-2 mt-4">
        <Link
          href={翻页链接(Math.max(1, page - 1))}
          className={`px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 ${page <= 1 ? "pointer-events-none opacity-50" : ""}`}
        >
          上一页
        </Link>
        <span className="text-sm text-gray-600 px-2">
          {page} / {totalPages}（共 {count ?? 0} 条）
        </span>
        <Link
          href={翻页链接(Math.min(totalPages, page + 1))}
          className={`px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 ${page >= totalPages ? "pointer-events-none opacity-50" : ""}`}
        >
          下一页
        </Link>
      </div>
    </div>
  );
}

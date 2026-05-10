import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";

export default async function FinancePage() {
  const supabase = await createClient();

  const { data: accounts } = await supabase
    .from("finance_accounts")
    .select("id, name, account_type, balance")
    .eq("is_active", true)
    .order("name");

  const today = new Date().toISOString().split("T")[0];
  const { data: todayIncome } = await supabase
    .from("finance_transactions")
    .select("amount")
    .eq("type", "income")
    .gte("transaction_date", today)
    .lte("transaction_date", today);

  const { data: todayExpense } = await supabase
    .from("finance_transactions")
    .select("amount")
    .eq("type", "expense")
    .gte("transaction_date", today)
    .lte("transaction_date", today);

  const { data: arSummary } = await supabase
    .from("accounts_receivable")
    .select("status, amount, paid_amount");

  const { data: apSummary } = await supabase
    .from("accounts_payable")
    .select("status, amount, paid_amount");

  const totalBalance = accounts?.reduce((sum, a) => sum + (a.balance || 0), 0) || 0;
  const totalIncome = todayIncome?.reduce((sum, t) => sum + (t.amount || 0), 0) || 0;
  const totalExpense = todayExpense?.reduce((sum, t) => sum + (t.amount || 0), 0) || 0;

  const arTotal = arSummary?.reduce((sum, r) => sum + (r.amount || 0), 0) || 0;
  const arPaid = arSummary?.reduce((sum, r) => sum + (r.paid_amount || 0), 0) || 0;
  const apTotal = apSummary?.reduce((sum, r) => sum + (r.amount || 0), 0) || 0;
  const apPaid = apSummary?.reduce((sum, r) => sum + (r.paid_amount || 0), 0) || 0;

  const recentTransactions = await supabase
    .from("finance_transactions")
    .select("id, type, amount, description, transaction_date, finance_accounts(name), finance_categories(name)")
    .order("transaction_date", { ascending: false })
    .limit(5);

  return (
    <div className="space-y-6">
      <PageHeader
        title="财务管理"
        description="资金账户、收支流水、应收应付与工资管理"
      />

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">账户总余额</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(totalBalance)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">今日收入</div>
          <div className="text-xl font-bold text-green-600 mt-1">{formatCurrency(totalIncome)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">今日支出</div>
          <div className="text-xl font-bold text-red-600 mt-1">{formatCurrency(totalExpense)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">今日净额</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(totalIncome - totalExpense)}</div>
        </div>
      </div>

      {/* 应收应付 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">应收账款</h3>
            <Link href="/finance/receivable" className="text-sm text-blue-600 hover:underline">查看全部</Link>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">应收总额</span>
              <span className="font-medium text-gray-900">{formatCurrency(arTotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">已收金额</span>
              <span className="font-medium text-green-600">{formatCurrency(arPaid)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">未收金额</span>
              <span className="font-medium text-red-600">{formatCurrency(arTotal - arPaid)}</span>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">应付账款</h3>
            <Link href="/finance/payable" className="text-sm text-blue-600 hover:underline">查看全部</Link>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">应付总额</span>
              <span className="font-medium text-gray-900">{formatCurrency(apTotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">已付金额</span>
              <span className="font-medium text-green-600">{formatCurrency(apPaid)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">未付金额</span>
              <span className="font-medium text-red-600">{formatCurrency(apTotal - apPaid)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 账户列表 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">资金账户</h3>
          <Link href="/finance/transactions" className="text-sm text-blue-600 hover:underline">收支流水</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">账户名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">账户类型</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">当前余额</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {accounts?.map((a: any) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{a.name}</td>
                  <td className="px-6 py-4 text-gray-600">{a.account_type}</td>
                  <td className="px-6 py-4 font-medium text-gray-900">{formatCurrency(a.balance)}</td>
                </tr>
              ))}
              {(!accounts || accounts.length === 0) && (
                <tr>
                  <td colSpan={3} className="px-6 py-8 text-center text-gray-400">暂无账户</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 最近收支 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">最近收支</h3>
          <Link href="/finance/transactions/new" className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors">记一笔</Link>
        </div>
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
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recentTransactions.data?.map((t: any) => (
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
                </tr>
              ))}
              {(!recentTransactions.data || recentTransactions.data.length === 0) && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-400">暂无收支记录</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 快捷入口 */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Link href="/finance/transactions/new" className="bg-blue-50 text-blue-700 rounded-xl border border-blue-100 p-4 text-sm font-medium hover:bg-blue-100 transition-colors text-center">
          + 记一笔
        </Link>
        <Link href="/finance/transactions" className="bg-gray-50 text-gray-700 rounded-xl border border-gray-100 p-4 text-sm font-medium hover:bg-gray-100 transition-colors text-center">
          收支流水
        </Link>
        <Link href="/finance/payroll" className="bg-gray-50 text-gray-700 rounded-xl border border-gray-100 p-4 text-sm font-medium hover:bg-gray-100 transition-colors text-center">
          工资提成
        </Link>
        <Link href="/supplier-transactions" className="bg-gray-50 text-gray-700 rounded-xl border border-gray-100 p-4 text-sm font-medium hover:bg-gray-100 transition-colors text-center">
          供应商往来
        </Link>
        <Link href="/reports" className="bg-purple-50 text-purple-700 rounded-xl border border-purple-100 p-4 text-sm font-medium hover:bg-purple-100 transition-colors text-center">
          报表统计
        </Link>
      </div>
    </div>
  );
}

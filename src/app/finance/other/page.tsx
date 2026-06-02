import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/utils";
import Link from "next/link";
import { DeleteButton } from "./DeleteButton";
import { MonthSelector } from "./MonthSelector";

interface 其它收支 {
  id: string;
  type: string;
  amount: number;
  counterparty: string | null;
  transaction_date: string;
  notes: string | null;
  images: string[] | null;
  operator_id: string | null;
  profiles: { full_name: string } | null;
  other_payment_methods: { name: string } | null;
  other_transaction_categories: { name: string } | null;
}

export default async function OtherTransactionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  /* 默认显示当月 */
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const month = params?.month || defaultMonth;

  /* 计算当月实际起止日期 */
  const [yearStr, monthStr] = month.split("-");
  const yearNum = parseInt(yearStr, 10);
  const monthNum = parseInt(monthStr, 10);
  const startDate = `${month}-01`;
  const endDay = new Date(yearNum, monthNum, 0).getDate();
  const endDate = `${month}-${String(endDay).padStart(2, "0")}`;

  const { data: userData } = await supabase.auth.getUser();
  const currentUserId = userData.user?.id;

  const { data: rows } = await supabase
    .from("other_transactions")
    .select("*, profiles(full_name), other_payment_methods(name), other_transaction_categories(name)")
    .gte("transaction_date", startDate)
    .lte("transaction_date", endDate)
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false });

  const items = (rows || []) as unknown as 其它收支[];

  const incomeTotal = items
    .filter((i) => i.type === "income")
    .reduce((s, i) => s + (i.amount || 0), 0);
  const expenseTotal = items
    .filter((i) => i.type === "expense")
    .reduce((s, i) => s + (i.amount || 0), 0);

  /* 生成年月选项（最近12个月） */
  const monthOptions: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthOptions.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  return (
    <div>
      <PageHeader
        title="其它收支"
        description="随手记录日常费用支出和其他收入"
        action={{ href: "/finance/other/new", label: "记一笔" }}
      />

      {/* 快捷入口 */}
      <div className="flex gap-3 mb-4">
        <Link
          href="/finance/other-categories"
          className="text-sm text-blue-600 hover:underline"
        >
          其它收支分类
        </Link>
        <Link
          href="/finance/other/payment-methods"
          className="text-sm text-blue-600 hover:underline"
        >
          收款方式管理
        </Link>
        <Link
          href="/finance/other/stats"
          className="text-sm text-blue-600 hover:underline"
        >
          统计查询
        </Link>
      </div>

      {/* 月份筛选 + 汇总 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 space-y-4">
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-500">月份</label>
          <form className="flex-1">
            <MonthSelector monthOptions={monthOptions} defaultValue={month} />
          </form>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-xs text-gray-500">收入</div>
            <div className="text-lg font-bold text-green-600">{formatCurrency(incomeTotal)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-500">支出</div>
            <div className="text-lg font-bold text-red-600">{formatCurrency(expenseTotal)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-500">净额</div>
            <div className={`text-lg font-bold ${incomeTotal - expenseTotal >= 0 ? "text-green-600" : "text-red-600"}`}>
              {formatCurrency(incomeTotal - expenseTotal)}
            </div>
          </div>
        </div>
      </div>

      {/* 列表 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">日期</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">类型</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">原因</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">金额</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">账户</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">收款/付款人</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">记录人</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">备注</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-600">{item.transaction_date}</td>
                  <td className="px-4 py-3">
                    {item.type === "income" ? (
                      <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700">收入</span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-700">支出</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">{item.other_transaction_categories?.name || "-"}</td>
                  <td className={`px-4 py-3 font-medium ${item.type === "income" ? "text-green-600" : "text-red-600"}`}>
                    {item.type === "income" ? "+" : "-"}{formatCurrency(item.amount)}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{item.other_payment_methods?.name || "-"}</td>
                  <td className="px-4 py-3 text-gray-600">{item.counterparty || "-"}</td>
                  <td className="px-4 py-3 text-gray-600">{item.profiles?.full_name || "-"}</td>
                  <td className="px-4 py-3 text-gray-500 max-w-[120px] truncate">{item.notes || "-"}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {item.operator_id === currentUserId ? (
                        <>
                          <Link
                            href={`/finance/other/${item.id}/edit`}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            编辑
                          </Link>
                          <DeleteButton id={item.id} />
                        </>
                      ) : (
                        <span className="text-xs text-gray-400">他人提交</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                    本月暂无记录
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

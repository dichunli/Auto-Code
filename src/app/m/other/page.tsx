"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { useConfirm } from "@/components/ConfirmDialog";
import { 删除其它收支 } from "@/app/finance/other/actions";

interface 记录 {
  id: string;
  type: string;
  amount: number;
  counterparty: string | null;
  transaction_date: string;
  notes: string | null;
  images: string[] | null;
  profiles: { full_name: string } | null;
  other_payment_methods: { name: string } | null;
  other_transaction_categories: { name: string } | null;
}

export default function MobileOtherPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [records, setRecords] = useState<记录[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(searchParams.get("month") || "");
  const { 请求确认, 确认弹窗 } = useConfirm();

  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const currentMonth = month || defaultMonth;

  /* 生成年月选项（最近12个月） */
  const monthOptions: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthOptions.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  async function loadRecords() {
    setLoading(true);
    const supabase = createClient();

    const [yearStr, monthStr] = currentMonth.split("-");
    const yearNum = parseInt(yearStr, 10);
    const monthNum = parseInt(monthStr, 10);
    const startDate = `${currentMonth}-01`;
    const endDay = new Date(yearNum, monthNum, 0).getDate();
    const endDate = `${currentMonth}-${String(endDay).padStart(2, "0")}`;

    const { data } = await supabase
      .from("other_transactions")
      .select(
        "*, profiles(full_name), other_payment_methods(name), other_transaction_categories(name)"
      )
      .gte("transaction_date", startDate)
      .lte("transaction_date", endDate)
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false });

    setRecords((data || []) as unknown as 记录[]);
    setLoading(false);
  }

  const incomeTotal = records
    .filter((r) => r.type === "income")
    .reduce((s, r) => s + (r.amount || 0), 0);
  const expenseTotal = records
    .filter((r) => r.type === "expense")
    .reduce((s, r) => s + (r.amount || 0), 0);

  useEffect(() => {
    loadRecords();
  }, [currentMonth]);

  async function handleDelete(id: string) {
    if (!(await 请求确认("确定删除这条记录？"))) return;
    const result = await 删除其它收支(id);
    if (!result.success) {
      alert("删除失败：" + (result.error || "未知错误"));
      return;
    }
    loadRecords();
  }

  function handleMonthChange(newMonth: string) {
    setMonth(newMonth);
    router.push(`/m/other?month=${newMonth}`);
  }

  return (
    <div className="min-h-full bg-gray-50">
      {/* 头部 */}
      <div className="bg-white px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">其它收支</h1>
        <select
          value={currentMonth}
          onChange={(e) => handleMonthChange(e.target.value)}
          className="text-sm px-2 py-1 border border-gray-300 rounded-lg bg-white"
        >
          {monthOptions.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {/* 汇总卡片 */}
      <div className="grid grid-cols-3 gap-2 p-3">
        <div className="bg-white rounded-lg p-3 text-center border border-gray-200">
          <div className="text-xs text-gray-500">收入</div>
          <div className="text-sm font-bold text-green-600">{formatCurrency(incomeTotal)}</div>
        </div>
        <div className="bg-white rounded-lg p-3 text-center border border-gray-200">
          <div className="text-xs text-gray-500">支出</div>
          <div className="text-sm font-bold text-red-600">{formatCurrency(expenseTotal)}</div>
        </div>
        <div className="bg-white rounded-lg p-3 text-center border border-gray-200">
          <div className="text-xs text-gray-500">净额</div>
          <div
            className={`text-sm font-bold ${
              incomeTotal - expenseTotal >= 0 ? "text-green-600" : "text-red-600"
            }`}
          >
            {formatCurrency(incomeTotal - expenseTotal)}
          </div>
        </div>
      </div>

      {/* 记录列表 */}
      <div className="px-3 pb-24 space-y-2">
        {loading ? (
          <div className="text-center py-12 text-gray-400">加载中...</div>
        ) : records.length === 0 ? (
          <div className="text-center py-12 text-gray-400">本月暂无记录</div>
        ) : (
          records.map((item) => (
            <div
              key={item.id}
              className="bg-white rounded-lg border border-gray-200 p-3"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      item.type === "income"
                        ? "bg-green-50 text-green-700"
                        : "bg-red-50 text-red-700"
                    }`}
                  >
                    {item.type === "income" ? "收入" : "支出"}
                  </span>
                  <span className="text-xs text-gray-500">{item.transaction_date}</span>
                </div>
                <span
                  className={`text-base font-bold ${
                    item.type === "income" ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {item.type === "income" ? "+" : "-"}
                  {formatCurrency(item.amount)}
                </span>
              </div>

              <div className="space-y-1">
                <div className="text-sm font-medium text-gray-900">
                  {item.other_transaction_categories?.name || "-"}
                </div>
                <div className="text-xs text-gray-500">
                  账户：{item.other_payment_methods?.name || "-"}
                  {item.counterparty && ` · ${item.counterparty}`}
                </div>
                {item.notes && (
                  <div className="text-xs text-gray-400">备注：{item.notes}</div>
                )}
                {item.images && item.images.length > 0 && (
                  <div className="flex gap-1 pt-1">
                    {item.images.map((img, i) => (
                      <img
                        key={i}
                        src={img}
                        alt=""
                        className="w-12 h-12 rounded object-cover"
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 mt-2 pt-2 border-t border-gray-100">
                <Link
                  href={`/m/other/${item.id}/edit`}
                  className="text-xs text-blue-600"
                >
                  编辑
                </Link>
                <button
                  onClick={() => handleDelete(item.id)}
                  className="text-xs text-red-600"
                >
                  删除
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 浮动按钮 */}
      <Link
        href="/m/other/new"
        className="fixed bottom-20 right-4 z-40 w-14 h-14 bg-blue-600 text-white rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </Link>
      {确认弹窗}
    </div>
  );
}

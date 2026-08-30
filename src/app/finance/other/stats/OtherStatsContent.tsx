"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/utils";

interface 分类 {
  id: string;
  name: string;
  type: string;
}

interface 记录 {
  id: string;
  type: string;
  amount: number;
  counterparty: string | null;
  transaction_date: string;
  notes: string | null;
  operator_id: string | null;
  other_payment_methods: { name: string } | null;
  other_transaction_categories: { name: string } | null;
  profiles: { full_name: string } | null;
}

interface 汇总项 {
  category_name: string;
  amount: number;
}

interface 提交人 {
  id: string;
  full_name: string;
}

/* 其它收支统计 — 客户端交互组件
 * 首屏分类列表和提交人列表由服务端 page.tsx 查询后传入，
 * 明细记录仍需选择日期后点「查询统计」加载 */
export default function OtherStatsContent({
  initialCategories,
  initialOperators,
}: {
  initialCategories: 分类[];
  initialOperators: 提交人[];
}) {
  const [categories] = useState<分类[]>(initialCategories);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [operators] = useState<提交人[]>(initialOperators);
  const [selectedOperators, setSelectedOperators] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [records, setRecords] = useState<记录[]>([]);
  const [incomeSummary, setIncomeSummary] = useState<汇总项[]>([]);
  const [expenseSummary, setExpenseSummary] = useState<汇总项[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalIncome, setTotalIncome] = useState(0);
  const [totalExpense, setTotalExpense] = useState(0);

  /* 默认本月（分类和提交人列表首屏已由服务端传入） */
  useEffect(() => {
    const now = new Date();
    const firstDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const lastDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, "0")}`;
    setStartDate(firstDay);
    setEndDate(lastDay);
  }, []);

  async function handleSearch() {
    if (!startDate || !endDate) {
      alert("请选择开始和结束日期");
      return;
    }

    setLoading(true);

    const supabase = createClient();
    let query = supabase
      .from("other_transactions")
      .select("*, other_payment_methods(name), other_transaction_categories(name), profiles(full_name)")
      .gte("transaction_date", startDate)
      .lte("transaction_date", endDate)
      .order("transaction_date", { ascending: false });

    if (selectedCategories.length > 0) {
      query = query.in("category_id", selectedCategories);
    }

    if (selectedOperators.length > 0) {
      query = query.in("operator_id", selectedOperators);
    }

    const { data } = await query;
    const items = (data || []) as unknown as 记录[];
    setRecords(items);

    /* 收入汇总 */
    const incomeMap = new Map<string, number>();
    /* 支出汇总 */
    const expenseMap = new Map<string, number>();

    items.forEach((item) => {
      const cname = item.other_transaction_categories?.name || "未分类";
      if (item.type === "income") {
        incomeMap.set(cname, (incomeMap.get(cname) || 0) + item.amount);
      } else {
        expenseMap.set(cname, (expenseMap.get(cname) || 0) + item.amount);
      }
    });

    const incomeList: 汇总项[] = [];
    let incTotal = 0;
    incomeMap.forEach((amount, name) => {
      incomeList.push({ category_name: name, amount });
      incTotal += amount;
    });
    incomeList.sort((a, b) => b.amount - a.amount);
    setIncomeSummary(incomeList);
    setTotalIncome(incTotal);

    const expenseList: 汇总项[] = [];
    let expTotal = 0;
    expenseMap.forEach((amount, name) => {
      expenseList.push({ category_name: name, amount });
      expTotal += amount;
    });
    expenseList.sort((a, b) => b.amount - a.amount);
    setExpenseSummary(expenseList);
    setTotalExpense(expTotal);

    setLoading(false);
  }

  function toggleCategory(id: string) {
    setSelectedCategories((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }

  function toggleOperator(id: string) {
    setSelectedOperators((prev) =>
      prev.includes(id) ? prev.filter((o) => o !== id) : [...prev, id]
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="其它收支统计"
        description="按收支原因搜索和汇总统计"
      />

      {/* 筛选区 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">开始日期</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">结束日期</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">收支原因（可多选）</label>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleCategory(c.id)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                  selectedCategories.includes(c.id)
                    ? "bg-blue-50 text-blue-700 border-blue-300"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
          {selectedCategories.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedCategories([])}
              className="mt-2 text-xs text-gray-500 hover:text-gray-700"
            >
              清除选择
            </button>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">提交人（可多选）</label>
          <div className="flex flex-wrap gap-2">
            {operators.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => toggleOperator(o.id)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                  selectedOperators.includes(o.id)
                    ? "bg-blue-50 text-blue-700 border-blue-300"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                }`}
              >
                {o.full_name || "未命名"}
              </button>
            ))}
          </div>
          {selectedOperators.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedOperators([])}
              className="mt-2 text-xs text-gray-500 hover:text-gray-700"
            >
              清除选择
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={handleSearch}
          disabled={loading}
          className="w-full py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "查询中..." : "查询统计"}
        </button>
      </div>

      {/* 总览 */}
      {records.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-xs text-gray-500">收入合计</div>
            <div className="text-lg font-bold text-green-600">{formatCurrency(totalIncome)}</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-xs text-gray-500">支出合计</div>
            <div className="text-lg font-bold text-red-600">{formatCurrency(totalExpense)}</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-xs text-gray-500">净额</div>
            <div className={`text-lg font-bold ${totalIncome - totalExpense >= 0 ? "text-green-600" : "text-red-600"}`}>
              {formatCurrency(totalIncome - totalExpense)}
            </div>
          </div>
        </div>
      )}

      {/* 收入统计 */}
      {incomeSummary.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-green-100 bg-green-50">
            <h3 className="font-medium text-green-800">收入统计</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">收入原因</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">金额</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">占比</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {incomeSummary.map((item) => (
                  <tr key={item.category_name} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{item.category_name}</td>
                    <td className="px-4 py-3 text-right text-green-600 font-medium">{formatCurrency(item.amount)}</td>
                    <td className="px-4 py-3 text-right text-gray-500">
                      {totalIncome > 0 ? ((item.amount / totalIncome) * 100).toFixed(1) : "0"}%
                    </td>
                  </tr>
                ))}
                <tr className="bg-green-50 font-medium">
                  <td className="px-4 py-3 text-green-800">收入合计</td>
                  <td className="px-4 py-3 text-right text-green-700">{formatCurrency(totalIncome)}</td>
                  <td className="px-4 py-3 text-right text-green-700">100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 支出统计 */}
      {expenseSummary.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-red-100 bg-red-50">
            <h3 className="font-medium text-red-800">支出统计</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">支出原因</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">金额</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">占比</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {expenseSummary.map((item) => (
                  <tr key={item.category_name} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{item.category_name}</td>
                    <td className="px-4 py-3 text-right text-red-600 font-medium">{formatCurrency(item.amount)}</td>
                    <td className="px-4 py-3 text-right text-gray-500">
                      {totalExpense > 0 ? ((item.amount / totalExpense) * 100).toFixed(1) : "0"}%
                    </td>
                  </tr>
                ))}
                <tr className="bg-red-50 font-medium">
                  <td className="px-4 py-3 text-red-800">支出合计</td>
                  <td className="px-4 py-3 text-right text-red-700">{formatCurrency(totalExpense)}</td>
                  <td className="px-4 py-3 text-right text-red-700">100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 明细列表 */}
      {records.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-medium text-gray-900">明细记录</h3>
            <span className="text-xs text-gray-500">共 {records.length} 条</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">日期</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">原因</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">类型</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">金额</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">账户</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">记录人</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {records.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-600">{item.transaction_date}</td>
                    <td className="px-4 py-3 text-gray-900">{item.other_transaction_categories?.name || "-"}</td>
                    <td className="px-4 py-3">
                      {item.type === "income" ? (
                        <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700">收入</span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-700">支出</span>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-right font-medium ${item.type === "income" ? "text-green-600" : "text-red-600"}`}>
                      {item.type === "income" ? "+" : "-"}{formatCurrency(item.amount)}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{item.other_payment_methods?.name || "-"}</td>
                    <td className="px-4 py-3 text-gray-600">{item.profiles?.full_name || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {records.length === 0 && !loading && (
        <div className="text-center py-12 text-gray-400 bg-white rounded-xl border border-gray-200">
          选择日期范围后点击查询统计查看数据
        </div>
      )}
    </div>
  );
}

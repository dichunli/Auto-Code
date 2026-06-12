"use client";

import {useState, useEffect, useRef, useMemo} from "react";
import { createClient } from "@/lib/supabase/client";
import { useDebounce } from "@/lib/useDebounce";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/utils";

const transactionTypeMap: Record<string, string> = {
  payment: "付款",
  refund: "退款",
  credit: "应收",
  debit: "应付",
};

interface Supplier {
  id: string;
  name: string;
}

interface TransactionRecord {
  id: string;
  supplier_id: string;
  transaction_type: string;
  amount: number;
  description: string | null;
  created_at: string;
  suppliers: { name: string } | null;
  profiles: { full_name: string } | null;
}

interface TransactionForm {
  supplier_id: string;
  transaction_type: "payment" | "refund" | "credit" | "debit";
  amount: string;
  description: string;
}

export default function SupplierTransactionsContent({
  initialTransactions,
  initialSuppliers,
}: {
  initialTransactions: TransactionRecord[];
  initialSuppliers: Supplier[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [records, setRecords] = useState<TransactionRecord[]>(initialTransactions);
  const [allRecords, setAllRecords] = useState<TransactionRecord[]>(initialTransactions);
  const [suppliers, setSuppliers] = useState<Supplier[]>(initialSuppliers);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [supplierFilter, setSupplierFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const debouncedQuery = useDebounce(query, 300);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<TransactionForm>({
    supplier_id: "",
    transaction_type: "payment",
    amount: "",
    description: "",
  });
  const [saving, setSaving] = useState(false);

  async function loadRecords() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setLoading(true);
    let q = supabase
      .from("supplier_transactions")
      .select("*, suppliers(name), profiles(full_name)")
      .order("created_at", { ascending: false });

    if (supplierFilter) {
      q = q.eq("supplier_id", supplierFilter);
    }
    if (typeFilter) {
      q = q.eq("transaction_type", typeFilter);
    }

    const { data, error } = await q;
    if (error) {
      alert("加载失败: " + error.message);
      setLoading(false);
      return;
    }

    const result = (data || []) as TransactionRecord[];
    setAllRecords(result);
    filterRecords(result, query);
    setLoading(false);
  }

  function filterRecords(source: TransactionRecord[], search: string) {
    if (!search.trim()) {
      setRecords(source);
      return;
    }
    const sq = search.trim().toLowerCase();
    const filtered = source.filter((r) => {
      const supplierName = r.suppliers?.name || "";
      const desc = r.description || "";
      return supplierName.toLowerCase().includes(sq) || desc.toLowerCase().includes(sq);
    });
    setRecords(filtered);
  }

  // 筛选条件变化时重新拉取（跳过首次挂载）
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    loadRecords();
  }, [supplierFilter, typeFilter]);

  // 搜索关键词变化时前端过滤
  useEffect(() => {
    filterRecords(allRecords, debouncedQuery);
  }, [allRecords, debouncedQuery]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.supplier_id) {
      alert("请选择供应商");
      return;
    }
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) {
      alert("请输入有效的金额");
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("supplier_transactions").insert({
      supplier_id: form.supplier_id,
      transaction_type: form.transaction_type,
      amount,
      description: form.description.trim() || null,
    });
    setSaving(false);

    if (error) {
      alert("保存失败: " + error.message);
      return;
    }

    setForm({ supplier_id: "", transaction_type: "payment", amount: "", description: "" });
    setShowForm(false);
    loadRecords();
  }

  const totalPayment = records
    .filter((r) => r.transaction_type === "payment" || r.transaction_type === "debit")
    .reduce((sum, r) => sum + (r.amount || 0), 0);
  const totalIncome = records
    .filter((r) => r.transaction_type === "refund" || r.transaction_type === "credit")
    .reduce((sum, r) => sum + (r.amount || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="供应商往来款项"
        description="管理供应商付款、退款、应收应付记录"
        action={{ href: "/suppliers", label: "供应商管理" }}
      />

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">支出总额（付款+应付）</div>
          <div className="text-xl font-bold text-red-600 mt-1">{formatCurrency(totalPayment)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">收入总额（退款+应收）</div>
          <div className="text-xl font-bold text-green-600 mt-1">{formatCurrency(totalIncome)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">记录数</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{records.length}</div>
        </div>
      </div>

      {/* 筛选栏 + 新增按钮 */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="搜索供应商、备注..."
          className="w-full max-w-sm px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value)}
        >
          <option value="">全部供应商</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">全部类型</option>
          <option value="payment">付款</option>
          <option value="refund">退款</option>
          <option value="credit">应收</option>
          <option value="debit">应付</option>
        </select>
        {query.trim() && (
          <button
            onClick={() => setQuery("")}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            清空
          </button>
        )}
        <button
          onClick={() => setShowForm(!showForm)}
          className="ml-auto px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
        >
          {showForm ? "取消" : "记一笔"}
        </button>
      </div>

      {/* 新增表单 */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h3 className="text-sm font-semibold text-gray-900">新增往来款项</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">供应商 *</label>
              <select
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                value={form.supplier_id}
                onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}
              >
                <option value="">请选择</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">类型 *</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                value={form.transaction_type}
                onChange={(e) => setForm({ ...form, transaction_type: e.target.value as TransactionForm["transaction_type"] })}
              >
                <option value="payment">付款</option>
                <option value="refund">退款</option>
                <option value="credit">应收</option>
                <option value="debit">应付</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">金额 *</label>
              <input
                type="number"
                step="0.01"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">备注</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="选填"
            />
          </div>
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      )}

      {/* 列表 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">时间</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">供应商</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">类型</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">金额</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">备注</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">记录人</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {records.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-gray-500 text-xs">
                    {new Date(t.created_at).toLocaleString("zh-CN")}
                  </td>
                  <td className="px-6 py-4 text-gray-900 font-medium">{t.suppliers?.name || "-"}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        t.transaction_type === "payment" || t.transaction_type === "debit"
                          ? "bg-red-50 text-red-700"
                          : "bg-green-50 text-green-700"
                      }`}
                    >
                      {transactionTypeMap[t.transaction_type] || t.transaction_type}
                    </span>
                  </td>
                  <td className={`px-6 py-4 font-medium ${
                    t.transaction_type === "payment" || t.transaction_type === "debit"
                      ? "text-red-600"
                      : "text-green-600"
                  }`}>
                    {t.transaction_type === "payment" || t.transaction_type === "debit" ? "-" : "+"}
                    {formatCurrency(t.amount)}
                  </td>
                  <td className="px-6 py-4 text-gray-500">{t.description || "-"}</td>
                  <td className="px-6 py-4 text-gray-500 text-xs">{t.profiles?.full_name || "-"}</td>
                </tr>
              ))}
              {(!records || records.length === 0) && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                    {loading ? "加载中..." : "暂无往来款项记录"}
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

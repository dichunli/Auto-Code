"use client";

import {useState, useEffect, useRef, useMemo} from "react";
import { createClient } from "@/lib/supabase/client";
import { useDebounce } from "@/lib/useDebounce";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/utils";
import { 记供应商往来账 } from "./actions";

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
  /* 分页展示：记录超过 50 条时只渲染当前页，避免表格行数过多卡顿 */
  const [page, setPage] = useState(1);
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
      setPage(1);
      return;
    }
    const sq = search.trim().toLowerCase();
    const filtered = source.filter((r) => {
      const supplierName = r.suppliers?.name || "";
      const desc = r.description || "";
      return supplierName.toLowerCase().includes(sq) || desc.toLowerCase().includes(sq);
    });
    setRecords(filtered);
    setPage(1);
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
    /* 2026-08-19 收编 Server Action（表写已角色化，客户端直插会被 RLS 拦） */
    const res = await 记供应商往来账({
      supplier_id: form.supplier_id,
      transaction_type: form.transaction_type,
      amount,
      description: form.description,
    });
    setSaving(false);

    if (!res.success) {
      alert("保存失败: " + (res.error || "未知错误"));
      return;
    }

    setForm({ supplier_id: "", transaction_type: "payment", amount: "", description: "" });
    setShowForm(false);
    loadRecords();
  }

  /* 统计口径（2026-08-19 修正，用户确认）：
     欠款余额 = 应付(debit) − 已付(payment) − 退货冲减(credit) + 退款(refund 加回)。
     原卡片把 debit(欠款) 算进"支出"、credit(冲减) 算进"收入"，口径混乱。 */
  const 合计 = (() => {
    let debit = 0;
    let payment = 0;
    let credit = 0;
    let refund = 0;
    for (const r of records) {
      if (r.transaction_type === "debit") debit += r.amount || 0;
      else if (r.transaction_type === "payment") payment += r.amount || 0;
      else if (r.transaction_type === "credit") credit += r.amount || 0;
      else if (r.transaction_type === "refund") refund += r.amount || 0;
    }
    return { debit, payment, credit, refund, 余额: debit - payment - credit + refund };
  })();

  /* 分页切片（page 状态见上方声明，筛选/搜索变化时在 filterRecords 里重置回第 1 页） */
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(records.length / pageSize));
  const 当前页 = Math.min(page, totalPages);
  const pagedRecords = records.slice((当前页 - 1) * pageSize, 当前页 * pageSize);

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
          <div className="text-sm text-gray-500">累计应付（采购入库）</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(合计.debit)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">累计已付</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(合计.payment)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">当前欠款余额</div>
          <div className={`text-xl font-bold mt-1 ${合计.余额 > 0 ? "text-red-600" : 合计.余额 < 0 ? "text-green-600" : "text-gray-900"}`}>
            {formatCurrency(Math.abs(合计.余额))}{合计.余额 > 0 ? "（欠供应商）" : 合计.余额 < 0 ? "（多付/供应商欠）" : ""}
          </div>
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
              {pagedRecords.map((t) => (
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

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={当前页 <= 1}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            上一页
          </button>
          <span className="text-sm text-gray-600 px-2">
            {当前页} / {totalPages}（共 {records.length} 条）
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={当前页 >= totalPages}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}

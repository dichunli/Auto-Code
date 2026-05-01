"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";

export default function NewTransactionPage() {
  const router = useRouter();
  const supabase = createClient();

  const [accounts, setAccounts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [type, setType] = useState("income");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [transactionDate, setTransactionDate] = useState(new Date().toISOString().split("T")[0]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadData() {
      const { data: accs } = await supabase.from("finance_accounts").select("id, name").eq("is_active", true);
      const { data: cats } = await supabase.from("finance_categories").select("id, name, type").eq("is_active", true);
      setAccounts(accs || []);
      setCategories(cats || []);
      if (accs && accs.length > 0) setAccountId(accs[0].id);
    }
    loadData();
  }, [supabase]);

  const filteredCategories = categories.filter((c) => c.type === type);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId || !amount || Number(amount) <= 0) return;

    setLoading(true);
    const { error } = await supabase.from("finance_transactions").insert({
      account_id: accountId,
      category_id: categoryId || null,
      type,
      amount: Number(amount),
      description: description || null,
      transaction_date: transactionDate,
    });
    setLoading(false);

    if (error) {
      alert("保存失败：" + error.message);
      return;
    }

    router.push("/finance/transactions");
    router.refresh();
  }

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="记一笔" description="登记一笔收入或支出" />

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">类型</label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setType("income")}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-colors ${type === "income" ? "bg-green-50 text-green-700 border-green-300" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}
              >
                收入
              </button>
              <button
                type="button"
                onClick={() => setType("expense")}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-colors ${type === "expense" ? "bg-red-50 text-red-700 border-red-300" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}
              >
                支出
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">账户 *</label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="">请选择账户</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">分类</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">请选择分类</option>
              {filteredCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">金额 *</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="0.00"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">日期 *</label>
            <input
              type="date"
              value={transactionDate}
              onChange={(e) => setTransactionDate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
              placeholder="可选填写备注信息"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {loading ? "保存中..." : "保存"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/finance/transactions")}
              className="px-5 py-2.5 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
            >
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

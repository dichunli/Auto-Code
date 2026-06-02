"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ImageUploader } from "@/components/ImageUploader";

interface 账户 {
  id: string;
  name: string;
}

interface 分类 {
  id: string;
  name: string;
  type: string;
}

export default function MobileNewOtherPage() {
  const router = useRouter();

  const [type, setType] = useState<"income" | "expense">("expense");
  const [amount, setAmount] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [transactionDate, setTransactionDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [operatorName, setOperatorName] = useState("");

  const [accounts, setAccounts] = useState<账户[]>([]);
  const [categories, setCategories] = useState<分类[]>([]);
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [images, setImages] = useState<string[]>([]);

  /* 获取当前用户、收款方式（按操作员过滤）、分类 */
  useEffect(() => {
    async function loadData() {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      const operatorId = userData.user?.id;

      const { data: cats } = await supabase
        .from("other_transaction_categories")
        .select("id, name, type")
        .or('is_active.eq.true,is_active.is.null')
        .order("sort_order");
      setCategories(cats || []);

      if (operatorId) {
        const { data: accs } = await supabase
          .from("other_payment_methods")
          .select("id, name")
          .or('is_active.eq.true,is_active.is.null')
          .or(`operator_id.eq.${operatorId},operator_id.is.null`)
          .order("sort_order");

        setAccounts(accs || []);
        if (accs && accs.length > 0) setAccountId(accs[0].id);

        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", operatorId)
          .single();
        if (profile?.full_name) setOperatorName(profile.full_name);
      }
    }
    loadData();
  }, []);

  useEffect(() => {
    setCategoryId("");
  }, [type]);

  const filteredCategories = categories.filter((c) => c.type === type);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!categoryId) {
      alert(`请选择${type === "income" ? "收入原因" : "支出原因"}`);
      return;
    }
    if (!amount || Number(amount) <= 0) {
      alert("请填写金额");
      return;
    }
    if (!accountId) {
      alert("请选择账户");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    const operatorId = userData.user?.id || null;

    const { error } = await supabase.from("other_transactions").insert({
      type,
      amount: Number(amount),
      name: null,
      counterparty: counterparty.trim() || null,
      operator_id: operatorId,
      account_id: accountId,
      category_id: categoryId,
      transaction_date: transactionDate,
      notes: notes.trim() || null,
      images: images.length > 0 ? images : null,
    });

    setLoading(false);
    if (error) {
      alert("保存失败：" + error.message);
      return;
    }

    router.push("/m/other");
    router.refresh();
  }

  return (
    <div className="min-h-full bg-gray-50">
      {/* 头部 */}
      <div className="bg-white px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">记一笔</h1>
        <button
          onClick={() => router.push("/m/other")}
          className="text-sm text-gray-500"
        >
          取消
        </button>
      </div>

      <form onSubmit={handleSubmit} className="p-3 space-y-3">
        {/* 类型 */}
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <label className="block text-sm font-medium text-gray-700 mb-2">类型</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setType("expense")}
              className={`flex-1 py-2.5 text-sm font-medium rounded-lg border transition-colors ${
                type === "expense"
                  ? "bg-red-50 text-red-700 border-red-300"
                  : "bg-white text-gray-700 border-gray-300"
              }`}
            >
              支出
            </button>
            <button
              type="button"
              onClick={() => setType("income")}
              className={`flex-1 py-2.5 text-sm font-medium rounded-lg border transition-colors ${
                type === "income"
                  ? "bg-green-50 text-green-700 border-green-300"
                  : "bg-white text-gray-700 border-gray-300"
              }`}
            >
              收入
            </button>
          </div>
        </div>

        {/* 分类 */}
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {type === "income" ? "收入原因" : "支出原因"} *
          </label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
            required
          >
            <option value="">请选择</option>
            {filteredCategories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {filteredCategories.length === 0 && (
            <p className="mt-1 text-xs text-red-500">
              暂无{type === "income" ? "收入" : "支出"}原因分类，请先创建
            </p>
          )}
        </div>

        {/* 金额 */}
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <label className="block text-sm font-medium text-gray-700 mb-1">金额 *</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                const v = e.target.value;
                if (/^\d*\.?\d{0,2}$/.test(v)) setAmount(v);
              }}
              placeholder="0.00"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
              required
            />
            <span className="text-sm text-gray-500">元</span>
          </div>
        </div>

        {/* 账户 */}
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {type === "income" ? "收款账户" : "付款账户"} *
          </label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
            required
          >
            <option value="">请选择账户</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        {/* 交易对手 */}
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {type === "expense" ? "付款人" : "收款人"}
          </label>
          <input
            type="text"
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
            placeholder={`默认：${operatorName || "当前操作人"}`}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>

        {/* 日期 */}
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <label className="block text-sm font-medium text-gray-700 mb-1">日期</label>
          <input
            type="date"
            value={transactionDate}
            onChange={(e) => setTransactionDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>

        {/* 备注 */}
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="可选"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>

        {/* 图片上传 */}
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <label className="block text-sm font-medium text-gray-700 mb-1">附件照片</label>
          <ImageUploader
            onUpload={(paths) => setImages(paths)}
            existingImages={images}
            maxImages={5}
          />
        </div>

        {/* 保存按钮 */}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "保存中..." : "保存"}
        </button>
      </form>
    </div>
  );
}

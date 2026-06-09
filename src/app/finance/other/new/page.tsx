"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
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

export default function NewOtherTransactionPage() {
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

  /* 获取当前用户、收款方式（按操作员过滤）、分类列表 */
  useEffect(() => {
    async function loadData() {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      const operatorId = userData.user?.id;

      /* 查询分类 */
      const { data: cats } = await supabase
        .from("other_transaction_categories")
        .select("id, name, type")
        .or('is_active.eq.true,is_active.is.null')
        .order("sort_order");
      setCategories(cats || []);

      /* 查询收款方式：专属 + 公用分别查询后合并 */
      if (operatorId) {
        const [{ data: 专属账号 }, { data: 公用账号 }] = await Promise.all([
          supabase
            .from("other_payment_methods")
            .select("id, name")
            .eq("operator_id", operatorId)
            .eq("is_active", true)
            .order("sort_order"),
          supabase
            .from("other_payment_methods")
            .select("id, name")
            .is("operator_id", null)
            .eq("is_active", true)
            .order("sort_order"),
        ]);
        const 合并账号 = [...(专属账号 || []), ...(公用账号 || [])];
        setAccounts(合并账号);
        if (合并账号.length > 0) setAccountId(合并账号[0].id);

        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", operatorId)
          .single();
        if (profile?.full_name) setOperatorName(profile.full_name);
      } else {
        const { data: all } = await supabase
          .from("other_payment_methods")
          .select("id, name")
          .or('is_active.eq.true,is_active.is.null')
          .order("sort_order");
        setAccounts(all || []);
        if (all && all.length > 0) setAccountId(all[0].id);
      }
    }
    loadData();
  }, []);

  /* 切换类型时清空分类选择 */
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

    /* 获取当前用户ID */
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

    router.push("/finance/other");
    router.refresh();
  }

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="记一笔" description="登记其它收支" />

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* 收支类型 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">类型</label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setType("expense")}
                className={`flex-1 py-2.5 text-sm font-medium rounded-lg border transition-colors ${
                  type === "expense"
                    ? "bg-red-50 text-red-700 border-red-300"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
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
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                }`}
              >
                收入
              </button>
            </div>
          </div>

          {/* 分类（必填） */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {type === "income" ? "收入原因" : "支出原因"} *
            </label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="">请选择</option>
              {filteredCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {filteredCategories.length === 0 && (
              <p className="mt-1 text-xs text-red-500">
                暂无{type === "income" ? "收入" : "支出"}原因分类，
                <Link href="/finance/other-categories/new" className="underline">请先创建</Link>
              </p>
            )}
          </div>

          {/* 金额 */}
          <div>
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
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
              <span className="text-sm text-gray-500">元</span>
            </div>
          </div>

          {/* 账户 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {type === "income" ? "收款账户" : "付款账户"} *
            </label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="">请选择账户</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          {/* 交易对手 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {type === "expense" ? "付款人" : "收款人"}
            </label>
            <input
              type="text"
              value={counterparty}
              onChange={(e) => setCounterparty(e.target.value)}
              placeholder={`默认：${operatorName || "当前操作人"}`}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* 日期 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">日期</label>
            <input
              type="date"
              value={transactionDate}
              onChange={(e) => setTransactionDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* 备注 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="可选"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* 图片上传 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">附件照片</label>
            <ImageUploader
              onUpload={(paths) => setImages(paths)}
              existingImages={images}
              maxImages={5}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex-1 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

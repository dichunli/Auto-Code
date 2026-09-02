"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { ImageUploader } from "@/components/ImageUploader";
import { 更新其它收支 } from "../../actions";

interface 账户 {
  id: string;
  name: string;
}

interface 分类 {
  id: string;
  name: string;
  type: string;
}

export default function EditOtherTransactionPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [type, setType] = useState<"income" | "expense">("expense");
  const [amount, setAmount] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [transactionDate, setTransactionDate] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [无权编辑, set无权编辑] = useState(false);

  const [accounts, setAccounts] = useState<账户[]>([]);
  const [categories, setCategories] = useState<分类[]>([]);
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [images, setImages] = useState<string[]>([]);

  async function loadData(itemId: string) {
    const supabase = createClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const userData = { user: sessionData.session?.user ?? null }; /* getSession本地读不联网（2026-09-03） */
    const userId = userData.user?.id;

    const { data } = await supabase
      .from("other_transactions")
      .select("*")
      .eq("id", itemId)
      .single();
    if (data) {
      /* 只能修改自己提交的 */
      if (data.operator_id && data.operator_id !== userId) {
        set无权编辑(true);
        return;
      }
      setType(data.type as "income" | "expense");
      setAmount(String(data.amount || ""));
      setCounterparty(data.counterparty || "");
      setTransactionDate(data.transaction_date || "");
      setNotes(data.notes || "");
      setAccountId(data.account_id || "");
      setCategoryId(data.category_id || "");
      setImages(Array.isArray(data.images) ? data.images : []);
    }
  }

  useEffect(() => {
    if (id) loadData(id);
  }, [id]);

  /* 加载收款方式（按操作员过滤）和分类列表 */
  useEffect(() => {
    async function loadOptions() {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
    const userData = { user: sessionData.session?.user ?? null }; /* getSession本地读不联网（2026-09-03） */
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
        setAccounts([...(专属账号 || []), ...(公用账号 || [])]);
      } else {
        const { data: all } = await supabase
          .from("other_payment_methods")
          .select("id, name")
          .or('is_active.eq.true,is_active.is.null')
          .order("sort_order");
        setAccounts(all || []);
      }
    }
    loadOptions();
  }, []);

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
    /* 涉钱写操作走 Server Action */
    try {
      const result = await 更新其它收支(id, {
        type,
        amount: Number(amount),
        counterparty,
        accountId,
        categoryId,
        transactionDate,
        notes,
        images,
      });
      setLoading(false);
      if (!result.success) {
        alert("保存失败：" + (result.error || "未知错误"));
        return;
      }
    } catch {
      setLoading(false);
      alert("保存失败：网络异常，请重试");
      return;
    }

    router.push("/finance/other");
    router.refresh();
  }

  const filteredCategories = categories.filter((c) => c.type === type);

  if (无权编辑) {
    return (
      <div className="max-w-2xl mx-auto">
        <PageHeader title="编辑收支" description="修改其它收支记录" />
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
          <p className="text-red-600 font-medium">无权编辑</p>
          <p className="text-sm text-gray-500 mt-2">只能修改自己提交的收支记录</p>
          <button
            type="button"
            onClick={() => router.push("/finance/other")}
            className="mt-4 px-4 py-2 text-sm text-blue-600 border border-blue-300 rounded-lg hover:bg-blue-50"
          >
            返回列表
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="编辑收支" description="修改其它收支记录" />

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
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
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
              <span className="text-sm text-gray-500">元</span>
            </div>
          </div>

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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {type === "expense" ? "付款人" : "收款人"}
            </label>
            <input
              type="text"
              value={counterparty}
              onChange={(e) => setCounterparty(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">日期</label>
            <input
              type="date"
              value={transactionDate}
              onChange={(e) => setTransactionDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

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

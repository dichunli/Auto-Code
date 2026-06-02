"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

export default function NewOtherCategoryPage() {
  const router = useRouter();
  const supabase = createClient();

  const [name, setName] = useState("");
  const [type, setType] = useState<"income" | "expense">("expense");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      alert("请填写分类名称");
      return;
    }

    setLoading(true);

    /* 检查重名 */
    const { data: existing } = await supabase
      .from("other_transaction_categories")
      .select("id")
      .eq("name", name.trim())
      .eq("type", type)
      .single();

    if (existing) {
      setLoading(false);
      alert("该分类名称已存在");
      return;
    }

    /* 获取当前最大排序号 */
    const { data: maxRow } = await supabase
      .from("other_transaction_categories")
      .select("sort_order")
      .eq("type", type)
      .order("sort_order", { ascending: false })
      .limit(1)
      .single();

    const nextSort = (maxRow?.sort_order || 0) + 10;

    const { error } = await supabase.from("other_transaction_categories").insert({
      name: name.trim(),
      type,
      sort_order: nextSort,
    });

    setLoading(false);

    if (error) {
      alert("保存失败：" + error.message);
      return;
    }

    router.push("/finance/other-categories");
    router.refresh();
  }

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="新建分类" description="添加其它收支原因分类" />

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">类型 *</label>
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
              {type === "income" ? "收入原因名称" : "支出原因名称"} *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === "income" ? "如：废旧回收、赔偿款..." : "如：办公用品、停车费..."}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
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

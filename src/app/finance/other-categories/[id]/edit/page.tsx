"use client";

import {useState, useEffect, useMemo} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { 更新收支分类 } from "../../actions";

export default function EditOtherCategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [id, setId] = useState("");

  const [name, setName] = useState("");
  const [type, setType] = useState<"income" | "expense">("expense");
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadData(categoryId: string) {
      const { data } = await supabase
        .from("other_transaction_categories")
        .select("*")
        .eq("id", categoryId)
        .single();
      if (data) {
        setName(data.name || "");
        setType(data.type as "income" | "expense");
        setIsActive(data.is_active ?? true);
      }
    }

    params.then((p) => {
      setId(p.id);
      loadData(p.id);
    });
  }, [params]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      alert("请填写分类名称");
      return;
    }

    setLoading(true);

    /* 重名检查和写库走 Server Action */
    try {
      const result = await 更新收支分类({ id, name, type, isActive });
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

    router.push("/finance/other-categories");
    router.refresh();
  }

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="编辑分类" description="修改其它收支原因分类" />

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
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isActive"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="isActive" className="text-sm text-gray-700">
              启用
            </label>
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

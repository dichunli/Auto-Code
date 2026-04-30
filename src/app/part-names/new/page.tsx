"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

export default function NewPartNamePage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);

  const [form, setForm] = useState({
    name: "",
    category_id: "",
    unit: "件",
    search_keywords: "",
  });

  useEffect(() => {
    supabase.from("part_categories").select("id, name").order("name").then(({ data }) => setCategories(data || []));
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.from("part_names").insert({
      name: form.name,
      category_id: form.category_id,
      unit: form.unit,
      search_keywords: form.search_keywords || null,
    });

    if (error) {
      alert("保存失败: " + error.message);
      setLoading(false);
      return;
    }

    router.push("/part-names");
    router.refresh();
  }

  return (
    <div>
      <PageHeader title="新建配件名称" />
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">配件名称 *</label>
            <input required className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="如：机油、空气滤芯" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">所属分类 *</label>
            <select required className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
              <option value="">请选择</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">单位</label>
            <input className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="如：件、升、个" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">搜索关键词</label>
            <input className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="如：机油 润滑油 发动机油" value={form.search_keywords} onChange={(e) => setForm({ ...form, search_keywords: e.target.value })} />
            <p className="text-xs text-gray-400 mt-1">用于模糊搜索，多个词用空格分隔</p>
          </div>
        </div>

        <div className="mt-8 flex gap-3 justify-end">
          <button type="button" onClick={() => router.back()} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
          <button type="submit" disabled={loading} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">保存</button>
        </div>
      </form>
    </div>
  );
}

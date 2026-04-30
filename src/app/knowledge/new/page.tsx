"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

export default function NewKnowledgePage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const [serviceNames, setServiceNames] = useState<any[]>([]);
  const [serviceItems, setServiceItems] = useState<any[]>([]);

  const [form, setForm] = useState({
    title: "",
    type: "article" as "article" | "video" | "qa",
    category_id: "",
    content: "",
    video_url: "",
  });

  const [linkedNames, setLinkedNames] = useState<string[]>([]);
  const [linkedItems, setLinkedItems] = useState<string[]>([]);

  useEffect(() => {
    supabase.from("knowledge_categories").select("*").order("sort_order").then(({ data }) => setCategories(data || []));
    supabase.from("service_names").select("id, name").order("name").then(({ data }) => setServiceNames(data || []));
    supabase.from("service_items").select("id, name").order("name").then(({ data }) => setServiceItems(data || []));
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const { data: article, error } = await supabase
        .from("knowledge_articles")
        .insert({
          title: form.title,
          type: form.type,
          category_id: form.category_id || null,
          content: form.content || null,
          video_url: form.type === "video" ? form.video_url || null : null,
        })
        .select("id")
        .single();

      if (error || !article) throw error || new Error("创建失败");

      // 关联维修项目名称
      if (linkedNames.length > 0) {
        const nameLinks = linkedNames.map((id) => ({ article_id: article.id, service_name_id: id }));
        await supabase.from("knowledge_service_links").insert(nameLinks);
      }

      // 关联维修项目实例
      if (linkedItems.length > 0) {
        const itemLinks = linkedItems.map((id) => ({ article_id: article.id, service_item_id: id }));
        await supabase.from("knowledge_service_links").insert(itemLinks);
      }

      router.push("/knowledge");
      router.refresh();
    } catch (err: any) {
      alert("保存失败: " + err.message);
      setLoading(false);
    }
  }

  function toggleSelection(list: string[], setList: (v: string[]) => void, id: string) {
    if (list.includes(id)) {
      setList(list.filter((x) => x !== id));
    } else {
      setList([...list, id]);
    }
  }

  return (
    <div>
      <PageHeader title="新建知识库内容" />
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-3xl">
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">标题 *</label>
            <input
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">类型</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as any })}
              >
                <option value="article">文章</option>
                <option value="video">视频</option>
                <option value="qa">知识问答</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">分类</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={form.category_id}
                onChange={(e) => setForm({ ...form, category_id: e.target.value })}
              >
                <option value="">未分类</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {form.type === "video" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">视频链接</label>
              <input
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder="支持外部视频链接"
                value={form.video_url}
                onChange={(e) => setForm({ ...form, video_url: e.target.value })}
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">内容</label>
            <textarea
              rows={10}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm"
              placeholder="支持 HTML 格式"
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
            />
            <p className="text-xs text-gray-400 mt-1">支持 HTML 标签，如 &lt;h3&gt;、&lt;p&gt;、&lt;ul&gt;、&lt;li&gt; 等</p>
          </div>

          {/* 关联维修项目名称 */}
          <div className="border-t border-gray-100 pt-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">关联维修项目名称</h3>
            <div className="flex flex-wrap gap-2">
              {serviceNames.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => toggleSelection(linkedNames, setLinkedNames, n.id)}
                  className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                    linkedNames.includes(n.id)
                      ? "bg-blue-50 border-blue-300 text-blue-700"
                      : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  {n.name}
                </button>
              ))}
            </div>
          </div>

          {/* 关联维修项目实例 */}
          <div className="border-t border-gray-100 pt-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">关联具体维修项目</h3>
            <div className="flex flex-wrap gap-2">
              {serviceItems.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleSelection(linkedItems, setLinkedItems, s.id)}
                  className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                    linkedItems.includes(s.id)
                      ? "bg-blue-50 border-blue-300 text-blue-700"
                      : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-8 flex gap-3 justify-end">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </form>
    </div>
  );
}

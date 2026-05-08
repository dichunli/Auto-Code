"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import VehicleModelSelector, { LinkedItem } from "@/components/VehicleModelSelector";
import { SimpleRichEditor } from "@/components/SimpleRichEditor";

interface NamedItem {
  id: string;
  name: string;
}

export default function NewKnowledgePage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);

  const [form, setForm] = useState({
    title: "",
    type: "article" as "article" | "video" | "qa" | "guide",
    category_id: "",
    content: "",
    video_url: "",
  });

  // 搜索添加维修项目名称
  const [nameSearch, setNameSearch] = useState("");
  const [nameResults, setNameResults] = useState<NamedItem[]>([]);
  const [nameSearching, setNameSearching] = useState(false);
  const [linkedNames, setLinkedNames] = useState<NamedItem[]>([]);
  const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 适用车型
  const [linkedVehicles, setLinkedVehicles] = useState<LinkedItem[]>([]);

  useEffect(() => {
    supabase.from("knowledge_categories").select("*").order("sort_order").then(({ data }) => setCategories(data || []));
  }, [supabase]);

  async function doNameSearch(keyword: string) {
    if (!keyword.trim()) { setNameResults([]); return; }
    setNameSearching(true);
    const { data } = await supabase
      .from("service_names")
      .select("id, name")
      .ilike("name", `%${keyword.trim()}%`)
      .limit(20);
    setNameResults((data || []) as NamedItem[]);
    setNameSearching(false);
  }

  function handleNameSearchChange(val: string) {
    setNameSearch(val);
    if (nameTimer.current) clearTimeout(nameTimer.current);
    nameTimer.current = setTimeout(() => doNameSearch(val), 300);
  }

  function addLinkedName(item: NamedItem) {
    if (!linkedNames.find((n) => n.id === item.id)) {
      setLinkedNames((prev) => [...prev, item]);
    }
    setNameSearch("");
    setNameResults([]);
  }

  function removeLinkedName(id: string) {
    setLinkedNames((prev) => prev.filter((n) => n.id !== id));
  }

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

      if (linkedNames.length > 0) {
        const nameLinks = linkedNames.map((n) => ({ article_id: article.id, service_name_id: n.id }));
        await supabase.from("knowledge_service_links").insert(nameLinks);
      }

      if (linkedVehicles.length > 0) {
        const vehicleLinks = linkedVehicles.map((v) => ({
          article_id: article.id,
          vehicle_model_id: Number(v.id),
        }));
        await supabase.from("knowledge_vehicle_links").insert(vehicleLinks);
      }

      router.push("/knowledge");
      router.refresh();
    } catch (err: any) {
      alert("保存失败: " + err.message);
      setLoading(false);
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
                <option value="guide">维修指导</option>
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
            <SimpleRichEditor
              value={form.content}
              onChange={(html) => setForm({ ...form, content: html })}
              placeholder="请输入内容，支持插入短视频..."
            />
          </div>

          {/* 关联维修项目名称 */}
          <div className="border-t border-gray-100 pt-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">关联维修项目名称</h3>
            <input
              type="text"
              value={nameSearch}
              onChange={(e) => handleNameSearchChange(e.target.value)}
              placeholder="输入项目名称搜索后添加..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-2"
            />
            {nameSearching && <p className="text-xs text-gray-400">搜索中...</p>}
            {nameResults.length > 0 && (
              <div className="border border-gray-200 rounded-lg max-h-40 overflow-y-auto mb-2">
                {nameResults.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => addLinkedName(n)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                  >
                    {n.name}
                  </button>
                ))}
              </div>
            )}
            {linkedNames.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {linkedNames.map((n) => (
                  <span key={n.id} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                    {n.name}
                    <button
                      type="button"
                      onClick={() => removeLinkedName(n.id)}
                      className="text-blue-400 hover:text-blue-600">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 关联车型 - 使用适用车型模块 */}
          <div className="border-t border-gray-100 pt-4">
            <VehicleModelSelector value={linkedVehicles} onChange={setLinkedVehicles} />
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

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

export default function NewCoursePage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "technical",
    content_type: "document",
    content_text: "",
    duration_minutes: "",
    passing_score: "60",
    is_required: false,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase.from("training_courses").insert({
        title: form.title,
        description: form.description || null,
        category: form.category,
        content_type: form.content_type,
        content_text: form.content_text || null,
        duration_minutes: form.duration_minutes ? parseInt(form.duration_minutes) : null,
        passing_score: parseInt(form.passing_score) || 60,
        is_required: form.is_required,
      });

      if (error) throw error;
      router.push("/training");
      router.refresh();
    } catch (err: any) {
      alert("保存失败: " + err.message);
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader title="新建课程" />
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">课程标题 *</label>
          <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">分类</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="safety">安全</option>
              <option value="technical">技术</option>
              <option value="service">服务</option>
              <option value="management">管理</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">内容类型</label>
            <select value={form.content_type} onChange={(e) => setForm({ ...form, content_type: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="document">文档</option>
              <option value="video">视频</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">课程描述</label>
          <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">课程内容</label>
          <textarea rows={8} value={form.content_text} onChange={(e) => setForm({ ...form, content_text: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="支持 Markdown 格式..." />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">时长（分钟）</label>
            <input type="number" value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">通过分数</label>
            <input type="number" value={form.passing_score} onChange={(e) => setForm({ ...form, passing_score: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="is_required" checked={form.is_required} onChange={(e) => setForm({ ...form, is_required: e.target.checked })} className="rounded" />
          <label htmlFor="is_required" className="text-sm text-gray-700">设为必修</label>
        </div>
        <div className="flex gap-3 justify-end pt-4">
          <button type="button" onClick={() => router.back()} className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
          <button type="submit" disabled={loading} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">{loading ? "保存中..." : "创建课程"}</button>
        </div>
      </form>
    </div>
  );
}

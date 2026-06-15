"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { createClient, 确保有session } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { VideoUploader } from "@/components/VideoUploader";

const BlockNoteEditor = dynamic(
  () => import("@/components/BlockNoteEditor").then((mod) => mod.BlockNoteEditor),
  { ssr: false }
);

interface 知识文章 {
  id: string;
  title: string;
}

interface 课程分类 {
  id: string;
  name: string;
}

export default function NewCoursePage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [form, setForm] = useState({
    title: "",
    description: "",
    category_id: "",
    content_type: "document",
    content_text: "",
    duration_minutes: "",
    passing_score: "60",
    is_required: false,
    points: "",
    has_exam: false,
    exam_mode: "online",
    knowledge_article_id: "",
  });

  /* 知识库文章列表 */
  const [knowledgeArticles, setKnowledgeArticles] = useState<知识文章[]>([]);
  /* 课程分类列表 */
  const [categories, setCategories] = useState<课程分类[]>([]);

  useEffect(() => {
    async function loadArticles() {
      await 确保有session();
      const { data } = await supabase
        .from("knowledge_articles")
        .select("id, title")
        .order("created_at", { ascending: false });
      setKnowledgeArticles(data || []);
    }
    async function loadCategories() {
      try {
        await 确保有session();
        const { data, error } = await supabase
          .from("training_categories")
          .select("id, name")
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });
        if (error) {
          alert("加载分类失败: " + error.message);
          return;
        }
        const list = (data || []).map((item) => ({ id: String(item.id), name: String(item.name) }));
        setCategories(list);
        if (list.length > 0 && !form.category_id) {
          setForm((prev) => ({ ...prev, category_id: list[0].id }));
        }
      } catch (err: unknown) {
        alert("加载分类异常: " + (err instanceof Error ? err.message : String(err)));
      }
    }
    loadArticles();
    loadCategories();
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase.from("training_courses").insert({
        title: form.title.trim(),
        description: form.description.trim() || null,
        category_id: form.category_id || null,
        content_type: form.content_type,
        content_text: form.content_type === "document" ? form.content_text.trim() || null : null,
        video_url: form.content_type === "video" ? videoUrl || null : null,
        knowledge_article_id: form.content_type === "knowledge" ? form.knowledge_article_id || null : null,
        duration_minutes: form.duration_minutes ? parseInt(form.duration_minutes) : null,
        passing_score: parseInt(form.passing_score) || 60,
        is_required: form.is_required,
        points: form.points ? parseInt(form.points) : 0,
        has_exam: form.has_exam,
        exam_mode: form.has_exam ? form.exam_mode : "online",
      });

      if (error) throw error;
      router.push("/training");
      router.refresh();
    } catch (err: unknown) {
      alert("保存失败: " + (err instanceof Error ? err.message : String(err)));
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader title="新建课程" />
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">课程标题 *</label>
          <input
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">分类</label>
            <select
              value={form.category_id}
              onChange={(e) => setForm({ ...form, category_id: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {categories.length === 0 && (
              <p className="text-xs text-red-500 mt-1">暂无启用中的分类，请先到课程分类管理中添加</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">内容类型</label>
            <select
              value={form.content_type}
              onChange={(e) => setForm({ ...form, content_type: e.target.value, knowledge_article_id: "" })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="document">文档</option>
              <option value="video">视频</option>
              <option value="knowledge">知识库文章</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">课程描述</label>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>

        {/* 文档内容 */}
        {form.content_type === "document" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">课程内容</label>
            <BlockNoteEditor
              initialValue={form.content_text}
              onChange={(json) => setForm({ ...form, content_text: json })}
            />
          </div>
        )}

        {/* 视频上传 */}
        {form.content_type === "video" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">培训视频</label>
            <VideoUploader
              maxVideos={1}
              existingVideos={videoUrl ? [videoUrl] : []}
              onUpload={(paths) => setVideoUrl(paths[0] || "")}
              maxFileSizeMB={500}
              maxDurationSeconds={1800}
              timeoutMs={300000}
              folder="training"
            />
          </div>
        )}

        {/* 知识库文章选择 */}
        {form.content_type === "knowledge" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">选择知识库文章 *</label>
            <select
              required
              value={form.knowledge_article_id}
              onChange={(e) => setForm({ ...form, knowledge_article_id: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">请选择文章</option>
              {knowledgeArticles.map((a) => (
                <option key={a.id} value={a.id}>{a.title}</option>
              ))}
            </select>
            {knowledgeArticles.length === 0 && (
              <p className="text-xs text-gray-400 mt-1">暂无知识库文章，请先前往知识库添加</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">时长（分钟）</label>
            <input
              type="number"
              value={form.duration_minutes}
              onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">通过分数</label>
            <input
              type="number"
              value={form.passing_score}
              onChange={(e) => setForm({ ...form, passing_score: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">课程积分</label>
            <input
              type="number"
              value={form.points}
              onChange={(e) => setForm({ ...form, points: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="学完获得积分"
            />
          </div>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_required"
              checked={form.is_required}
              onChange={(e) => setForm({ ...form, is_required: e.target.checked })}
              className="rounded"
            />
            <label htmlFor="is_required" className="text-sm text-gray-700">设为必修</label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="has_exam"
              checked={form.has_exam}
              onChange={(e) => setForm({ ...form, has_exam: e.target.checked })}
              className="rounded"
            />
            <label htmlFor="has_exam" className="text-sm text-gray-700">包含考试</label>
          </div>
          {form.has_exam && (
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-700">考试方式</label>
              <select
                value={form.exam_mode}
                onChange={(e) => setForm({ ...form, exam_mode: e.target.value })}
                className="px-2 py-1 border border-gray-300 rounded-lg text-sm"
              >
                <option value="online">线上考试</option>
                <option value="offline">线下考试</option>
              </select>
            </div>
          )}
        </div>
        <div className="flex gap-3 justify-end pt-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "保存中..." : "创建课程"}
          </button>
        </div>
      </form>
    </div>
  );
}

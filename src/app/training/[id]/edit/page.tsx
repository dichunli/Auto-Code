"use client";

import {useState, useEffect, useMemo} from "react";
import { useRouter, useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { VideoUploader } from "@/components/VideoUploader";

const BlockNoteEditor = dynamic(
  () => import("@/components/BlockNoteEditor").then((mod) => mod.BlockNoteEditor),
  { ssr: false }
);

interface Course {
  id: string;
  title: string;
  description: string | null;
  category: string;
  content_type: string;
  content_text: string | null;
  video_url: string | null;
  duration_minutes: number | null;
  passing_score: number;
  is_required: boolean;
  points: number | null;
  has_exam: boolean;
}

export default function EditCoursePage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");

  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "technical",
    content_type: "document",
    content_text: "",
    duration_minutes: "",
    passing_score: "60",
    is_required: false,
    points: "",
    has_exam: false,
  });

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data, error } = await supabase
        .from("training_courses")
        .select("*")
        .eq("id", id)
        .single();
      if (error || !data) {
        alert("加载课程失败: " + (error?.message || "课程不存在"));
        router.push("/training");
        return;
      }
      const course = data as Course;
      setForm({
        title: course.title || "",
        description: course.description || "",
        category: course.category || "technical",
        content_type: course.content_type || "document",
        content_text: course.content_text || "",
        duration_minutes: course.duration_minutes?.toString() || "",
        passing_score: course.passing_score?.toString() || "60",
        is_required: course.is_required || false,
        points: course.points?.toString() || "",
        has_exam: course.has_exam || false,
      });
      setVideoUrl(course.video_url || "");
      setLoading(false);
    }
    load();
  }, [id, supabase, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    try {
      const { error } = await supabase
        .from("training_courses")
        .update({
          title: form.title.trim(),
          description: form.description.trim() || null,
          category: form.category,
          content_type: form.content_type,
          content_text: form.content_type === "document" ? form.content_text.trim() || null : null,
          video_url: form.content_type === "video" ? videoUrl || null : null,
          duration_minutes: form.duration_minutes ? parseInt(form.duration_minutes) : null,
          passing_score: parseInt(form.passing_score) || 60,
          is_required: form.is_required,
          points: form.points ? parseInt(form.points) : 0,
          has_exam: form.has_exam,
        })
        .eq("id", id);

      if (error) throw error;
      router.push(`/training/${id}`);
      router.refresh();
    } catch (err: unknown) {
      alert("保存失败: " + (err instanceof Error ? err.message : String(err)));
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="编辑课程" />
        <div className="text-sm text-gray-500 py-8">加载中...</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="编辑课程" />
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
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="safety">安全</option>
              <option value="technical">技术</option>
              <option value="service">服务</option>
              <option value="management">管理</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">内容类型</label>
            <select
              value={form.content_type}
              onChange={(e) => setForm({ ...form, content_type: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="document">文档</option>
              <option value="video">视频</option>
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
        <div className="flex items-center gap-4">
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
            disabled={saving}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存修改"}
          </button>
        </div>
      </form>
    </div>
  );
}

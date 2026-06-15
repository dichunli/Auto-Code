"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

export default function EditTrainingCategoryPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: "",
    code: "",
    is_active: true,
  });

  useEffect(() => {
    supabase
      .from("training_categories")
      .select("id, name, code, is_active")
      .eq("id", id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          alert("加载失败: " + (error?.message || "分类不存在"));
          router.push("/training/categories");
          return;
        }
        setForm({
          name: String(data.name || ""),
          code: data.code ? String(data.code) : "",
          is_active: Boolean(data.is_active),
        });
        setLoading(false);
      });
  }, [id, supabase, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      alert("请填写分类名称");
      return;
    }
    setSaving(true);

    /* 查重（排除自身） */
    const { data: dup } = await supabase
      .from("training_categories")
      .select("id")
      .ilike("name", form.name.trim())
      .neq("id", id)
      .maybeSingle();
    if (dup) {
      alert("该分类名称已存在，请更换");
      setSaving(false);
      return;
    }

    const { error } = await supabase
      .from("training_categories")
      .update({
        name: form.name.trim(),
        code: form.code.trim() || null,
        is_active: form.is_active,
      })
      .eq("id", id);

    if (error) {
      alert("保存失败: " + error.message);
      setSaving(false);
      return;
    }

    router.push("/training/categories");
    router.refresh();
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="编辑课程分类" />
        <div className="text-sm text-gray-500 py-8">加载中...</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="编辑课程分类" />
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">分类名称 *</label>
            <input
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">分类标识（选填）</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="如 safety、technical，用于系统识别"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_active"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              className="rounded"
            />
            <label htmlFor="is_active" className="text-sm text-gray-700">启用</label>
          </div>
        </div>

        <div className="mt-6 flex gap-3 justify-end">
          <button
            type="button"
            onClick={() => router.push("/training/categories")}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </form>
    </div>
  );
}

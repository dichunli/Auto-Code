"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient, 确保有session } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { 保存培训分类 } from "../../../actions";

interface 课程分类 {
  id: string;
  name: string;
  parent_id: string | null;
}

export default function EditTrainingCategoryPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [allCategories, setAllCategories] = useState<课程分类[]>([]);

  const [form, setForm] = useState({
    name: "",
    code: "",
    parent_id: "" as string,
    is_active: true,
  });

  useEffect(() => {
    /* 加载分类详情和所有分类（用于父分类选择） */
    Promise.all([
      supabase.from("training_categories").select("id, name, code, parent_id, is_active").eq("id", id).single(),
      supabase.from("training_categories").select("id, name, parent_id").neq("id", id).order("sort_order"),
    ]).then(([detail, all]) => {
      if (detail.error || !detail.data) {
        alert("加载失败: " + (detail.error?.message || "分类不存在"));
        router.push("/training/categories");
        return;
      }
      setForm({
        name: String(detail.data.name || ""),
        code: detail.data.code ? String(detail.data.code) : "",
        parent_id: detail.data.parent_id ? String(detail.data.parent_id) : "",
        is_active: Boolean(detail.data.is_active),
      });
      setAllCategories(
        (all.data || []).map((item) => ({
          id: String(item.id),
          name: String(item.name),
          parent_id: item.parent_id ? String(item.parent_id) : null,
        }))
      );
      setLoading(false);
    });
  }, [id, supabase, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      alert("请填写分类名称");
      return;
    }
    /* 不能把自己设为自己的父分类 */
    const parentId = form.parent_id || null;
    if (parentId === id) {
      alert("不能将自己设为父分类");
      return;
    }
    setSaving(true);
    await 确保有session();

    /* 写库走 Server Action（查重、父子校验在服务端兜底） */
    const result = await 保存培训分类({
      id,
      name: form.name,
      code: form.code,
      parentId: form.parent_id,
      isActive: form.is_active,
    });
    if (!result.success) {
      alert("保存失败: " + (result.error || "未知错误"));
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
            <label className="block text-sm font-medium text-gray-700 mb-1">父分类（选填）</label>
            <select
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={form.parent_id}
              onChange={(e) => setForm({ ...form, parent_id: e.target.value })}
            >
              <option value="">无（顶级分类）</option>
              {allCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">分类标识（选填）</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
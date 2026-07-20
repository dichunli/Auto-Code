"use client";

import { useState, useMemo } from "react";
import { createClient, 确保有session } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

interface 专题 {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export default function TopicsContent({
  initialTopics,
}: {
  initialTopics: 专题[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [topics, setTopics] = useState<专题[]>(initialTopics);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [form, setForm] = useState({ name: "", is_active: true });

  async function load() {
    await 确保有session();
    const { data } = await supabase
      .from("training_topics")
      .select("id, name, sort_order, is_active, created_at")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    setTopics(
      (data || []).map((item) => ({
        id: String(item.id),
        name: String(item.name),
        sort_order: Number(item.sort_order),
        is_active: Boolean(item.is_active),
        created_at: String(item.created_at),
      }))
    );
  }

  function openNew() {
    setEditingId(null);
    setForm({ name: "", is_active: true });
    setShowForm(true);
  }

  function openEdit(t: 专题) {
    setEditingId(t.id);
    setForm({ name: t.name, is_active: t.is_active });
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      alert("请填写专题名称");
      return;
    }
    setSaving(true);
    await 确保有session();

    /* 查重 */
    const { data: dup } = await supabase
      .from("training_topics")
      .select("id")
      .ilike("name", form.name.trim())
      .maybeSingle();
    if (dup && dup.id !== editingId) {
      alert("该专题名称已存在，请更换");
      setSaving(false);
      return;
    }

    if (editingId) {
      const { error } = await supabase
        .from("training_topics")
        .update({ name: form.name.trim(), is_active: form.is_active })
        .eq("id", editingId);
      if (error) {
        alert("保存失败: " + error.message);
        setSaving(false);
        return;
      }
    } else {
      const { error } = await supabase.from("training_topics").insert({
        name: form.name.trim(),
        is_active: form.is_active,
      });
      if (error) {
        alert("保存失败: " + error.message);
        setSaving(false);
        return;
      }
    }

    setForm({ name: "", is_active: true });
    setShowForm(false);
    setEditingId(null);
    await load();
    setSaving(false);
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`确定要删除专题「${name}」吗？`)) return;

    await 确保有session();
    /* 先删除关联 */
    await supabase.from("training_course_topics").delete().eq("topic_id", id);
    const { error } = await supabase.from("training_topics").delete().eq("id", id);
    if (error) {
      alert("删除失败: " + error.message);
      return;
    }
    await load();
  }

  return (
    <div>
      <PageHeader
        title="课程专题"
        description="管理课程专题标签，用于跨分类筛选课程"
        action={{
          href: "#",
          label: showForm ? "收起" : "新建专题",
          onClick: () => {
            if (showForm) setShowForm(false);
            else openNew();
          },
        }}
      />

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 bg-white rounded-xl border border-gray-200 p-6 max-w-2xl"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                专题名称 *
              </label>
              <input
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="如：新能源、夏季专项、新员工入职"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="topic_active"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                className="rounded"
              />
              <label htmlFor="topic_active" className="text-sm text-gray-700">启用</label>
            </div>
          </div>
          <div className="mt-6 flex gap-3 justify-end">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "保存中..." : editingId ? "更新" : "保存"}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">专题名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {topics.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 font-medium text-gray-900">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      {t.name}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {t.is_active ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">启用</span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">禁用</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => openEdit(t)}
                        className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => handleDelete(t.id, t.name)}
                        className="text-xs text-red-600 hover:text-red-800 hover:underline"
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {topics.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center text-gray-400">
                    暂无专题，请先新建
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import DeleteButton from "./DeleteButton";

interface 课程分类 {
  id: string;
  name: string;
  code: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export default function TrainingCategoriesContent({
  initialCategories,
}: {
  initialCategories: 课程分类[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [categories, setCategories] = useState<课程分类[]>(initialCategories);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  /* 拖动排序状态 */
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);

  const [form, setForm] = useState({
    name: "",
    code: "",
    is_active: true,
  });

  async function load() {
    const { data } = await supabase
      .from("training_categories")
      .select("id, name, code, sort_order, is_active, created_at")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    setCategories(
      (data || []).map((item) => ({
        id: String(item.id),
        name: String(item.name),
        code: item.code ? String(item.code) : null,
        sort_order: Number(item.sort_order),
        is_active: Boolean(item.is_active),
        created_at: String(item.created_at),
      }))
    );
  }

  function handleDragStart(e: React.DragEvent<HTMLTableRowElement>, id: string) {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  }

  function handleDragOver(e: React.DragEvent<HTMLTableRowElement>, id: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (id !== draggingId) {
      setDragOverId(id);
    }
  }

  function handleDragLeave() {
    setDragOverId(null);
  }

  async function handleDrop(e: React.DragEvent<HTMLTableRowElement>, targetId: string) {
    e.preventDefault();
    setDragOverId(null);
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      return;
    }

    const fromIndex = categories.findIndex((c) => c.id === draggingId);
    const toIndex = categories.findIndex((c) => c.id === targetId);
    if (fromIndex === -1 || toIndex === -1) {
      setDraggingId(null);
      return;
    }

    const newList = [...categories];
    const [moved] = newList.splice(fromIndex, 1);
    newList.splice(toIndex, 0, moved);
    setCategories(newList);
    setDraggingId(null);

    await saveSortOrder(newList);
  }

  function handleDragEnd() {
    setDraggingId(null);
    setDragOverId(null);
  }

  async function saveSortOrder(list: 课程分类[]) {
    setSavingOrder(true);
    try {
      const updates = list.map((item, index) =>
        supabase.from("training_categories").update({ sort_order: index }).eq("id", item.id)
      );
      const results = await Promise.all(updates);
      const errors = results.filter((r) => r.error);
      if (errors.length > 0) {
        alert("排序保存失败: " + errors[0].error?.message);
        await load();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "未知错误";
      alert("排序保存失败: " + msg);
      await load();
    } finally {
      setSavingOrder(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      alert("请填写分类名称");
      return;
    }
    setSaving(true);

    /* 查重 */
    const { data: dup } = await supabase
      .from("training_categories")
      .select("id")
      .ilike("name", form.name.trim())
      .maybeSingle();
    if (dup) {
      alert("该分类名称已存在，请更换");
      setSaving(false);
      return;
    }

    const { error } = await supabase.from("training_categories").insert({
      name: form.name.trim(),
      code: form.code.trim() || null,
      is_active: form.is_active,
    });

    if (error) {
      alert("保存失败: " + error.message);
      setSaving(false);
      return;
    }

    setForm({ name: "", code: "", is_active: true });
    setShowForm(false);
    await load();
    setSaving(false);
  }

  return (
    <div>
      <PageHeader
        title="课程分类"
        description="管理培训课程所属分类"
        action={{
          href: "#",
          label: showForm ? "收起新建" : "新建分类",
          onClick: () => setShowForm((s) => !s),
        }}
      />

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 bg-white rounded-xl border border-gray-200 p-6 max-w-2xl"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">分类名称 *</label>
              <input
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="如：安全、技术、服务、管理"
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
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      )}

      {categories.length > 1 && (
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs text-gray-500">
            <svg className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
            </svg>
            按住左侧图标拖动行可调整分类排序
          </p>
          {savingOrder && (
            <span className="text-xs text-blue-600">正在保存排序...</span>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">分类名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">分类标识</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {categories.map((c) => (
                <tr
                  key={c.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, c.id)}
                  onDragOver={(e) => handleDragOver(e, c.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, c.id)}
                  onDragEnd={handleDragEnd}
                  className={`hover:bg-gray-50 transition-colors cursor-move select-none ${
                    draggingId === c.id ? "opacity-50 bg-blue-50" : ""
                  } ${dragOverId === c.id && dragOverId !== draggingId ? "border-t-2 border-blue-500 bg-blue-50" : ""}`}
                >
                  <td className="px-6 py-4 font-medium text-gray-900">
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                      </svg>
                      {c.name}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {c.code || "-"}
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {c.is_active ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        启用
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                        禁用
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/training/categories/${c.id}/edit`}
                        className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        编辑
                      </Link>
                      <DeleteButton id={c.id} name={c.name} />
                    </div>
                  </td>
                </tr>
              ))}
              {categories.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-6 py-12 text-center text-gray-400"
                  >
                    暂无分类，请先新建
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

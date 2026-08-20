"use client";

import { useState, useMemo } from "react";
import { createClient, 确保有session } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { useConfirm } from "@/components/ConfirmDialog";

interface 课程分类 {
  id: string;
  name: string;
  code: string | null;
  parent_id: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  children?: 课程分类[];
}

/* 将扁平列表构建为树 */
function 构建分类树(flatList: 课程分类[]): 课程分类[] {
  const map = new Map<string, 课程分类>();
  const roots: 课程分类[] = [];
  for (const item of flatList) {
    map.set(item.id, { ...item, children: [] });
  }
  for (const item of map.values()) {
    if (item.parent_id && map.has(item.parent_id)) {
      map.get(item.parent_id)!.children!.push(item);
    } else {
      roots.push(item);
    }
  }
  return roots;
}

/* 递归渲染分类行 */
function CategoryRow({
  item,
  depth,
  onEdit,
  onDelete,
}: {
  item: 课程分类;
  depth: number;
  onEdit: (id: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = item.children && item.children.length > 0;

  return (
    <>
      <tr className="hover:bg-gray-50 transition-colors">
        <td className="px-6 py-3" style={{ paddingLeft: `${16 + depth * 24}px` }}>
          <div className="flex items-center gap-2">
            {hasChildren ? (
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-gray-400 hover:text-gray-600 flex-shrink-0"
              >
                <svg
                  className={`w-4 h-4 transition-transform ${expanded ? "rotate-90" : ""}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ) : (
              <span className="w-4 flex-shrink-0" />
            )}
            <span className="font-medium text-gray-900">{item.name}</span>
          </div>
        </td>
        <td className="px-6 py-3 text-gray-600">{item.code || "-"}</td>
        <td className="px-6 py-3">
          {item.is_active ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">启用</span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">禁用</span>
          )}
        </td>
        <td className="px-6 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => onEdit(item.id)} className="text-xs text-blue-600 hover:text-blue-800 hover:underline">
              编辑
            </button>
            <button onClick={() => onDelete(item.id, item.name)} className="text-xs text-red-600 hover:text-red-800 hover:underline">
              删除
            </button>
          </div>
        </td>
      </tr>
      {hasChildren && expanded && item.children!.map((child) => (
        <CategoryRow
          key={child.id}
          item={child}
          depth={depth + 1}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}

export default function TrainingCategoriesContent({
  initialCategories,
}: {
  initialCategories: 课程分类[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [categories, setCategories] = useState<课程分类[]>(initialCategories);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { 请求确认, 确认弹窗 } = useConfirm();

  const [form, setForm] = useState({
    name: "",
    code: "",
    parent_id: "" as string,
    is_active: true,
  });

  const 分类树 = useMemo(() => 构建分类树(categories), [categories]);

  async function load() {
    await 确保有session();
    const { data } = await supabase
      .from("training_categories")
      .select("id, name, code, parent_id, sort_order, is_active, created_at")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    setCategories(
      (data || []).map((item) => ({
        id: String(item.id),
        name: String(item.name),
        code: item.code ? String(item.code) : null,
        parent_id: item.parent_id ? String(item.parent_id) : null,
        sort_order: Number(item.sort_order),
        is_active: Boolean(item.is_active),
        created_at: String(item.created_at),
      }))
    );
  }

  function openNew() {
    setEditingId(null);
    setForm({ name: "", code: "", parent_id: "", is_active: true });
    setShowForm(true);
  }

  function openEdit(id: string) {
    const cat = categories.find((c) => c.id === id);
    if (!cat) return;
    setEditingId(id);
    setForm({
      name: cat.name,
      code: cat.code || "",
      parent_id: cat.parent_id || "",
      is_active: cat.is_active,
    });
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      alert("请填写分类名称");
      return;
    }
    setSaving(true);
    await 确保有session();

    /* 查重 */
    const { data: dup } = await supabase
      .from("training_categories")
      .select("id")
      .ilike("name", form.name.trim())
      .maybeSingle();
    if (dup && dup.id !== editingId) {
      alert("该分类名称已存在，请更换");
      setSaving(false);
      return;
    }

    /* 不能把自己设为自己的父分类 */
    const parentId = form.parent_id || null;
    if (editingId && parentId === editingId) {
      alert("不能将自己设为父分类");
      setSaving(false);
      return;
    }

    const payload = {
      name: form.name.trim(),
      code: form.code.trim() || null,
      parent_id: parentId,
      is_active: form.is_active,
    };

    if (editingId) {
      const { error } = await supabase
        .from("training_categories")
        .update(payload)
        .eq("id", editingId);
      if (error) {
        alert("保存失败: " + error.message);
        setSaving(false);
        return;
      }
    } else {
      const { error } = await supabase.from("training_categories").insert(payload);
      if (error) {
        alert("保存失败: " + error.message);
        setSaving(false);
        return;
      }
    }

    setForm({ name: "", code: "", parent_id: "", is_active: true });
    setShowForm(false);
    setEditingId(null);
    await load();
    setSaving(false);
  }

  async function handleDelete(id: string, name: string) {
    if (!(await 请求确认(`确定要删除分类「${name}」吗？`))) return;
    await 确保有session();

    /* 检查是否有子分类 */
    const { data: children } = await supabase
      .from("training_categories")
      .select("id")
      .eq("parent_id", id)
      .limit(1);
    if (children && children.length > 0) {
      alert("该分类下有子分类，请先删除子分类");
      return;
    }

    /* 检查是否有关联课程 */
    const { data: courses } = await supabase
      .from("training_courses")
      .select("id")
      .eq("category_id", id)
      .limit(1);
    if (courses && courses.length > 0) {
      alert("该分类下有课程，请先将课程移动到其他分类");
      return;
    }

    const { error } = await supabase
      .from("training_categories")
      .delete()
      .eq("id", id);
    if (error) {
      alert("删除失败: " + error.message);
      return;
    }
    await load();
  }

  /* 可选父分类列表（排除自己） */
  const 可选父分类 = categories.filter((c) => c.id !== editingId);

  return (
    <div>
      <PageHeader
        title="课程分类"
        description="管理培训课程分类，支持多级嵌套"
        action={{
          href: "#",
          label: showForm ? "收起" : "新建分类",
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
              <label className="block text-sm font-medium text-gray-700 mb-1">父分类（选填，留空为顶级分类）</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.parent_id}
                onChange={(e) => setForm({ ...form, parent_id: e.target.value })}
              >
                <option value="">无（顶级分类）</option>
                {可选父分类.map((c) => (
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
                placeholder="如 safety、technical"
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
                <th className="px-6 py-3 text-left font-medium text-gray-500">分类名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">标识</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {分类树.map((item) => (
                <CategoryRow
                  key={item.id}
                  item={item}
                  depth={0}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                />
              ))}
              {分类树.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-gray-400">
                    暂无分类，请先新建
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {确认弹窗}
    </div>
  );
}
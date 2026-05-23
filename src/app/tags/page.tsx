"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DeleteButton } from "./DeleteButton";

const PRESET_COLORS = [
  { value: "#3b82f6", label: "蓝色" },
  { value: "#ef4444", label: "红色" },
  { value: "#22c55e", label: "绿色" },
  { value: "#f59e0b", label: "橙色" },
  { value: "#8b5cf6", label: "紫色" },
  { value: "#ec4899", label: "粉色" },
  { value: "#06b6d4", label: "青色" },
  { value: "#6b7280", label: "灰色" },
];

interface Tag {
  id: string;
  name: string;
  color: string;
}

export default function TagsPage() {
  const supabase = createClient();
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#3b82f6");

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#3b82f6");

  const loadTags = useCallback(async () => {
    const { data } = await supabase
      .from("tags")
      .select("id, name, color")
      .order("created_at", { ascending: false });
    setTags((data || []) as Tag[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) {
      alert("请输入标签名称");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("tags").insert({
      name: newName.trim(),
      color: newColor,
    });
    if (error) {
      alert("保存失败: " + error.message);
      setSaving(false);
      return;
    }
    setNewName("");
    setNewColor("#3b82f6");
    setShowForm(false);
    loadTags();
    setSaving(false);
  }

  function startEdit(tag: Tag) {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color || "#3b82f6");
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId || !editName.trim()) {
      alert("请输入标签名称");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("tags")
      .update({ name: editName.trim(), color: editColor })
      .eq("id", editingId);
    if (error) {
      alert("更新失败: " + error.message);
      setSaving(false);
      return;
    }
    setEditingId(null);
    loadTags();
    setSaving(false);
  }

  return (
    <div>
      <PageHeader title="客户标签" />

      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-500">共 {tags.length} 个标签</p>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
        >
          {showForm ? "取消新建" : "+ 新建标签"}
        </button>
      </div>

      {showForm && (
        <div className="mb-6 bg-white rounded-xl border border-gray-200 p-6 max-w-lg">
          <h2 className="text-base font-semibold text-gray-900 mb-4">新建标签</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">标签名称 *</label>
              <input
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="如：VIP、老客户、新客户"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">标签颜色</label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setNewColor(c.value)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                      newColor === c.value
                        ? "border-blue-500 bg-blue-50 text-blue-700 ring-1 ring-blue-500"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: c.value }}
                    />
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <span
                className="px-3 py-1 text-sm text-white rounded-full"
                style={{ backgroundColor: newColor }}
              >
                {newName.trim() || "预览"}
              </span>
            </div>
            <div className="flex gap-3 justify-end pt-2">
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
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">标签名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">颜色</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tags.map((tag) => (
                <tr key={tag.id} className="hover:bg-gray-50">
                  {editingId === tag.id ? (
                    <>
                      <td className="px-6 py-3" colSpan={3}>
                        <form onSubmit={handleUpdate} className="flex items-center gap-3">
                          <input
                            autoFocus
                            className="flex-1 max-w-xs px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                          />
                          <div className="flex flex-wrap gap-1">
                            {PRESET_COLORS.map((c) => (
                              <button
                                key={c.value}
                                type="button"
                                onClick={() => setEditColor(c.value)}
                                className={`w-6 h-6 rounded-full border-2 transition-transform ${
                                  editColor === c.value
                                    ? "border-gray-800 scale-110"
                                    : "border-transparent hover:scale-105"
                                }`}
                                style={{ backgroundColor: c.value }}
                                title={c.label}
                              />
                            ))}
                          </div>
                          <button
                            type="submit"
                            disabled={saving}
                            className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                          >
                            {saving ? "保存中..." : "保存"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800"
                          >
                            取消
                          </button>
                        </form>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-6 py-4">
                        <span
                          className="px-3 py-1 text-sm text-white rounded-full"
                          style={{ backgroundColor: tag.color || "#3b82f6" }}
                        >
                          {tag.name}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-4 h-4 rounded-full"
                            style={{ backgroundColor: tag.color || "#3b82f6" }}
                          />
                          <span className="text-gray-500">{tag.color || "#3b82f6"}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => startEdit(tag)}
                            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                          >
                            编辑
                          </button>
                          <DeleteButton id={tag.id} name={tag.name} />
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {tags.length === 0 && !loading && (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center text-gray-400">
                    暂无标签，点击上方「新建标签」按钮添加
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

"use client";

import {useState, useEffect, useMemo} from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

interface 分类 {
  id: string;
  name: string;
  sort_order: number;
}

export default function KnowledgeCategoriesPage() {
  const supabase = useMemo(() => createClient(), []);
  const [categories, setCategories] = useState<分类[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  /* 表单状态 */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formSort, setFormSort] = useState("0");

  async function loadCategories() {
    const { data } = await supabase
      .from("knowledge_categories")
      .select("id, name, sort_order")
      .order("sort_order", { ascending: true })
      .limit(100);
    setCategories(data || []);
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("knowledge_categories")
      .select("id, name, sort_order")
      .order("sort_order", { ascending: true })
      .limit(100)
      .then(({ data }) => {
        if (!cancelled) {
          setCategories(data || []);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [supabase]);

  function startEdit(c: 分类) {
    setEditingId(c.id);
    setFormName(c.name);
    setFormSort(String(c.sort_order));
  }

  function startNew() {
    setEditingId("new");
    setFormName("");
    setFormSort(String((categories.length + 1) * 10));
  }

  function cancelEdit() {
    setEditingId(null);
    setFormName("");
    setFormSort("0");
  }

  async function handleSave() {
    const name = formName.trim();
    if (!name) {
      alert("分类名称不能为空");
      return;
    }
    setSaving(true);

    try {
      if (editingId === "new") {
        const { error } = await supabase
          .from("knowledge_categories")
          .insert({ name, sort_order: parseInt(formSort, 10) || 0 });
        if (error) throw error;
      } else if (editingId) {
        const { error } = await supabase
          .from("knowledge_categories")
          .update({ name, sort_order: parseInt(formSort, 10) || 0 })
          .eq("id", editingId);
        if (error) throw error;
      }

      await loadCategories();
      cancelEdit();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      alert("保存失败: " + message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`确定要删除分类「${name}」吗？`)) return;

    try {
      const { error } = await supabase
        .from("knowledge_categories")
        .delete()
        .eq("id", id);
      if (error) throw error;
      await loadCategories();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      alert("删除失败: " + message);
    }
  }

  return (
    <div>
      <PageHeader
        title="知识库分类管理"
        description="管理知识库文章分类"
        action={{ href: "/knowledge", label: "返回知识库" }}
      />

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        {/* 分类列表 */}
        <div className="space-y-2 mb-6">
          {loading && <p className="text-gray-400 text-center py-8">加载中...</p>}
          {!loading && categories.length === 0 && (
            <p className="text-gray-400 text-center py-8">暂无分类</p>
          )}
          {categories.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between px-4 py-3 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
            >
              {editingId === c.id ? (
                <div className="flex items-center gap-3 flex-1">
                  <input
                    className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="分类名称"
                    autoFocus
                  />
                  <input
                    type="number"
                    className="w-20 px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
                    value={formSort}
                    onChange={(e) => setFormSort(e.target.value)}
                    placeholder="排序"
                  />
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-900">{c.name}</span>
                    <span className="text-xs text-gray-400">排序: {c.sort_order}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(c)}
                      className="text-xs px-2 py-1 text-gray-600 border border-gray-200 rounded hover:bg-gray-50"
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(c.id, c.name)}
                      className="text-xs px-2 py-1 text-red-600 border border-red-200 rounded hover:bg-red-50"
                    >
                      删除
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {/* 新建分类 */}
        {editingId === "new" ? (
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">新建分类</h3>
            <div className="flex items-center gap-3">
              <input
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="分类名称"
                autoFocus
              />
              <input
                type="number"
                className="w-24 px-3 py-2 text-sm border border-gray-300 rounded-lg"
                value={formSort}
                onChange={(e) => setFormSort(e.target.value)}
                placeholder="排序号"
              />
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "保存中..." : "保存"}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={startNew}
            className="w-full px-4 py-3 text-sm text-blue-600 border border-dashed border-blue-300 rounded-lg hover:bg-blue-50 transition-colors"
          >
            + 新建分类
          </button>
        )}
      </div>
    </div>
  );
}

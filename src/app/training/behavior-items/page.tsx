"use client";

import {useState, useEffect, useMemo} from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

interface 行为项目 {
  id: string;
  name: string;
  score_type: string;
  score_value: number;
  description: string | null;
  is_active: boolean;
}

export default function BehaviorItemsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<行为项目[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  /* 弹窗 */
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<行为项目 | null>(null);
  const [form, setForm] = useState({
    name: "",
    score_type: "bonus",
    score_value: "",
    description: "",
    is_active: true,
  });

  async function fetchItems() {
    setLoading(true);
    const { data } = await supabase
      .from("behavior_score_items")
      .select("*")
      .order("created_at", { ascending: false });
    setItems((data as 行为项目[] | null) || []);
    setLoading(false);
  }

  useEffect(() => {
    fetchItems();
  }, [supabase]);

  function openAdd() {
    setEditingItem(null);
    setForm({ name: "", score_type: "bonus", score_value: "", description: "", is_active: true });
    setModalOpen(true);
  }

  function openEdit(item: 行为项目) {
    setEditingItem(item);
    setForm({
      name: item.name,
      score_type: item.score_type,
      score_value: String(item.score_value),
      description: item.description || "",
      is_active: item.is_active,
    });
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      alert("请输入项目名称");
      return;
    }
    if (!form.score_value || parseInt(form.score_value) <= 0) {
      alert("请输入有效分值");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        score_type: form.score_type,
        score_value: parseInt(form.score_value),
        description: form.description.trim() || null,
        is_active: form.is_active,
      };

      if (editingItem) {
        const { error } = await supabase.from("behavior_score_items").update(payload).eq("id", editingItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("behavior_score_items").insert(payload);
        if (error) throw error;
      }

      setModalOpen(false);
      fetchItems();
    } catch (err: unknown) {
      alert("保存失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("确定删除这个项目吗？已有的打分记录将保留，但无法再使用此项目打新分。")) return;
    const { error } = await supabase.from("behavior_score_items").delete().eq("id", id);
    if (error) {
      alert("删除失败: " + error.message);
      return;
    }
    fetchItems();
  }

  return (
    <div>
      <PageHeader
        title="行为规范项目"
        description="配置日常行为加减分项目"
        action={{ label: "+ 添加项目", onClick: openAdd }}
      />

      {loading ? (
        <div className="p-8 text-center text-gray-400">加载中...</div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-500">暂无项目，点击上方按钮添加</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">项目名称</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">类型</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">分值</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">说明</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{item.name}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        item.score_type === "bonus"
                          ? "bg-green-50 text-green-700 border border-green-200"
                          : "bg-red-50 text-red-700 border border-red-200"
                      }`}
                    >
                      {item.score_type === "bonus" ? "加分" : "减分"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={item.score_type === "bonus" ? "text-green-600" : "text-red-600"}>
                      {item.score_type === "bonus" ? "+" : "-"}
                      {item.score_value}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{item.description || "-"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        item.is_active
                          ? "bg-blue-50 text-blue-700 border border-blue-200"
                          : "bg-gray-50 text-gray-500 border border-gray-200"
                      }`}
                    >
                      {item.is_active ? "启用" : "停用"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openEdit(item)}
                      className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-50 rounded border border-blue-200 mr-2"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="text-xs px-2 py-1 text-red-600 hover:bg-red-50 rounded border border-red-200"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 弹窗 */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md">
            <h3 className="text-base font-semibold text-gray-900 mb-4">
              {editingItem ? "编辑项目" : "添加项目"}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">项目名称 *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="如：发现安全隐患"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">类型</label>
                  <select
                    value={form.score_type}
                    onChange={(e) => setForm({ ...form, score_type: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="bonus">加分</option>
                    <option value="penalty">减分</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">分值 *</label>
                  <input
                    type="number"
                    value={form.score_value}
                    onChange={(e) => setForm({ ...form, score_value: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="如：5"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">说明</label>
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="简要说明此项目的适用场景..."
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
                <label htmlFor="is_active" className="text-sm text-gray-700">
                  启用
                </label>
              </div>
            </div>
            <div className="flex gap-3 justify-end pt-4 mt-4 border-t border-gray-100">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

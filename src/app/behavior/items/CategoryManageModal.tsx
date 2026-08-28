"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useConfirm } from "@/components/ConfirmDialog";
import { 删除行为分类, 新建行为分类, 更新行为分类, 切换行为分类启用 } from "./actions";

export interface 行为分类 {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

interface Props {
  categories: 行为分类[];
  onClose: () => void;
  /* 分类数据变更后通知父组件重查 */
  onChanged: () => void;
}

/* 行为分类管理弹窗：新增/行内改名/排序/启停/删除 */
export default function CategoryManageModal({ categories, onClose, onChanged }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const { 请求确认, 确认弹窗 } = useConfirm();
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  /* 行内编辑状态：正在编辑的分类 id 与草稿值 */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSort, setEditSort] = useState("");

  async function handleAdd() {
    const name = newName.trim();
    if (!name) {
      alert("请输入分类名称");
      return;
    }
    setSaving(true);
    /* 写库走 Server Action */
    const result = await 新建行为分类(name);
    setSaving(false);
    if (!result.success) {
      alert(result.error || "新增失败");
      return;
    }
    setNewName("");
    onChanged();
  }

  function startEdit(c: 行为分类) {
    setEditingId(c.id);
    setEditName(c.name);
    setEditSort(String(c.sort_order ?? 0));
  }

  async function saveEdit() {
    if (!editingId) return;
    const name = editName.trim();
    if (!name) {
      alert("分类名称不能为空");
      return;
    }
    setSaving(true);
    const result = await 更新行为分类({ id: editingId, name, sortOrder: parseInt(editSort) || 0 });
    setSaving(false);
    if (!result.success) {
      alert(result.error || "保存失败");
      return;
    }
    setEditingId(null);
    onChanged();
  }

  async function toggleActive(c: 行为分类) {
    const result = await 切换行为分类启用({ id: c.id, isActive: !c.is_active });
    if (!result.success) {
      alert("操作失败: " + (result.error || "未知错误"));
      return;
    }
    onChanged();
  }

  async function handleDelete(c: 行为分类) {
    /* 有项目引用时建议停用而不是删除（删除会把这些项目变成"未分类"） */
    const { count } = await supabase
      .from("behavior_score_items")
      .select("id", { count: "exact", head: true })
      .eq("category_id", c.id);
    if (count && count > 0) {
      alert(`该分类下还有 ${count} 个行为项目，删除后这些项目会变成"未分类"。\n如不再使用，建议改为"停用"。`);
      return;
    }
    if (!(await 请求确认(`确定删除分类「${c.name}」吗？`))) return;
    const result = await 删除行为分类(c.id);
    if (!result.success) {
      alert("删除失败: " + (result.error || "未知错误"));
      return;
    }
    onChanged();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-lg max-h-[80vh] flex flex-col">
        <h3 className="text-base font-semibold text-gray-900 mb-4">分类管理</h3>

        {/* 新增 */}
        <div className="flex gap-2 mb-4">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
            placeholder="新分类名称，如：早会检查卫生"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <button
            onClick={handleAdd}
            disabled={saving}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            添加
          </button>
        </div>

        {/* 分类列表 */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-lg">
          {categories.length === 0 ? (
            <p className="p-6 text-center text-sm text-gray-400">暂无分类</p>
          ) : (
            categories.map((c) => (
              <div key={c.id} className="flex items-center gap-2 px-3 py-2">
                {editingId === c.id ? (
                  <>
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                    <input
                      type="number"
                      value={editSort}
                      onChange={(e) => setEditSort(e.target.value)}
                      className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                      title="排序号，小的排前面"
                    />
                    <button onClick={saveEdit} className="text-xs px-2 py-1 text-white bg-blue-600 rounded">保存</button>
                    <button onClick={() => setEditingId(null)} className="text-xs px-2 py-1 text-gray-600 border border-gray-300 rounded">取消</button>
                  </>
                ) : (
                  <>
                    <span className={`flex-1 text-sm ${c.is_active ? "text-gray-900" : "text-gray-400 line-through"}`}>
                      {c.name}
                    </span>
                    <span className="text-xs text-gray-400 w-10 text-center" title="排序号，小的排前面">
                      #{c.sort_order}
                    </span>
                    <button onClick={() => startEdit(c)} className="text-xs px-2 py-1 text-blue-600 border border-blue-200 rounded hover:bg-blue-50">
                      编辑
                    </button>
                    <button
                      onClick={() => toggleActive(c)}
                      className={`text-xs px-2 py-1 rounded border ${
                        c.is_active
                          ? "text-yellow-700 border-yellow-200 hover:bg-yellow-50"
                          : "text-green-700 border-green-200 hover:bg-green-50"
                      }`}
                    >
                      {c.is_active ? "停用" : "启用"}
                    </button>
                    <button onClick={() => handleDelete(c)} className="text-xs px-2 py-1 text-red-600 border border-red-200 rounded hover:bg-red-50">
                      删除
                    </button>
                  </>
                )}
              </div>
            ))
          )}
        </div>

        <div className="flex justify-end pt-4 mt-2 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            关闭
          </button>
        </div>
      </div>
      {确认弹窗}
    </div>
  );
}

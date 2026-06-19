"use client";

import { useState } from "react";
import {
  创建收款方式,
  更新收款方式,
  删除收款方式,
  更新收款方式排序,
  获取收款方式列表,
} from "./actions";

interface 收款方式 {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

interface PaymentMethodsContentProps {
  初始数据: 收款方式[];
}

export default function PaymentMethodsContent({ 初始数据 }: PaymentMethodsContentProps) {
  const [methods, setMethods] = useState<收款方式[]>(初始数据);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSort, setEditSort] = useState(0);
  const [editActive, setEditActive] = useState(true);

  async function 刷新列表() {
    const res = await 获取收款方式列表();
    if (res.success && res.data) {
      setMethods(res.data);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newCode.trim() || !newName.trim()) {
      alert("请输入编码和名称");
      return;
    }
    setSaving(true);
    const res = await 创建收款方式({
      code: newCode.trim(),
      name: newName.trim(),
      sort_order: methods.length + 1,
    });
    setSaving(false);

    if (!res.success) {
      alert(res.error || "保存失败");
      return;
    }

    setNewCode("");
    setNewName("");
    setShowForm(false);
    await 刷新列表();
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId || !editName.trim()) {
      alert("请输入名称");
      return;
    }
    setSaving(true);
    const res = await 更新收款方式({
      id: editingId,
      name: editName.trim(),
      sort_order: editSort,
      is_active: editActive,
    });
    setSaving(false);

    if (!res.success) {
      alert(res.error || "更新失败");
      return;
    }

    setEditingId(null);
    await 刷新列表();
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`确定删除「${name}」吗？`)) return;
    const res = await 删除收款方式(id);
    if (!res.success) {
      alert(res.error || "删除失败");
      return;
    }
    await 刷新列表();
  }

  async function saveSort(id: string, sortOrder: number) {
    setSaving(true);
    const res = await 更新收款方式排序({ id, sort_order: sortOrder });
    setSaving(false);

    if (!res.success) {
      alert(res.error || "排序保存失败");
      return;
    }
    await 刷新列表();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-500">共 {methods.length} 种</p>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
        >
          {showForm ? "取消" : "+ 新建收款方式"}
        </button>
      </div>

      {showForm && (
        <div className="mb-6 bg-white rounded-xl border border-gray-200 p-6 max-w-lg">
          <h2 className="text-base font-semibold text-gray-900 mb-4">新建收款方式</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                编码（英文，如 cash、wechat）*
              </label>
              <input
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                placeholder="cash"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">显示名称 *</label>
              <input
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="现金"
              />
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
                <th className="px-6 py-3 text-left font-medium text-gray-500">排序</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">编码</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {methods.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50">
                  {editingId === m.id ? (
                    <td colSpan={5} className="px-6 py-3">
                      <form onSubmit={handleUpdate} className="flex items-center gap-3 flex-wrap">
                        <input
                          type="number"
                          className="w-16 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                          value={editSort}
                          onChange={(e) => setEditSort(parseInt(e.target.value) || 0)}
                        />
                        <span className="text-sm text-gray-500">{m.code}</span>
                        <input
                          autoFocus
                          className="flex-1 max-w-xs px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                        />
                        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editActive}
                            onChange={(e) => setEditActive(e.target.checked)}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600"
                          />
                          启用
                        </label>
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
                  ) : (
                    <>
                      <td className="px-6 py-4">
                        <input
                          type="number"
                          min={0}
                          defaultValue={m.sort_order}
                          disabled={saving}
                          onBlur={(e) => {
                            const val = parseInt(e.target.value) || 0;
                            if (val !== m.sort_order) {
                              saveSort(m.id, val);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          className="w-14 px-2 py-1 text-sm border border-gray-300 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                        />
                      </td>
                      <td className="px-6 py-4 text-gray-500 font-mono text-xs">{m.code}</td>
                      <td className="px-6 py-4 font-medium text-gray-900">{m.name}</td>
                      <td className="px-6 py-4">
                        {m.is_active ? (
                          <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700">启用</span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500">停用</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => {
                              setEditingId(m.id);
                              setEditName(m.name);
                              setEditSort(m.sort_order);
                              setEditActive(m.is_active);
                            }}
                            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                          >
                            编辑
                          </button>
                          <button
                            onClick={() => handleDelete(m.id, m.name)}
                            className="text-sm text-red-600 hover:text-red-700 font-medium"
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {methods.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-400">
                    暂无收款方式，点击上方「新建收款方式」添加
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

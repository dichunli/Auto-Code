"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { useConfirm } from "@/components/ConfirmDialog";
import { 新建收款方式, 更新收款方式, 删除收款方式, 保存收款方式排序 } from "./actions";

interface 操作员 {
  id: string;
  full_name: string;
}

interface 收款方式 {
  id: string;
  name: string;
  operator_id: string | null;
  operator_name?: string;
  sort_order: number;
  is_active: boolean;
}

export default function OtherPaymentMethodsPage() {
  const [operators, setOperators] = useState<操作员[]>([]);
  const [methods, setMethods] = useState<收款方式[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newOperatorId, setNewOperatorId] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editOperatorId, setEditOperatorId] = useState("");
  const [editActive, setEditActive] = useState(true);

  /* 拖拽排序状态 */
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const { 请求确认, 确认弹窗 } = useConfirm();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const supabase = createClient();
    const [{ data: ops }, { data: pms }] = await Promise.all([
      supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
      supabase
        .from("other_payment_methods")
        .select("id, name, operator_id, sort_order, is_active, profiles(full_name)")
        .order("sort_order", { ascending: true }),
    ]);

    setOperators(ops || []);

    const formatted = (pms || []).map((m: Record<string, unknown>) => ({
      id: m.id as string,
      name: m.name as string,
      operator_id: m.operator_id as string | null,
      operator_name: (m.profiles as { full_name?: string } | null)?.full_name || "",
      sort_order: (m.sort_order as number) || 0,
      is_active: (m.is_active as boolean) ?? true,
    }));
    setMethods(formatted);
    setLoading(false);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) {
      alert("请输入收款方式名称");
      return;
    }

    setSaving(true);
    try {
      const result = await 新建收款方式({
        name: newName,
        operatorId: newOperatorId,
        sortOrder: methods.length + 1,
      });
      setSaving(false);
      if (!result.success) {
        alert("保存失败：" + (result.error || "未知错误"));
        return;
      }
    } catch {
      setSaving(false);
      alert("保存失败：网络异常，请重试");
      return;
    }

    setNewName("");
    setNewOperatorId("");
    setShowForm(false);
    loadData();
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId || !editName.trim()) {
      alert("请输入名称");
      return;
    }

    setSaving(true);
    try {
      const result = await 更新收款方式({
        id: editingId,
        name: editName,
        operatorId: editOperatorId,
        isActive: editActive,
      });
      setSaving(false);
      if (!result.success) {
        alert("保存失败：" + (result.error || "未知错误"));
        return;
      }
    } catch {
      setSaving(false);
      alert("保存失败：网络异常，请重试");
      return;
    }

    setEditingId(null);
    loadData();
  }

  async function handleDelete(id: string, name: string) {
    if (!(await 请求确认(`确定删除「${name}」吗？`))) return;

    /* 被使用检查在服务端做，防并发误删 */
    try {
      const result = await 删除收款方式(id);
      if (!result.success) {
        alert("删除失败：" + (result.error || "未知错误"));
        return;
      }
    } catch {
      alert("删除失败：网络异常，请重试");
      return;
    }
    loadData();
  }

  /* 拖拽排序 */
  function handleDragStart(index: number) {
    setDragIndex(index);
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    setDragOverIndex(index);
  }

  async function handleDrop(e: React.DragEvent, toIndex: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === toIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }

    const newItems = [...methods];
    const [moved] = newItems.splice(dragIndex, 1);
    newItems.splice(toIndex, 0, moved);

    const reordered = newItems.map((item, index) => ({
      ...item,
      sort_order: (index + 1) * 10,
    }));

    setMethods(reordered);
    setDragIndex(null);
    setDragOverIndex(null);

    /* 批量更新走 Server Action */
    setSaving(true);
    try {
      const result = await 保存收款方式排序({
        items: reordered.map((item) => ({ id: item.id, sort_order: item.sort_order })),
      });
      if (!result.success) {
        alert("排序保存失败：" + (result.error || "未知错误"));
      }
    } catch {
      alert("排序保存失败：网络异常，请重试");
    }
    setSaving(false);
  }

  function handleDragEnd() {
    setDragIndex(null);
    setDragOverIndex(null);
  }

  return (
    <div>
      <PageHeader
        title="其它收支收款方式"
        description="管理每个操作员可用的收款/付款方式"
        action={{ onClick: () => setShowForm((v) => !v), label: showForm ? "取消" : "新建" }}
      />

      {saving && (
        <div className="mb-3 text-sm text-blue-600">正在保存排序...</div>
      )}

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6 max-w-lg">
          <h3 className="font-medium text-gray-900 mb-4">新建收款方式</h3>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">名称 *</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="如：邸春利-微信支付"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">所属操作员</label>
              <select
                value={newOperatorId}
                onChange={(e) => setNewOperatorId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">全部（不指定）</option>
                {operators.map((op) => (
                  <option key={op.id} value={op.id}>{op.full_name}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400">加载中...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 w-10"></th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">排序</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">名称</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">所属操作员</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">状态</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {methods.map((m, index) => (
                  <tr
                    key={m.id}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDrop={(e) => handleDrop(e, index)}
                    onDragEnd={handleDragEnd}
                    className={`hover:bg-gray-50 cursor-move transition-colors ${
                      dragIndex === index ? "opacity-50" : ""
                    } ${dragOverIndex === index ? "bg-blue-50" : ""}`}
                  >
                    {editingId === m.id ? (
                      <td colSpan={6} className="px-4 py-3">
                        <form onSubmit={handleUpdate} className="flex items-center gap-3 flex-wrap">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                          </svg>
                          <span className="text-sm text-gray-500 w-8">{m.sort_order}</span>
                          <input
                            autoFocus
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="flex-1 min-w-[120px] max-w-xs px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                          />
                          <select
                            value={editOperatorId}
                            onChange={(e) => setEditOperatorId(e.target.value)}
                            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                          >
                            <option value="">全部</option>
                            {operators.map((op) => (
                              <option key={op.id} value={op.id}>{op.full_name}</option>
                            ))}
                          </select>
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
                        <td className="px-4 py-3">
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                          </svg>
                        </td>
                        <td className="px-4 py-3 text-gray-500">{m.sort_order}</td>
                        <td className="px-4 py-3 font-medium text-gray-900">{m.name}</td>
                        <td className="px-4 py-3 text-gray-600">{m.operator_name || "全部"}</td>
                        <td className="px-4 py-3">
                          {m.is_active ? (
                            <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700">启用</span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500">停用</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-3">
                            <button
                              onClick={() => {
                                setEditingId(m.id);
                                setEditName(m.name);
                                setEditOperatorId(m.operator_id || "");
                                setEditActive(m.is_active);
                              }}
                              className="text-xs text-blue-600 hover:underline"
                            >
                              编辑
                            </button>
                            <button
                              onClick={() => handleDelete(m.id, m.name)}
                              className="text-xs text-red-600 hover:underline"
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
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                      暂无收款方式，点击上方「新建」添加
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {确认弹窗}
    </div>
  );
}

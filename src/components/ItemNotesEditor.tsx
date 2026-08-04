"use client";

import { createClient } from "@/lib/supabase/client";
import { useState } from "react";

interface Props {
  itemId: string;
  description: string | null;
  /* 只读（保养单未进编辑模式 / 工单已锁定）：备注仅展示，不可编辑 */
  disabled?: boolean;
}

export function ItemNotesEditor({ itemId, description, disabled = false }: Props) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  // 用本地状态保存已生效的备注，保存成功后只更新这一小块，不刷新整页（性能优化）
  const [savedDesc, setSavedDesc] = useState(description || "");
  const [value, setValue] = useState(description || "");
  const [saving, setSaving] = useState(false);

  const hasNote = !!(savedDesc && savedDesc.trim());

  /* 只读：有备注显示纯文本，无备注不渲染（不出现"+ 添加备注"入口） */
  if (disabled) {
    if (!hasNote) return null;
    return (
      <span className="text-xs inline-flex items-center px-1 py-0.5">
        <span className="text-gray-400">备注:</span>
        <span className="ml-1 max-w-[120px] truncate text-gray-500">{savedDesc}</span>
      </span>
    );
  }

  async function handleSave() {
    setSaving(true);
    const trimmed = value.trim();
    const { error } = await supabase
      .from("work_order_items")
      .update({ description: trimmed || null })
      .eq("id", itemId);
    setSaving(false);
    if (error) {
      alert("保存失败: " + error.message);
      return;
    }
    setOpen(false);
    // 写库成功后才更新本地显示，保证数据正确性
    setSavedDesc(trimmed);
  }

  function handleCancel() {
    setValue(savedDesc);
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`text-xs text-left inline-flex items-center hover:bg-gray-100 rounded px-1 py-0.5 transition-colors ${
          hasNote ? "text-gray-500" : "text-blue-500"
        }`}
        title="点击编辑备注"
      >
        {hasNote ? (
          <>
            <span className="text-gray-400">备注:</span>
            <span className="ml-1 max-w-[120px] truncate">{savedDesc}</span>
            <span className="text-blue-500 ml-1">✎</span>
          </>
        ) : (
          <span>+ 添加备注</span>
        )}
      </button>
    );
  }

  return (
    <div className="bg-white border border-blue-200 rounded p-2 space-y-2">
      <textarea
        autoFocus
        rows={3}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            handleCancel();
          }
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            handleSave();
          }
        }}
        placeholder="输入备注内容..."
        className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={handleCancel}
          disabled={saving}
          className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          取消
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
    </div>
  );
}

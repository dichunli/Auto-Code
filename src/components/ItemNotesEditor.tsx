"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useState } from "react";

interface Props {
  itemId: string;
  description: string | null;
}

export function ItemNotesEditor({ itemId, description }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(description || "");
  const [saving, setSaving] = useState(false);

  const hasNote = !!(description && description.trim());

  async function handleSave() {
    setSaving(true);
    const { error } = await supabase
      .from("work_order_items")
      .update({ description: value.trim() || null })
      .eq("id", itemId);
    setSaving(false);
    if (error) {
      alert("保存失败: " + error.message);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  function handleCancel() {
    setValue(description || "");
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
            <span className="ml-1 max-w-[120px] truncate">{description}</span>
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

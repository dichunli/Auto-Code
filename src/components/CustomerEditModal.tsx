"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Props {
  open: boolean;
  onClose: () => void;
  customer: { id: string; name: string; phone: string } | null;
  onSaved: (updated: { id: string; name: string; phone: string }) => void;
}

export default function CustomerEditModal({ open, onClose, customer, onSaved }: Props) {
  const supabase = createClient();
  const [name, setName] = useState(customer?.name || "");
  const [phone, setPhone] = useState(customer?.phone || "");
  const [hasPhone, setHasPhone] = useState(!!customer?.phone);
  const [saving, setSaving] = useState(false);

  if (!open || !customer) return null;

  async function handleSave() {
    if (!name.trim()) {
      alert("姓名不能为空");
      return;
    }
    if (hasPhone && !phone.trim()) {
      alert("请输入手机号");
      return;
    }
    setSaving(true);
    const cid = customer!.id;
    const { data, error } = await supabase
      .from("customers")
      .update({ name: name.trim(), phone: hasPhone ? phone.trim() : null })
      .eq("id", cid)
      .select("id, name, phone")
      .single();
    setSaving(false);
    if (error) {
      alert("保存失败: " + error.message);
      return;
    }
    onSaved(data);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50">
      <div className="bg-white rounded-t-xl md:rounded-xl shadow-xl w-full md:max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">编辑客户</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">客户姓名</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="hasPhone"
              checked={hasPhone}
              onChange={(e) => setHasPhone(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded"
            />
            <label htmlFor="hasPhone" className="text-sm text-gray-700">有手机号</label>
          </div>
          {hasPhone && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">联系电话</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

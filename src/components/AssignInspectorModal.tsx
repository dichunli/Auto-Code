"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface Profile {
  id: string;
  full_name: string;
}

interface Props {
  open: boolean;
  itemId: string;
  profiles: Profile[];
  inspectorId?: string | null;
  onClose: () => void;
}

export function AssignInspectorModal({ open, itemId, profiles, inspectorId, onClose }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [selected, setSelected] = useState<string>(inspectorId || "");
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  async function handleSave() {
    setLoading(true);
    const { error } = await supabase
      .from("work_order_items")
      .update({ inspector_id: selected || null })
      .eq("id", itemId);
    setLoading(false);
    if (error) {
      alert("保存失败: " + error.message);
      return;
    }
    router.refresh();
    onClose();
  }

  async function handleClaim() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert("未登录，无法领单");
      setLoading(false);
      return;
    }
    const { error } = await supabase
      .from("work_order_items")
      .update({ inspector_id: user.id })
      .eq("id", itemId);
    setLoading(false);
    if (error) {
      alert("领单失败: " + error.message);
      return;
    }
    router.refresh();
    onClose();
  }

  async function handleClear() {
    if (!confirm("确定取消质检指派？")) return;
    setLoading(true);
    const { error } = await supabase
      .from("work_order_items")
      .update({ inspector_id: null })
      .eq("id", itemId);
    setLoading(false);
    if (error) {
      alert("取消失败: " + error.message);
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">选择质检人</h2>
        <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
          {profiles.map((p) => (
            <label key={p.id} className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer">
              <input
                type="radio"
                name="inspector"
                checked={selected === p.id}
                onChange={() => setSelected(p.id)}
              />
              <span className="text-sm">{p.full_name}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">关闭</button>
          <button type="button" onClick={handleClear} disabled={loading} className="px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50">
            取消质检
          </button>
          <button type="button" onClick={handleClaim} disabled={loading} className="px-4 py-2 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50">
            {loading ? "处理中..." : "领单"}
          </button>
          <button type="button" onClick={handleSave} disabled={loading} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {loading ? "保存中..." : "确定"}
          </button>
        </div>
      </div>
    </div>
  );
}

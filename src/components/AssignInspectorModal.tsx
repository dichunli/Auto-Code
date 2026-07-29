"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useConfirm } from "./ConfirmDialog";

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
  /* 保存成功后回调，传回新的质检人ID，由父组件更新显示，避免刷新整页（性能优化） */
  onSaved?: (newInspectorId: string | null) => void;
}

export function AssignInspectorModal({ open, itemId, profiles, inspectorId, onClose, onSaved }: Props) {
  const supabase = createClient();
  const [selected, setSelected] = useState<string>(inspectorId || "");
  const [loading, setLoading] = useState(false);
  const { 请求确认, 确认弹窗 } = useConfirm();
  /* 约束2：项目未派工时禁止指派/领单质检（null=查询中） */
  const [已派工, set已派工] = useState<boolean | null>(null);
  /* 并发保护：记录打开时的质检人，保存前再比对——防两人同时指派互相覆盖 */
  const [打开时inspectorId, set打开时inspectorId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    set已派工(null);
    supabase
      .from("work_order_items")
      .select("mechanic_id, inspector_id, work_order_item_mechanics(mechanic_id)")
      .eq("id", itemId)
      .single()
      .then(({ data }) => {
        const row = data as {
          mechanic_id: string | null;
          inspector_id: string | null;
          work_order_item_mechanics: { mechanic_id: string }[] | null;
        } | null;
        set已派工(!!row && ((row.work_order_item_mechanics || []).length > 0 || !!row.mechanic_id));
        /* 打开时以数据库最新质检人为准（不用 prop 快照） */
        set打开时inspectorId(row?.inspector_id || null);
        setSelected(row?.inspector_id || "");
      });
  }, [open, itemId, supabase]);

  if (!open) return null;

  /* 保存前冲突校验：质检人在弹窗打开期间被别人改过 → 拒绝并刷新为最新 */
  async function 校验质检人未变(): Promise<boolean> {
    const { data } = await supabase
      .from("work_order_items")
      .select("inspector_id")
      .eq("id", itemId)
      .single();
    const 最新 = (data as { inspector_id: string | null } | null)?.inspector_id || null;
    if (最新 === 打开时inspectorId) return true;
    alert("质检人刚被其他人修改，已为你刷新为最新，请确认后再操作");
    setSelected(最新 || "");
    set打开时inspectorId(最新);
    return false;
  }

  async function handleSave() {
    setLoading(true);
    /* 并发保护：保存前校验质检人没被别人改过 */
    if (!(await 校验质检人未变())) {
      setLoading(false);
      return;
    }
    const { error } = await supabase
      .from("work_order_items")
      .update({ inspector_id: selected || null })
      .eq("id", itemId);
    setLoading(false);
    if (error) {
      alert("保存失败: " + error.message);
      return;
    }
    // 写库成功后才通知父组件更新显示，保证数据正确性
    onSaved?.(selected || null);
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
    /* 并发保护：领单前校验质检人没被别人改过 */
    if (!(await 校验质检人未变())) {
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
    onSaved?.(user.id);
    onClose();
  }

  async function handleClear() {
    if (!(await 请求确认("确定取消质检指派？"))) return;
    setLoading(true);
    /* 并发保护：取消前校验质检人没被别人改过 */
    if (!(await 校验质检人未变())) {
      setLoading(false);
      return;
    }
    const { error } = await supabase
      .from("work_order_items")
      .update({ inspector_id: null })
      .eq("id", itemId);
    setLoading(false);
    if (error) {
      alert("取消失败: " + error.message);
      return;
    }
    onSaved?.(null);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">选择质检人</h2>
        {/* 约束2：项目未派工时禁止指派/领单质检 */}
        {已派工 === false && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">
            该项目还未派工，请先指派施工人，再指派质检人。
          </div>
        )}
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
          <button type="button" onClick={handleClear} disabled={loading || 已派工 !== true} className="px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50">
            取消质检
          </button>
          <button type="button" onClick={handleClaim} disabled={loading || 已派工 !== true} className="px-4 py-2 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50">
            {loading ? "处理中..." : "领单"}
          </button>
          <button type="button" onClick={handleSave} disabled={loading || 已派工 !== true} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {loading ? "保存中..." : "确定"}
          </button>
        </div>
        {确认弹窗}
      </div>
    </div>
  );
}

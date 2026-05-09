"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Props {
  workOrderId: string;
  orderNo: string;
  currentType?: string;
}

export default function WorkOrderActionButtons({ workOrderId, orderNo, currentType }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<"appointment" | "quote" | "cancelled" | "maintenance" | null>(null);
  const [reason, setReason] = useState("");

  const actions = [
    { key: "appointment", label: "转预约单", desc: "将工单转为预约状态，等待客户到店" },
    { key: "quote", label: "转历史报价单", desc: "将工单保存为历史报价记录" },
    { key: "cancelled", label: "转作废单", desc: "工单作废，不再继续处理" },
    { key: "maintenance", label: "建保养单", desc: "将工单标记为保养类型" },
  ] as const;

  async function handleAction(type: typeof actions[number]["key"]) {
    if (type === "cancelled") {
      setModalType("cancelled");
      setModalOpen(true);
      setOpen(false);
      return;
    }

    setLoading(true);
    const updates: Record<string, any> = {};

    switch (type) {
      case "appointment":
        updates.order_type = "appointment";
        updates.appointment_at = new Date().toISOString();
        break;
      case "quote":
        updates.order_type = "quote";
        break;
      case "maintenance":
        updates.order_type = "maintenance";
        break;
    }

    const { error } = await supabase.from("work_orders").update(updates).eq("id", workOrderId);
    setLoading(false);
    setOpen(false);

    if (error) {
      alert("操作失败: " + error.message);
      return;
    }

    // 记录操作日志
    await supabase.from("operation_logs").insert({
      action_type: "work_order_convert",
      target_table: "work_orders",
      target_id: workOrderId,
      target_name: orderNo,
      description: `工单 ${orderNo} 转为${actions.find((a) => a.key === type)?.label}`,
      new_values: updates,
    });

    router.refresh();
  }

  async function handleCancelConfirm() {
    if (!reason.trim()) {
      alert("请填写作废原因");
      return;
    }
    setLoading(true);
    const { error } = await supabase
      .from("work_orders")
      .update({ order_type: "cancelled", cancelled_reason: reason.trim() })
      .eq("id", workOrderId);
    setLoading(false);
    setModalOpen(false);

    if (error) {
      alert("操作失败: " + error.message);
      return;
    }

    await supabase.from("operation_logs").insert({
      action_type: "work_order_convert",
      target_table: "work_orders",
      target_id: workOrderId,
      target_name: orderNo,
      description: `工单 ${orderNo} 转为作废单，原因: ${reason.trim()}`,
      new_values: { order_type: "cancelled", cancelled_reason: reason.trim() },
    });

    setReason("");
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={loading}
        className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1 disabled:opacity-50"
      >
        工单操作
        <svg className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-lg border border-gray-200 shadow-lg z-30 py-1">
            {actions.map((action) => (
              <button
                key={action.key}
                onClick={() => handleAction(action.key)}
                disabled={loading || currentType === action.key}
                className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  currentType === action.key ? "text-blue-600 bg-blue-50" : "text-gray-700"
                }`}
              >
                <div className="font-medium">{action.label}</div>
                <div className="text-xs text-gray-400 mt-0.5">{action.desc}</div>
                {currentType === action.key && (
                  <div className="text-[10px] text-blue-500 mt-0.5">当前状态</div>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {/* 作废原因弹窗 */}
      {modalOpen && modalType === "cancelled" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-sm mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">作废工单</h3>
            <p className="text-sm text-gray-500 mb-4">请填写作废原因</p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="请输入作废原因..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => { setModalOpen(false); setReason(""); }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleCancelConfirm}
                disabled={loading}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {loading ? "处理中..." : "确认作废"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

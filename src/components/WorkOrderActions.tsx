"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface WorkOrderActionsProps {
  orderId: string;
  status: string;
}

const statusFlow: Record<string, { label: string; next: string; color: string }[]> = {
  received: [{ label: "开始诊断", next: "diagnosing", color: "bg-blue-600" }],
  diagnosing: [{ label: "完成诊断，提交报价", next: "quoted", color: "bg-blue-600" }],
  quoted: [{ label: "客户确认，开始维修", next: "repairing", color: "bg-blue-600" }],
  repairing: [{ label: "完成维修，提交质检", next: "quality_check", color: "bg-blue-600" }],
  quality_check: [
    { label: "质检通过，待结算", next: "completed", color: "bg-emerald-600" },
    { label: "质检不合格，返工", next: "repairing", color: "bg-red-600" },
  ],
  completed: [{ label: "确认结算", next: "settled", color: "bg-green-600" }],
  settled: [{ label: "确认交车", next: "delivered", color: "bg-slate-600" }],
  delivered: [],
};

export function WorkOrderActions({ orderId, status }: WorkOrderActionsProps) {
  const router = useRouter();
  const supabase = createClient();
  const actions = statusFlow[status] || [];

  async function handleAction(nextStatus: string) {
    const { error } = await supabase
      .from("work_orders")
      .update({ status: nextStatus })
      .eq("id", orderId);

    if (error) {
      alert("操作失败: " + error.message);
      return;
    }

    // 如果是结算，可能需要弹窗输入金额，这里简化
    if (nextStatus === "settled") {
      // 记录结算时间
      await supabase
        .from("work_orders")
        .update({ settled_at: new Date().toISOString() })
        .eq("id", orderId);
    }
    if (nextStatus === "delivered") {
      await supabase
        .from("work_orders")
        .update({ delivered_at: new Date().toISOString() })
        .eq("id", orderId);
    }

    router.refresh();
  }

  if (actions.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <p className="text-sm text-gray-500 text-center">工单已完成</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
      <h2 className="text-base font-semibold text-gray-900 mb-2">工单操作</h2>
      {actions.map((action) => (
        <button
          key={action.next}
          onClick={() => handleAction(action.next)}
          className={`w-full py-2.5 text-sm font-medium text-white rounded-lg hover:opacity-90 transition-opacity ${action.color}`}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface WorkOrderActionsProps {
  orderId: string;
  status: string;
}

import Link from "next/link";

const statusFlow: Record<string, { label: string; next: string; color: string; href?: string }[]> = {
  received: [{ label: "开始诊断", next: "pending_diagnosis", color: "bg-blue-600" }],
  pending_diagnosis: [{ label: "提交报价", next: "pending_repair", color: "bg-blue-600" }],
  pending_repair: [{ label: "开始维修", next: "repairing", color: "bg-blue-600" }],
  repairing: [{ label: "维修完成，提交质检", next: "pending_quality_check", color: "bg-blue-600" }],
  pending_quality_check: [
    { label: "质检通过，待结单", next: "pending_close", color: "bg-emerald-600" },
    { label: "质检不合格，返工", next: "repairing", color: "bg-red-600" },
  ],
  pending_close: [{ label: "确认结单", next: "pending_settlement", color: "bg-indigo-600" }],
  pending_settlement: [{ label: "前往结算", next: "settled", color: "bg-green-600", href: "payment" }],
  settled: [{ label: "确认交车", next: "delivered", color: "bg-slate-600" }],
  delivered: [],
};

export function WorkOrderActions({ orderId, status }: WorkOrderActionsProps) {
  const router = useRouter();
  const supabase = createClient();
  const actions = statusFlow[status] || [];

  async function handleAction(nextStatus: string) {
    const { data: result, error: rpcErr } = await supabase.rpc("transition_work_order", {
      p_order_id: orderId,
      p_next_status: nextStatus,
      p_notes: null,
    });

    if (rpcErr) {
      alert("操作失败: " + rpcErr.message);
      return;
    }

    const rpcResult = result as { success: boolean; error?: string };
    if (!rpcResult?.success) {
      alert("操作失败: " + (rpcResult?.error || "状态流转被拒绝"));
      return;
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
      {actions.map((action) =>
        action.href ? (
          <Link
            key={action.next}
            href={`/work-orders/${orderId}/${action.href}`}
            className={`block w-full text-center py-2.5 text-sm font-medium text-white rounded-lg hover:opacity-90 transition-opacity ${action.color}`}
          >
            {action.label}
          </Link>
        ) : (
          <button
            key={action.next}
            onClick={() => handleAction(action.next)}
            className={`w-full py-2.5 text-sm font-medium text-white rounded-lg hover:opacity-90 transition-opacity ${action.color}`}
          >
            {action.label}
          </button>
        )
      )}
    </div>
  );
}

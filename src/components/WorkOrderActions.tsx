"use client";

import { useRouter } from "next/navigation";
import { 流转工单状态 } from "@/app/work-orders/actions";

interface WorkOrderActionsProps {
  orderId: string;
  status: string;
  /* 待结单判定结果（page.tsx 用 orderStage.readyToClose 算好传入）：
   * 命中时 repairing/pending_quality_check 也显示"确认结单"按钮（快速通道） */
  待结单就绪?: boolean;
}

import Link from "next/link";
import { toast } from "@/lib/globalToast";

/* 状态按钮流：质检已下沉到项目级（项目行质检单），工单级不再有"提交质检/质检通过/返工"。
 * repairing/pending_quality_check 无按钮——等项目完工/质检；满足待结单条件时出现"确认结单"。 */
const statusFlow: Record<string, { label: string; next: string; color: string; href?: string }[]> = {
  received: [{ label: "开始诊断", next: "pending_diagnosis", color: "bg-blue-600" }],
  pending_diagnosis: [{ label: "提交报价", next: "pending_repair", color: "bg-blue-600" }],
  pending_repair: [{ label: "开始维修", next: "repairing", color: "bg-blue-600" }],
  repairing: [],
  pending_quality_check: [],
  pending_close: [{ label: "确认结单", next: "pending_settlement", color: "bg-indigo-600" }],
  pending_settlement: [{ label: "前往结算", next: "settled", color: "bg-green-600", href: "payment" }],
  settled: [{ label: "确认交车", next: "delivered", color: "bg-slate-600" }],
  delivered: [],
};

export function WorkOrderActions({ orderId, status, 待结单就绪 }: WorkOrderActionsProps) {
  const router = useRouter();
  const actions = statusFlow[status] || [];

  /* 快速通道/自动待结单：repairing 或 pending_quality_check 且已满足结单条件 */
  const 显示确认结单 = 待结单就绪 && (status === "repairing" || status === "pending_quality_check");

  /* 状态流转走 Server Action：服务端验证登录，避免客户端 session 异常导致流转失败 */
  async function 流转(nextStatus: string): Promise<boolean> {
    try {
      const 结果 = await 流转工单状态({ orderId, nextStatus });
      if (!结果.success) {
        toast("操作失败: " + (结果.error || "状态流转被拒绝"), "error");
        return false;
      }
      return true;
    } catch (err: unknown) {
      toast("操作失败: " + (err instanceof Error ? err.message : String(err)), "error");
      return false;
    }
  }

  async function handleAction(nextStatus: string) {
    if (await 流转(nextStatus)) router.refresh();
  }

  /* 确认结单（快速通道）：串行两段流转 →待结单 →待结算，历史完整、用户无感知 */
  async function handleConfirmClose() {
    if (!(await 流转("pending_close"))) return;
    if (!(await 流转("pending_settlement"))) return;
    router.refresh();
  }

  if (actions.length === 0 && !显示确认结单) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <p className="text-sm text-gray-500 text-center">
          {status === "delivered" ? "工单已完成" : "等待项目完工/质检…"}
        </p>
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
      {显示确认结单 && (
        <button
          onClick={handleConfirmClose}
          className="w-full py-2.5 text-sm font-medium text-white rounded-lg hover:opacity-90 transition-opacity bg-indigo-600"
        >
          确认结单
        </button>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const statusIcons: Record<string, { label: string; next: string; color: string; href?: string }[]> = {
  received: [{ label: "诊断", next: "pending_diagnosis", color: "bg-blue-600" }],
  pending_diagnosis: [{ label: "报价", next: "pending_repair", color: "bg-blue-600" }],
  pending_repair: [{ label: "维修", next: "repairing", color: "bg-blue-600" }],
  repairing: [{ label: "质检", next: "pending_quality_check", color: "bg-blue-600" }],
  pending_quality_check: [
    { label: "通过", next: "pending_close", color: "bg-emerald-600" },
    { label: "返工", next: "repairing", color: "bg-red-600" },
  ],
  pending_close: [{ label: "结单", next: "pending_settlement", color: "bg-indigo-600" }],
  pending_settlement: [{ label: "结算", next: "settled", color: "bg-green-600", href: "payment" }],
  settled: [{ label: "交车", next: "delivered", color: "bg-slate-600" }],
  delivered: [],
};

export default function WorkOrderFloatingSidebar({
  orderId,
  status,
  order,
  payments,
  advancePaymentTotal,
}: {
  orderId: string;
  status: string;
  order: any;
  payments: any[];
  advancePaymentTotal?: number;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [expanded, setExpanded] = useState(false);
  const actions = statusIcons[status] || [];

  async function handleAction(nextStatus: string, href?: string) {
    if (href) {
      router.push(`/work-orders/${orderId}/${href}`);
      return;
    }
    const { data: result, error: rpcErr } = await supabase.rpc("transition_work_order", {
      p_order_id: orderId,
      p_next_status: nextStatus,
      p_notes: null,
    });
    if (rpcErr) { alert("操作失败: " + rpcErr.message); return; }
    const rpcResult = result as { success: boolean; error?: string };
    if (!rpcResult?.success) { alert("操作失败: " + (rpcResult?.error || "状态流转被拒绝")); return; }
    router.refresh();
  }

  const totalPaid = payments?.reduce((s, p) => s + (p.amount || 0), 0) || 0;
  const remaining = (order.total_cost || 0) - totalPaid - (advancePaymentTotal || 0);

  return (
    <>
      {/* 右侧悬浮工具条 */}
      <div className="fixed right-2 top-1/2 -translate-y-1/2 z-40 flex flex-col gap-2">
        {/* 状态操作按钮 */}
        {actions.map((a, idx) => (
          <button
            key={idx}
            onClick={() => handleAction(a.next, a.href)}
            className={`${a.color} text-white text-xs font-medium px-2 py-2 rounded-lg shadow-lg hover:opacity-90 transition-opacity writing-vertical`}
            title={a.label}
          >
            <span className="block leading-tight">{a.label}</span>
          </button>
        ))}

        {/* 展开/收起 更多 */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="bg-white border border-gray-200 text-gray-600 text-xs px-2 py-2 rounded-lg shadow-lg hover:bg-gray-50 transition-colors"
          title="更多操作"
        >
          <span className="block leading-tight">{expanded ? "收起" : "更多"}</span>
        </button>

        {/* 打印 */}
        <Link
          href={`/work-orders/${orderId}/print?type=reception`}
          className="bg-white border border-gray-200 text-gray-600 text-xs px-2 py-2 rounded-lg shadow-lg hover:bg-gray-50 transition-colors text-center"
          title="打印"
        >
          <span className="block leading-tight">打印</span>
        </Link>

        {/* 费用概览 */}
        <div className="bg-white border border-gray-200 px-2 py-2 rounded-lg shadow-lg text-center">
          <span className="block text-[10px] text-gray-400 leading-tight">应收</span>
          <span className={`block text-xs font-bold leading-tight ${remaining > 0 ? 'text-orange-600' : 'text-green-600'}`}>
            ¥{remaining.toFixed(0)}
          </span>
        </div>
      </div>

      {/* 展开的更多面板 */}
      {expanded && (
        <div className="fixed right-16 top-1/2 -translate-y-1/2 z-40 bg-white rounded-xl border border-gray-200 shadow-xl p-4 w-56 max-h-[80vh] overflow-y-auto">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">打印单据</h3>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {[
              { label: "接车单", type: "reception" },
              { label: "派工单", type: "dispatch" },
              { label: "领料单", type: "picking" },
              { label: "退料单", type: "return" },
              { label: "结算单", type: "settlement" },
              { label: "报销单", type: "reimbursement" },
            ].map((p) => (
              <Link
                key={p.type}
                href={`/work-orders/${orderId}/print?type=${p.type}`}
                className="text-xs px-2 py-1.5 bg-gray-50 text-gray-700 rounded hover:bg-gray-100 transition-colors text-center"
              >
                {p.label}
              </Link>
            ))}
          </div>

          <h3 className="text-sm font-semibold text-gray-900 mb-3">费用合计</h3>
          <div className="space-y-1.5 text-xs text-gray-600 mb-4">
            <div className="flex justify-between"><span>配件</span><span>¥{(order.parts_cost || 0).toFixed(2)}</span></div>
            <div className="flex justify-between"><span>工时</span><span>¥{(order.labor_cost || 0).toFixed(2)}</span></div>
            <div className="flex justify-between"><span>其他</span><span>¥{(order.other_cost || 0).toFixed(2)}</span></div>
            {(order.discount_amount || 0) > 0 && (
              <div className="flex justify-between text-orange-600"><span>优惠</span><span>-¥{(order.discount_amount || 0).toFixed(2)}</span></div>
            )}
            {(advancePaymentTotal || 0) > 0 && (
              <div className="flex justify-between text-green-600"><span>预收</span><span>-¥{(advancePaymentTotal || 0).toFixed(2)}</span></div>
            )}
            <div className="border-t border-gray-100 pt-1.5 flex justify-between font-bold text-gray-900">
              <span>应收</span><span>¥{((order.total_cost || 0) - (advancePaymentTotal || 0)).toFixed(2)}</span>
            </div>
          </div>

          <h3 className="text-sm font-semibold text-gray-900 mb-3">支付记录</h3>
          {payments && payments.length > 0 ? (
            <div className="space-y-1.5 text-xs">
              {payments.map((p: any) => (
                <div key={p.id} className="flex justify-between">
                  <span className="text-gray-600">
                    {p.method === 'cash' ? '现金' : p.method === 'wechat' ? '微信' : p.method === 'alipay' ? '支付宝' : p.method === 'credit' ? '挂账' : p.method === 'member' ? '会员' : '银行'}
                  </span>
                  <span className="font-medium text-gray-900">¥{(p.amount || 0).toFixed(2)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400">暂无支付记录</p>
          )}
        </div>
      )}
    </>
  );
}

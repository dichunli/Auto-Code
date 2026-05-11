"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { useRouter } from "next/navigation";

interface AdvancePaymentRecord {
  id: string;
  amount: number;
  refunded_amount?: number;
  refunded_at?: string;
  refund_method?: string;
  method: string;
  paid_at: string;
  profiles?: { full_name: string } | null;
}

interface Props {
  records: AdvancePaymentRecord[];
  orderId: string;
  currentAdvancePayment: number;
}

const METHOD_LABEL: Record<string, string> = {
  cash: "现金",
  wechat: "微信",
  alipay: "支付宝",
  bank_transfer: "银行转账",
};

export default function AdvancePaymentList({
  records,
  orderId,
  currentAdvancePayment,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundMethod, setRefundMethod] = useState("cash");
  const [loading, setLoading] = useState(false);

  const REFUND_METHOD_OPTIONS = [
    { value: "cash", label: "现金" },
    { value: "wechat", label: "微信" },
    { value: "alipay", label: "支付宝" },
    { value: "bank_transfer", label: "银行转账" },
  ];

  const netTotal = records.reduce(
    (sum, r) => sum + (r.amount || 0) - (r.refunded_amount || 0),
    0
  );

  async function handleRefund(record: AdvancePaymentRecord) {
    const val = parseFloat(refundAmount);
    const maxRefund = (record.amount || 0) - (record.refunded_amount || 0);
    if (isNaN(val) || val <= 0) {
      alert("请输入有效退款金额");
      return;
    }
    if (val > maxRefund) {
      alert(`最多可退 ${formatCurrency(maxRefund)}`);
      return;
    }
    if (!confirm(`确认退款 ${formatCurrency(val)}？`)) return;

    setLoading(true);

    // 1. 更新记录退款金额和退款方式
    const { error: updateErr } = await supabase
      .from("advance_payment_records")
      .update({
        refunded_amount: (record.refunded_amount || 0) + val,
        refunded_at: new Date().toISOString(),
        refund_method: refundMethod,
      })
      .eq("id", record.id);

    if (updateErr) {
      setLoading(false);
      alert("退款失败：" + updateErr.message);
      return;
    }

    // 2. 同步减少工单预收款总额
    const newAdvance = Math.max(0, currentAdvancePayment - val);
    const { error: orderErr } = await supabase
      .from("work_orders")
      .update({ advance_payment: newAdvance })
      .eq("id", orderId);

    setLoading(false);
    if (orderErr) {
      alert("更新工单预收款失败：" + orderErr.message);
      return;
    }

    setRefundingId(null);
    setRefundAmount("");
    setRefundMethod("cash");
    router.refresh();
  }

  return (
    <div className="space-y-1">
      {records.map((r) => {
        const net = (r.amount || 0) - (r.refunded_amount || 0);
        const isRefunding = refundingId === r.id;
        return (
          <div key={r.id} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">
                {new Date(r.paid_at).toLocaleDateString("zh-CN")}
                {" · "}
                {METHOD_LABEL[r.method] || r.method}
                {r.profiles?.full_name && ` · ${r.profiles.full_name}`}
              </span>
              <div className="flex items-center gap-2">
                <span
                  className={`${
                    net <= 0 ? "text-gray-400 line-through" : "text-gray-700"
                  }`}
                >
                  {formatCurrency(r.amount)}
                </span>
                {net > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setRefundingId(r.id);
                      setRefundAmount(String(net));
                    }}
                    disabled={loading}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 hover:bg-orange-100 disabled:opacity-50"
                  >
                    退款
                  </button>
                )}
                {net <= 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">
                    已退完
                  </span>
                )}
              </div>
            </div>
            {(r.refunded_amount || 0) > 0 && (
              <div className="flex justify-between text-[10px] text-gray-400 pl-2">
                <span>
                  已退款 · {(r.refund_method && METHOD_LABEL[r.refund_method]) || r.refund_method || "未知方式"}
                  {r.refunded_at &&
                    ` · ${new Date(r.refunded_at).toLocaleDateString("zh-CN")}`}
                </span>
                <span className="text-orange-500">
                  -{formatCurrency(r.refunded_amount || 0)}
                </span>
              </div>
            )}
            {isRefunding && (
              <div className="flex items-center gap-2 pl-2 flex-wrap">
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={net}
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  className="w-20 px-1 py-0.5 border border-orange-200 rounded text-xs text-right"
                  autoFocus
                />
                <select
                  value={refundMethod}
                  onChange={(e) => setRefundMethod(e.target.value)}
                  className="px-1 py-0.5 border border-orange-200 rounded text-xs"
                >
                  {REFUND_METHOD_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleRefund(r)}
                  disabled={loading}
                  className="text-[10px] px-2 py-0.5 rounded bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50"
                >
                  {loading ? "..." : "确认"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRefundingId(null);
                    setRefundAmount("");
                    setRefundMethod("cash");
                  }}
                  className="text-[10px] px-2 py-0.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200"
                >
                  取消
                </button>
                <span className="text-[10px] text-gray-400">
                  最多可退 {formatCurrency(net)}
                </span>
              </div>
            )}
          </div>
        );
      })}
      {records.some((r) => (r.refunded_amount || 0) > 0) && (
        <div className="flex justify-between text-xs font-medium pt-1 border-t border-gray-100">
          <span className="text-gray-600">预收净额</span>
          <span className="text-green-600">{formatCurrency(netTotal)}</span>
        </div>
      )}
    </div>
  );
}

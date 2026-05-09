"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";

interface Props {
  orderId: string;
  advancePayment: number;
  totalCost: number;
}

const METHOD_OPTIONS = [
  { value: "cash", label: "现金" },
  { value: "wechat", label: "微信" },
  { value: "alipay", label: "支付宝" },
  { value: "bank_transfer", label: "银行转账" },
];

export default function AdvancePaymentDropdown({ orderId, advancePayment, totalCost }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setEditing(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function handleSave() {
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) {
      alert("请输入有效金额");
      return;
    }
    setLoading(true);

    // 获取当前用户作为收款人
    const { data: userData } = await supabase.auth.getUser();
    const collectorId = userData?.user?.id || null;

    // 1. 插入预收款记录
    const { error: insertErr } = await supabase.from("advance_payment_records").insert({
      work_order_id: orderId,
      amount: val,
      method,
      collector_id: collectorId,
      paid_at: new Date().toISOString(),
    });

    if (insertErr) {
      setLoading(false);
      alert("保存失败：" + insertErr.message);
      return;
    }

    // 2. 同步更新工单上的预收款合计（冗余字段，便于快速查询）
    const { error: updateErr } = await supabase
      .from("work_orders")
      .update({ advance_payment: (advancePayment || 0) + val })
      .eq("id", orderId);

    setLoading(false);
    if (updateErr) {
      alert("更新工单预收款失败：" + updateErr.message);
      return;
    }

    setAmount("");
    setMethod("cash");
    setEditing(false);
    router.refresh();
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
          advancePayment > 0
            ? "bg-green-50 text-green-700 border border-green-200 hover:bg-green-100"
            : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
        }`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        预收款 {advancePayment > 0 && <span className="font-semibold">{formatCurrency(advancePayment)}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-64 bg-white rounded-lg border border-gray-200 shadow-lg z-50 p-3">
          {!editing ? (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">已预收金额</span>
                <span className={`font-medium ${advancePayment > 0 ? "text-green-600" : "text-gray-400"}`}>
                  {formatCurrency(advancePayment)}
                </span>
              </div>
              {advancePayment > 0 && totalCost > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">抵扣后应收</span>
                  <span className="font-medium text-gray-900">{formatCurrency(Math.max(0, totalCost - advancePayment))}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  setAmount("");
                  setMethod("cash");
                  setEditing(true);
                }}
                className="w-full mt-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                登记预收款
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">预收金额</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">收款方式</label>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {METHOD_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={loading}
                  className="flex-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? "保存中..." : "保存"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="px-3 py-1.5 text-sm bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

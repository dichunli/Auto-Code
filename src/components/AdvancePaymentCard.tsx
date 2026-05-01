"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { useRouter } from "next/navigation";

export function AdvancePaymentCard({
  orderId,
  advancePayment,
  totalCost,
}: {
  orderId: string;
  advancePayment: number;
  totalCost: number;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(String(advancePayment || ""));
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    const val = parseFloat(amount);
    if (isNaN(val) || val < 0) {
      alert("请输入有效金额");
      return;
    }
    setLoading(true);
    const { error } = await supabase
      .from("work_orders")
      .update({ advance_payment: val })
      .eq("id", orderId);
    if (error) {
      alert("保存失败：" + error.message);
    }
    setLoading(false);
    setEditing(false);
    router.refresh();
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-base font-semibold text-gray-900 mb-3">预收款</h2>
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
              setAmount(String(advancePayment || ""));
              setEditing(true);
            }}
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            {advancePayment > 0 ? "修改预收款" : "登记预收款"}
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
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={loading}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
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
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/utils";

export default function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const supabase = createClient();
  const [orderId, setOrderId] = useState("");
  const [loading, setLoading] = useState(false);
  const [payments, setPayments] = useState([
    { method: "cash", amount: "" },
  ]);

  params.then((p) => setOrderId(p.id));

  function addPayment() {
    setPayments([...payments, { method: "cash", amount: "" }]);
  }

  function updatePayment(index: number, field: string, value: string) {
    const next = [...payments];
    (next[index] as any)[field] = value;
    setPayments(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orderId) return;
    setLoading(true);

    try {
      const rows = payments
        .filter((p) => parseFloat(p.amount) > 0)
        .map((p) => ({
          work_order_id: orderId,
          method: p.method,
          amount: parseFloat(p.amount),
          paid_at: new Date().toISOString(),
        }));

      if (rows.length === 0) throw new Error("请填写支付金额");

      const { error } = await supabase.from("payments").insert(rows);
      if (error) throw error;

      // 更新工单为已结算
      await supabase
        .from("work_orders")
        .update({ status: "settled", settled_at: new Date().toISOString() })
        .eq("id", orderId);

      router.push(`/work-orders/${orderId}`);
      router.refresh();
    } catch (err: any) {
      alert("保存失败: " + err.message);
      setLoading(false);
    }
  }

  const methods = [
    { value: "cash", label: "现金" },
    { value: "wechat", label: "微信支付" },
    { value: "alipay", label: "支付宝" },
    { value: "credit", label: "挂账" },
    { value: "member", label: "会员/储值卡" },
    { value: "bank_transfer", label: "银行转账" },
  ];

  return (
    <div>
      <PageHeader title="结算收款" />

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-xl">
        <div className="space-y-4">
          {payments.map((p, i) => (
            <div key={i} className="flex gap-3">
              <select
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                value={p.method}
                onChange={(e) => updatePayment(i, "method", e.target.value)}
              >
                {methods.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <input
                type="number"
                placeholder="金额"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                value={p.amount}
                onChange={(e) => updatePayment(i, "amount", e.target.value)}
              />
              {payments.length > 1 && (
                <button type="button" onClick={() => setPayments(payments.filter((_, idx) => idx !== i))}
                  className="text-red-500 text-sm px-2">删除</button>
              )}
            </div>
          ))}
          <button type="button" onClick={addPayment} className="text-sm text-blue-600 hover:text-blue-700">+ 添加支付方式</button>
        </div>

        <div className="mt-8 flex gap-3 justify-end">
          <button type="button" onClick={() => router.back()} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
          <button type="submit" disabled={loading} className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50">确认结算</button>
        </div>
      </form>
    </div>
  );
}

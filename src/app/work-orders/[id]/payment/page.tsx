"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/utils";
import {
  roundToTwo,
  parseAmount,
  getErrorMessage,
  validateSettlement,
} from "./payment-logic";

interface PaymentMethod {
  method: string;
  amount: string;
  member_id?: string;
}

interface WorkOrder {
  id: string;
  order_no: string;
  total_cost: number;
  parts_cost: number;
  labor_cost: number;
  other_cost: number;
  advance_payment: number;
  discount_amount: number;
  status: string;
  customer_id: string;
  vehicle_id: string;
  mileage_in: number;
  vehicles?: { plate_number: string; brand: string; model: string }[];
  customers?: { name: string; phone: string }[];
}

interface WorkOrderItem {
  id: string;
  name: string;
  alias_name: string | null;
  item_type: "labor" | "part" | "other";
  quantity: number;
  unit_price: number;
  total_price: number;
  business_type: string;
}

interface ExistingPayment {
  method: string;
  amount: number;
  paid_at: string;
  notes: string | null;
}

interface FinanceAccount {
  id: string;
  name: string;
}

interface Member {
  id: string;
  card_no: string;
  name: string;
  phone: string;
  balance: number;
  status: string;
}

const METHOD_OPTIONS = [
  { value: "cash", label: "现金" },
  { value: "wechat", label: "微信支付" },
  { value: "alipay", label: "支付宝" },
  { value: "member", label: "会员/储值卡" },
  { value: "bank_transfer", label: "银行转账" },
  { value: "credit", label: "挂账/赊欠" },
];

export default function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const supabase = createClient();
  const [orderId, setOrderId] = useState("");
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState("");

  const [order, setOrder] = useState<WorkOrder | null>(null);
  const [items, setItems] = useState<WorkOrderItem[]>([]);
  const [existingPayments, setExistingPayments] = useState<ExistingPayment[]>([]);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [members, setMembers] = useState<Member[]>([]);

  const [payments, setPayments] = useState<PaymentMethod[]>([
    { method: "cash", amount: "" },
  ]);
  const [notes, setNotes] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [discountAmount, setDiscountAmount] = useState("");

  useEffect(() => {
    params.then((p) => {
      setOrderId(p.id);
      loadData(p.id);
    });
  }, [params]);

  async function loadData(id: string) {
    setDataLoading(true);
    setError("");
    try {
      const [
        { data: orderData, error: orderErr },
        { data: itemsData, error: itemsErr },
        { data: paymentsData, error: payErr },
        { data: accountsData, error: accErr },
        { data: membersData, error: memErr },
      ] = await Promise.all([
        supabase
          .from("work_orders")
          .select("id, order_no, total_cost, parts_cost, labor_cost, other_cost, advance_payment, discount_amount, status, customer_id, vehicle_id, mileage_in, vehicles(plate_number, brand, model), customers(name, phone)")
          .eq("id", id)
          .single(),
        supabase
          .from("work_order_items")
          .select("id, name, alias_name, item_type, quantity, unit_price, total_price, business_type")
          .eq("work_order_id", id)
          .order("created_at", { ascending: true }),
        supabase.from("payments").select("method, amount, paid_at, notes").eq("work_order_id", id).order("paid_at", { ascending: true }),
        supabase.from("finance_accounts").select("id, name").eq("is_active", true),
        supabase.from("members").select("id, card_no, name, phone, balance, status").eq("status", "active").order("name"),
      ]);

      if (orderErr) throw orderErr;
      if (itemsErr) throw itemsErr;

      setOrder(orderData as unknown as WorkOrder);
      setItems((itemsData as WorkOrderItem[]) || []);
      setExistingPayments((paymentsData as ExistingPayment[]) || []);
      setAccounts((accountsData as FinanceAccount[]) || []);
      setMembers((membersData as Member[]) || []);
      if (accountsData && accountsData.length > 0) {
        setSelectedAccountId(accountsData[0].id);
      }
      if (orderData?.discount_amount) {
        setDiscountAmount(String(orderData.discount_amount));
      }
    } catch (err) {
      setError("加载数据失败: " + getErrorMessage(err));
    } finally {
      setDataLoading(false);
    }
  }

  function addPayment() {
    setPayments([...payments, { method: "cash", amount: "" }]);
  }

  function updatePayment(index: number, field: keyof PaymentMethod, value: string) {
    const next = [...payments];
    next[index][field] = value;
    setPayments(next);
  }

  function removePayment(index: number) {
    setPayments(payments.filter((_, i) => i !== index));
  }

  const parsedDiscount = parseAmount(discountAmount);
  const totalCost = order?.total_cost || 0;
  const discountedTotal = roundToTwo(totalCost - parsedDiscount);
  const advancePayment = order?.advance_payment || 0;
  const totalPaid = existingPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const totalPaying = payments.reduce((sum, p) => sum + parseAmount(p.amount), 0);
  const remainingBefore = roundToTwo(discountedTotal - advancePayment - totalPaid);
  const remainingAfter = roundToTwo(remainingBefore - totalPaying);

  /** 校验结算前置条件 */
  function validate(): string | null {
    return validateSettlement({
      orderId,
      totalPaying,
      selectedAccountId,
      parsedDiscount,
      totalCost,
      advancePayment,
      totalPaid,
      payments,
      members,
    });
  }

  /** 非关键后续操作：提醒、通知、回访（失败不阻断） */
  async function postSettlementSteps(workOrderId: string) {
    if (!order?.vehicle_id || !order?.customer_id) return;

    const now = new Date();
    const nextDate = new Date(now);
    nextDate.setMonth(nextDate.getMonth() + 6);

    const reminderPromises = [
      supabase.from("maintenance_reminders").insert({
        vehicle_id: order.vehicle_id,
        customer_id: order.customer_id,
        reminder_type: "time",
        title: "常规保养提醒",
        due_date: nextDate.toISOString().split("T")[0],
        current_mileage: order.mileage_in || 0,
        work_order_id: workOrderId,
      }),
      supabase.from("maintenance_reminders").insert({
        vehicle_id: order.vehicle_id,
        customer_id: order.customer_id,
        reminder_type: "mileage",
        title: "里程保养提醒",
        due_mileage: (order.mileage_in || 0) + 5000,
        current_mileage: order.mileage_in || 0,
        work_order_id: workOrderId,
      }),
      supabase.from("notifications").insert({
        customer_id: order.customer_id,
        type: "work_order_status",
        title: "维修结算完成",
        content: `您的车辆 (${order.vehicles?.[0]?.plate_number || ""}) 已完成维修结算，欢迎再次光临。`,
        related_type: "work_order",
        related_id: workOrderId,
      }),
    ];

    const results = await Promise.allSettled(reminderPromises);
    results.forEach((r, idx) => {
      if (r.status === "rejected" || (r.value && r.value.error)) {
        const names = ["时间保养提醒", "里程保养提醒", "客户通知"];
        const errMsg = r.status === "rejected" ? getErrorMessage(r.reason) : r.value?.error?.message;
        console.error(`创建${names[idx]}失败:`, errMsg);
      }
    });

    // 售后回访
    const scheduledDate = new Date(now);
    scheduledDate.setDate(scheduledDate.getDate() + 3);
    const { error: fuErr } = await supabase.from("follow_ups").insert({
      work_order_id: workOrderId,
      scheduled_at: scheduledDate.toISOString(),
    });
    if (fuErr) console.error("创建回访任务失败:", fuErr.message);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);

    try {
      const paymentRows = payments
        .filter((p) => parseAmount(p.amount) > 0)
        .map((p) => ({
          method: p.method,
          amount: parseAmount(p.amount),
          member_id: p.method === "member" ? p.member_id : null,
        }));

      // 调用原子结算 RPC
      const { data: result, error: rpcError } = await supabase.rpc("settle_work_order", {
        p_order_id: orderId,
        p_discount_amount: parsedDiscount,
        p_payments: paymentRows,
        p_account_id: selectedAccountId,
        p_notes: notes || null,
      });

      if (rpcError) {
        throw new Error(rpcError.message);
      }

      const rpcResult = result as { success: boolean; error?: string; total_cost?: number };
      if (!rpcResult?.success) {
        throw new Error(rpcResult?.error || "结算失败");
      }

      // 非关键后续步骤（失败不阻断，仅记录日志）
      await postSettlementSteps(orderId);

      router.push(`/work-orders/${orderId}`);
      router.refresh();
    } catch (err) {
      setError(getErrorMessage(err));
      setLoading(false);
    }
  }

  if (dataLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 text-sm">加载中...</div>
      </div>
    );
  }

  const discountRateDisplay =
    parsedDiscount > 0 && totalCost > 0
      ? roundToTwo(((totalCost - parsedDiscount) / totalCost) * 100)
      : null;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader title="工单结算" description={`结算单号: ${order?.order_no}`} />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 工单信息 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-gray-500">客户:</span>{" "}
            <span className="font-medium text-gray-900">{order?.customers?.[0]?.name || "-"}</span>
          </div>
          <div>
            <span className="text-gray-500">电话:</span>{" "}
            <span className="text-gray-700">{order?.customers?.[0]?.phone || "-"}</span>
          </div>
          <div>
            <span className="text-gray-500">车辆:</span>{" "}
            <span className="font-medium text-gray-900">
              {order?.vehicles?.[0]?.plate_number} ({order?.vehicles?.[0]?.brand} {order?.vehicles?.[0]?.model})
            </span>
          </div>
        </div>
      </div>

      {/* 费用明细 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">费用明细</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">项目</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">类型</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">数量</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">单价</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">金额</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{item.alias_name || item.name}</span>
                      {item.business_type !== "normal" && (
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded ${
                            item.business_type === "insurance"
                              ? "bg-purple-50 text-purple-700"
                              : item.business_type === "gift"
                              ? "bg-pink-50 text-pink-700"
                              : "bg-orange-50 text-orange-700"
                          }`}
                        >
                          {item.business_type === "insurance"
                            ? "保险"
                            : item.business_type === "gift"
                            ? "赠送"
                            : "返工"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-3 text-gray-600">
                    {item.item_type === "labor" ? "工时" : item.item_type === "part" ? "配件" : "其他"}
                  </td>
                  <td className="px-6 py-3 text-gray-600">{item.quantity}</td>
                  <td className="px-6 py-3 text-gray-600">{formatCurrency(item.unit_price)}</td>
                  <td className="px-6 py-3 font-medium text-gray-900">{formatCurrency(item.total_price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>配件费用</span>
              <span>{formatCurrency(order?.parts_cost ?? 0)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>工时费用</span>
              <span>{formatCurrency(order?.labor_cost ?? 0)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>其他费用</span>
              <span>{formatCurrency(order?.other_cost ?? 0)}</span>
            </div>
            {parsedDiscount > 0 && (
              <div className="flex justify-between text-orange-600">
                <span>整单优惠</span>
                <span>-{formatCurrency(parsedDiscount)}</span>
              </div>
            )}
            {advancePayment > 0 && (
              <div className="flex justify-between text-green-600">
                <span>预收款抵扣</span>
                <span>-{formatCurrency(advancePayment)}</span>
              </div>
            )}
            <div className="border-t border-gray-200 pt-2 flex justify-between text-base font-bold text-gray-900">
              <span>应收合计</span>
              <span>{formatCurrency(discountedTotal - advancePayment)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 已支付记录 */}
      {existingPayments.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-3">已支付记录</h3>
          <div className="space-y-2">
            {existingPayments.map((p, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-gray-600">
                  {METHOD_OPTIONS.find((m) => m.value === p.method)?.label || p.method}
                  {p.notes && <span className="text-gray-400 ml-1">({p.notes})</span>}
                </span>
                <span className="font-medium text-gray-900">{formatCurrency(p.amount)}</span>
              </div>
            ))}
            <div className="border-t border-gray-100 pt-2 flex justify-between text-sm font-medium">
              <span className="text-gray-700">已付合计</span>
              <span className="text-green-600">{formatCurrency(totalPaid)}</span>
            </div>
          </div>
        </div>
      )}

      {/* 结算收款 */}
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">本次收款</h3>
          <div className="text-right">
            {advancePayment > 0 && (
              <div className="text-sm text-green-600">
                已预收: {formatCurrency(advancePayment)}
              </div>
            )}
            <div className="text-sm text-gray-500">
              待收金额: <span className="font-bold text-red-600">{formatCurrency(remainingBefore)}</span>
            </div>
          </div>
        </div>

        {/* 整单优惠 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">整单优惠（折扣金额）</label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              step="0.01"
              min="0"
              max={totalCost}
              placeholder="0.00"
              disabled={loading}
              className="w-48 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
              value={discountAmount}
              onChange={(e) => setDiscountAmount(e.target.value)}
            />
            <span className="text-sm text-gray-500">
              优惠后总额: <span className="font-medium text-gray-900">{formatCurrency(discountedTotal)}</span>
            </span>
          </div>
          {discountRateDisplay !== null && (
            <p className="text-xs text-gray-400 mt-1">
              折扣比例: {discountRateDisplay}%（员工提成将按此比例同步折扣）
            </p>
          )}
        </div>

        {/* 收款账户 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">收款账户 *</label>
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            disabled={loading}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
            required
          >
            <option value="">请选择收款账户</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        {/* 支付方式 */}
        <div className="space-y-3">
          {payments.map((p, i) => (
            <div key={i} className="space-y-2">
              <div className="flex gap-3 items-center">
                <select
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-36 disabled:bg-gray-100 disabled:text-gray-500"
                  value={p.method}
                  onChange={(e) => updatePayment(i, "method", e.target.value)}
                  disabled={loading}
                >
                  {METHOD_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="金额"
                  disabled={loading}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100 disabled:text-gray-500"
                  value={p.amount}
                  onChange={(e) => updatePayment(i, "amount", e.target.value)}
                />
                {payments.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removePayment(i)}
                    disabled={loading}
                    className="text-red-500 text-sm px-2 hover:text-red-700 disabled:opacity-50"
                  >
                    删除
                  </button>
                )}
              </div>
              {p.method === "member" && (
                <div className="pl-0">
                  <select
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100 disabled:text-gray-500"
                    value={p.member_id || ""}
                    onChange={(e) => updatePayment(i, "member_id", e.target.value)}
                    disabled={loading}
                  >
                    <option value="">请选择会员</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.card_no} - {m.name} (余额: {formatCurrency(m.balance)})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addPayment}
            disabled={loading}
            className="text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50"
          >
            + 添加支付方式
          </button>
        </div>

        {/* 备注 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">结算备注</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={loading}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
            rows={2}
            placeholder="可选填写备注信息"
          />
        </div>

        {/* 结算汇总 */}
        <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">本次实收</span>
            <span className="font-medium text-green-600">
              {formatCurrency(
                payments
                  .filter((p) => p.method !== "credit")
                  .reduce((sum, p) => sum + parseAmount(p.amount), 0)
              )}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">本次挂账</span>
            <span className="font-medium text-orange-600">
              {formatCurrency(
                payments
                  .filter((p) => p.method === "credit")
                  .reduce((sum, p) => sum + parseAmount(p.amount), 0)
              )}
            </span>
          </div>
          {remainingAfter > 0 && (
            <div className="flex justify-between">
              <span className="text-gray-600">未结清尾款</span>
              <span className="font-medium text-red-600">{formatCurrency(remainingAfter)}</span>
            </div>
          )}
          {remainingAfter <= 0 && totalPaying > 0 && (
            <div className="flex justify-between">
              <span className="text-gray-600">结算状态</span>
              <span className="font-medium text-green-600">已结清</span>
            </div>
          )}
        </div>

        <div className="flex gap-3 justify-end pt-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={loading || totalPaying <= 0}
            className="px-5 py-2.5 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? "结算中..." : "确认结算"}
          </button>
        </div>
      </form>
    </div>
  );
}

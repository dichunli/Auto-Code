"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { useConfirm } from "./ConfirmDialog";
import { 登记预收款, 预收款退款 } from "@/app/work-orders/actions";

interface PaymentMethod {
  code: string;
  name: string;
}

interface AdvancePaymentRecord {
  id: string;
  amount: number;
  refunded_amount: number | null;
  method: string;
  refund_method: string | null;
  collector_name: string | null;
  paid_at: string;
}

interface Props {
  orderId: string;
  advancePayment: number;
  totalCost: number;
  records?: AdvancePaymentRecord[];
}

export default function AdvancePaymentDropdown({ orderId, advancePayment, totalCost, records = [] }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [collectorName, setCollectorName] = useState("");
  const [loading, setLoading] = useState(false);
  const { 请求确认, 确认弹窗 } = useConfirm();
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundMethod, setRefundMethod] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  /* 加载收款方式和当前操作员 */
  useEffect(() => {
    async function init() {
      const { data: mData } = await supabase
        .from("payment_methods")
        .select("code, name")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      const loadedMethods = (mData || []) as PaymentMethod[];
      setMethods(loadedMethods);
      if (loadedMethods.length > 0 && !method) {
        setMethod(loadedMethods[0].code);
      }
      if (loadedMethods.length > 0 && !refundMethod) {
        setRefundMethod(loadedMethods[0].code);
      }

      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", userData.user.id)
          .single();
        setCollectorName(profile?.full_name || "");
      }
    }
    init();
  }, [supabase]);

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

  const methodLabel = (code: string) => methods.find((m) => m.code === code)?.name || code;

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
    if (!(await 请求确认(`确认退款 ${formatCurrency(val)}？`))) return;

    setLoading(true);

    /* 涉钱写操作走 Server Action + RPC 事务，不再客户端两步直写 */
    try {
      const result = await 预收款退款({
        orderId,
        recordId: record.id,
        amount: val,
        refundMethod,
      });
      setLoading(false);
      if (!result.success) {
        alert("退款失败：" + (result.error || "未知错误"));
        return;
      }
    } catch {
      setLoading(false);
      alert("退款失败：网络异常，请重试");
      return;
    }

    setRefundingId(null);
    setRefundAmount("");
    if (methods.length > 0) setRefundMethod(methods[0].code);
    router.refresh();
  }

  async function handleSave() {
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) {
      alert("请输入有效金额");
      return;
    }
    if (!method) {
      alert("请选择收款方式");
      return;
    }
    setLoading(true);

    /* 涉钱写操作走 Server Action + RPC 事务；收款人 id 由服务端取登录用户 */
    try {
      const result = await 登记预收款({
        orderId,
        amount: val,
        method,
        collectorName: collectorName.trim(),
      });
      setLoading(false);
      if (!result.success) {
        alert("保存失败：" + (result.error || "未知错误"));
        return;
      }
    } catch {
      setLoading(false);
      alert("保存失败：网络异常，请重试");
      return;
    }

    setAmount("");
    if (methods.length > 0) setMethod(methods[0].code);
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
                <span className="text-gray-600">已预收净额</span>
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
              {/* 预收款记录列表 */}
              {records.length > 0 && (
                <div className="border-t border-gray-100 pt-2 space-y-1.5 max-h-40 overflow-y-auto">
                  {records.map((r: AdvancePaymentRecord) => {
                    const net = (r.amount || 0) - (r.refunded_amount || 0);
                    const isRefunding = refundingId === r.id;
                    return (
                      <div key={r.id} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-500">
                            {new Date(r.paid_at).toLocaleDateString("zh-CN")}
                            {" · "}{methodLabel(r.method)}
                            {r.collector_name && ` · ${r.collector_name}`}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className={net <= 0 ? "text-gray-400 line-through" : "text-gray-700"}>
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
                                className="text-[10px] px-1 py-0.5 rounded bg-orange-50 text-orange-600 hover:bg-orange-100 disabled:opacity-50"
                              >
                                退款
                              </button>
                            )}
                            {net <= 0 && (
                              <span className="text-[10px] px-1 py-0.5 rounded bg-gray-100 text-gray-400">已退完</span>
                            )}
                          </div>
                        </div>
                        {(r.refunded_amount || 0) > 0 && (
                          <div className="flex justify-between text-[10px] text-gray-400 pl-2">
                            <span>已退款 · {methodLabel(r.refund_method || "") || "未知方式"}</span>
                            <span className="text-orange-500">-{formatCurrency(r.refunded_amount)}</span>
                          </div>
                        )}
                        {isRefunding && (
                          <div className="flex items-center gap-1.5 pl-2 flex-wrap">
                            <input
                              type="number"
                              step="0.01"
                              min="0.01"
                              max={net}
                              value={refundAmount}
                              onChange={(e) => setRefundAmount(e.target.value)}
                              className="w-16 px-1 py-0.5 border border-orange-200 rounded text-xs text-right"
                              autoFocus
                            />
                            <select
                              value={refundMethod}
                              onChange={(e) => setRefundMethod(e.target.value)}
                              className="px-1 py-0.5 border border-orange-200 rounded text-xs"
                            >
                              {methods.map((m) => (
                                <option key={m.code} value={m.code}>{m.name}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => handleRefund(r)}
                              disabled={loading}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50"
                            >
                              {loading ? "..." : "确认"}
                            </button>
                            <button
                              type="button"
                              onClick={() => { setRefundingId(null); setRefundAmount(""); if (methods.length > 0) setRefundMethod(methods[0].code); }}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200"
                            >
                              取消
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  setAmount("");
                  if (methods.length > 0) setMethod(methods[0].code);
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
                <label className="block text-xs text-gray-500 mb-1">预收金额 *</label>
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
                <label className="block text-xs text-gray-500 mb-1">收款方式 *</label>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {methods.map((m) => (
                    <option key={m.code} value={m.code}>{m.name}</option>
                  ))}
                  {methods.length === 0 && <option value="">暂无收款方式</option>}
                </select>
                {methods.length === 0 && (
                  <p className="text-[10px] text-orange-600 mt-1">请先到「财务管理 → 收款方式」中预设</p>
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">收款人</label>
                <input
                  type="text"
                  value={collectorName}
                  onChange={(e) => setCollectorName(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="默认当前登录用户"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={loading || methods.length === 0}
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
      {确认弹窗}
    </div>
  );
}

"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { useConfirm } from "@/components/ConfirmDialog";
import { 登记外包付款, 作废外包付款 } from "./actions";
import { toast } from "@/lib/globalToast";

/* ═══ 外包应付「付款/记录」操作格（2026-09-16 往来账销账闭环 第二部分） ═══
 * 应付账页是 RSC，交互单独抽成这个 Client 组件：
 * 付款弹窗（金额默认填满未付余额）+ 付款记录弹窗（流水查看/作废），成功后 router.refresh() 刷新服务端数据 */

interface Account {
  id: string;
  name: string;
}

interface PaymentMethod {
  code: string;
  name: string;
}

interface 付款流水 {
  id: string;
  amount: number;
  payment_method: string | null;
  paid_at: string;
  status: string;
  note: string | null;
  profiles: { full_name: string } | null;
  finance_accounts: { name: string } | null;
}

/* datetime-local 输入框的默认值（本地时区） */
function 本地时间字符串(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ApPaymentCell({
  payableId,
  单据名,
  未付金额,
  状态,
  accounts,
  paymentMethods,
}: {
  payableId: string;
  单据名: string;
  未付金额: number;
  状态: string;
  accounts: Account[];
  paymentMethods: PaymentMethod[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { 请求确认, 确认弹窗 } = useConfirm();

  const [showPay, setShowPay] = useState(false);
  const [showRecords, setShowRecords] = useState(false);
  const [amountStr, setAmountStr] = useState("");
  const [accountId, setAccountId] = useState("");
  const [method, setMethod] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const [records, setRecords] = useState<付款流水[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);

  function 打开付款() {
    setAmountStr(未付金额.toFixed(2));
    setAccountId("");
    setMethod("");
    setPaidAt(本地时间字符串(new Date()));
    setNote("");
    setShowPay(true);
  }

  async function 打开记录() {
    setShowRecords(true);
    setLoadingRecords(true);
    const { data, error } = await supabase
      .from("ap_payment_records")
      .select("id, amount, payment_method, paid_at, status, note, profiles!ap_payment_records_created_by_fkey(full_name), finance_accounts(name)")
      .eq("payable_id", payableId)
      .order("created_at", { ascending: false });
    setLoadingRecords(false);
    if (error) {
      toast("加载付款记录失败: " + error.message, "error");
      return;
    }
    setRecords((data || []) as unknown as 付款流水[]);
  }

  async function 提交付款() {
    const 金额 = parseFloat(amountStr);
    if (!Number.isFinite(金额) || 金额 <= 0) {
      toast("付款金额必须大于 0", "warning");
      return;
    }
    if (Math.round(金额 * 100) > Math.round(未付金额 * 100)) {
      toast(`付款金额不能超过未付余额（${formatCurrency(未付金额)}）`, "warning");
      return;
    }
    if (!accountId) {
      toast("请选择付款账户（钱从哪个账户付出去）", "warning");
      return;
    }
    setSaving(true);
    try {
      const res = await 登记外包付款({
        payable_id: payableId,
        amount: 金额,
        account_id: accountId,
        payment_method: method || undefined,
        paid_at: paidAt ? new Date(paidAt).toISOString() : undefined,
        note: note || undefined,
      });
      setSaving(false);
      if (!res.success) {
        toast("保存失败: " + (res.error || "未知错误"), "error");
        return;
      }
      toast("付款已登记", "success");
      setShowPay(false);
      router.refresh();
    } catch (err: unknown) {
      setSaving(false);
      toast("保存失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    }
  }

  async function 作废(r: 付款流水) {
    if (
      !(await 请求确认({
        title: "作废付款记录",
        message: `确定作废这笔 ${formatCurrency(r.amount)} 的付款吗？\n\n作废后：应付款恢复未付状态、账户余额自动退回。`,
        confirmText: "确定作废",
      }))
    )
      return;
    const res = await 作废外包付款(r.id);
    if (!res.success) {
      toast("作废失败: " + (res.error || "未知错误"), "error");
      return;
    }
    toast("付款记录已作废", "success");
    打开记录();
    router.refresh();
  }

  const 可付款 = 状态 === "pending" || 状态 === "partial";
  const 有已付 = 未付金额 >= 0 && 状态 !== "pending";

  return (
    <div className="flex justify-end gap-3">
      {可付款 && (
        <button onClick={打开付款} className="text-xs text-green-600 hover:underline">
          付款
        </button>
      )}
      {有已付 && (
        <button onClick={打开记录} className="text-xs text-gray-600 hover:underline">
          记录
        </button>
      )}

      {/* 付款弹窗 */}
      {showPay && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">登记外包付款</h3>
              <button onClick={() => setShowPay(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="text-sm text-gray-600 bg-gray-50 rounded-lg px-4 py-3">
                {单据名}，未付余额 <b className="text-red-600">{formatCurrency(未付金额)}</b>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">付款金额 *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">付款账户 *（钱从哪个账户付出去）</label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  <option value="">请选择</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">支付方式</label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  <option value="">未选</option>
                  {paymentMethods.map((m) => (
                    <option key={m.code} value={m.name}>{m.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">付款时间</label>
                <input
                  type="datetime-local"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  value={paidAt}
                  onChange={(e) => setPaidAt(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">备注</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="选填"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowPay(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={提交付款}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "保存中..." : "确认付款"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 付款记录弹窗 */}
      {showRecords && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">付款记录</h3>
              <button onClick={() => setShowRecords(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
              <div className="text-sm text-gray-600 bg-gray-50 rounded-lg px-4 py-3 mb-3">{单据名}</div>
              {loadingRecords ? (
                <div className="text-sm text-gray-400 text-center py-6">加载中...</div>
              ) : records.length === 0 ? (
                <div className="text-sm text-gray-400 text-center py-6">暂无付款记录</div>
              ) : (
                <div className="space-y-2">
                  {records.map((r) => (
                    <div
                      key={r.id}
                      className={`flex items-center justify-between text-sm border border-gray-100 rounded-lg px-4 py-3 ${
                        r.status === "voided" ? "opacity-50" : ""
                      }`}
                    >
                      <div>
                        <div className="font-medium text-gray-900">
                          {formatCurrency(r.amount)}
                          {r.status === "voided" && <span className="ml-2 text-xs text-gray-400">（已作废）</span>}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {new Date(r.paid_at).toLocaleString("zh-CN")}
                          {r.payment_method ? ` · ${r.payment_method}` : ""}
                          {r.finance_accounts?.name ? ` · ${r.finance_accounts.name}` : ""}
                          {r.profiles?.full_name ? ` · ${r.profiles.full_name}` : ""}
                          {r.note ? ` · ${r.note}` : ""}
                        </div>
                      </div>
                      {r.status === "confirmed" && (
                        <button onClick={() => 作废(r)} className="text-xs text-red-600 hover:underline ml-3">
                          作废
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                type="button"
                onClick={() => setShowRecords(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {确认弹窗}
    </div>
  );
}

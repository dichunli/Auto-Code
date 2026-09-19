"use client";

import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useDebounce } from "@/lib/useDebounce";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/utils";
import { useConfirm } from "@/components/ConfirmDialog";
import { 转分, 元到分, 先进先出勾稽, 核销合计分 as 计算核销合计分, type 应付勾选行 } from "@/lib/supplierPaymentAlloc";
import { 创建供应商付款单, 作废供应商付款单, 创建供应商收款单, 作废供应商收款单 } from "./actions";
import { toast } from "@/lib/globalToast";

/* ═══ 类型定义 ═══ */

interface Supplier {
  id: string;
  name: string;
}

interface PaymentMethod {
  code: string;
  name: string;
}

interface PaymentRecord {
  id: string;
  payment_no: string;
  supplier_id: string;
  amount: number;
  /* 2026-09-16 批次6：优惠金额（抹零） */
  discount_amount: number | null;
  payment_method: string | null;
  paid_at: string;
  status: string;
  note: string | null;
  created_at: string;
  suppliers: { name: string } | null;
  profiles: { full_name: string } | null;
}

/* 收款单（2026-09-16 批次7：供应商退回多付/退货款） */
interface ReceiptRecord {
  id: string;
  receipt_no: string;
  supplier_id: string;
  amount: number;
  payment_method: string | null;
  received_at: string;
  status: string;
  note: string | null;
  created_at: string;
  suppliers: { name: string } | null;
  profiles: { full_name: string } | null;
}

/* supplier_balances 汇总行（批次7 起含累计优惠 total_discount） */
interface SupplierSummaryRow {
  supplier_id: string;
  supplier_name: string;
  balance: number;
  inbound_count: number;
  total_debit: number;
  total_payment: number;
  total_credit: number;
  total_discount: number;
}

/* ═══ 退货核对数据（2026-09-17 批次7：退货入账流水 vs 退货单据逐笔对金额） ═══ */

/* credit 退货流水 */
interface CreditTxn {
  id: string;
  supplier_id: string | null;
  amount: number;
  description: string | null;
  reference_id: string | null;
  reference_type: string | null;
  created_at: string;
  suppliers: { name: string } | null;
}

/* 采退单（整张退货单，金额=其下退货记录 数量×采购价 合计） */
interface ReturnOrder {
  id: string;
  return_no: string | null;
  status: string;
  created_at: string;
}

/* 退货记录（单据金额 = 数量×采购价快照） */
interface ReturnRecord {
  id: string;
  quantity: number | null;
  unit_cost: number | null;
  return_order_id: string | null;
  part_name: string | null;
  status: string;
}

/* 对账结果行 */
interface 对账行 {
  流水id: string;
  时间: string;
  供应商名: string;
  流水金额: number;
  单据类型: "采退单" | "退货记录" | "无关联";
  单据标识: string;
  单据金额: number | null; /* null=单据缺单价算不出 */
  差额: number | null;
  核对: "一致" | "对不上" | "无法核对";
}

/* list_supplier_payables 返回的单笔应付 */
interface PayableRow {
  transaction_id: string;
  amount: number;
  allocated: number;
  remaining: number;
  created_at: string;
  description: string | null;
  inbound_order_id: string | null;
  inbound_no: string | null;
  supplier_order_no: string | null;
}

interface PayablesResult {
  success: boolean;
  error?: string;
  payables?: PayableRow[];
  pool?: number;
  allocated?: number;
  available?: number;
  balance?: number;
}

/* 弹窗里应付行 + 用户勾选状态（勾稽纯函数来自 @/lib/supplierPaymentAlloc，有单元测试） */
type PayableUI = 应付勾选行<PayableRow>;

/* 展开的核销明细行 */
interface AllocDetailRow {
  id: string;
  amount: number;
  transaction_id: string;
  description: string | null;
  inbound_no: string | null;
}

/* ═══ 工具函数（金额一律转分比较，防浮点误差） ═══ */

/* datetime-local 输入框的默认值（本地时区） */
function 本地时间字符串(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* 余额是否有效（|余额| > 0.004，防浮点毛刺） */
function 有余额(n: number): boolean {
  return Math.abs(n) > 0.004;
}

/* 剩余欠款显示：正数红=咱欠供应商；负数绿=供应商欠咱（多付/待退款） */
function 余额文本(n: number): string {
  if (n < -0.004) return `-¥${Math.abs(n).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return formatCurrency(n);
}

/* ═══ 新建付款弹窗（独立组件：放主组件外面，符合静态组件规范） ═══ */

function PaymentFormModal({
  suppliers,
  paymentMethods,
  预选供应商id,
  onClose,
  onSaved,
}: {
  suppliers: Supplier[];
  paymentMethods: PaymentMethod[];
  预选供应商id: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [supplierId, setSupplierId] = useState(预选供应商id);
  const [amountStr, setAmountStr] = useState("");
  const [discountStr, setDiscountStr] = useState(""); /* 2026-09-16 批次6：优惠金额（抹零，不是真付钱） */
  const [method, setMethod] = useState("");
  const [paidAt, setPaidAt] = useState(() => 本地时间字符串(new Date()));
  const [note, setNote] = useState("");
  const [payables, setPayables] = useState<PayableUI[]>([]);
  const [可用额度分, set可用额度分] = useState(0);
  const [欠款分, set欠款分] = useState(0);
  const [loadingPayables, setLoadingPayables] = useState(false);
  const [saving, setSaving] = useState(false);
  /* 金额/优惠镜像：选供应商加载应付时要用最新额度做 FIFO，但不想挂进 effect 依赖（每敲数字就重拉）。
     注意：ref 只能在 effect 里写（react-hooks/refs 新规），不能渲染期直接赋值 */
  const amountStrRef = useRef(amountStr);
  useEffect(() => {
    amountStrRef.current = amountStr;
  }, [amountStr]);
  const discountStrRef = useRef(discountStr);
  useEffect(() => {
    discountStrRef.current = discountStr;
  }, [discountStr]);

  /* 加载供应商应付清单（含可核销额度、欠款余额），并做 FIFO 预勾 */
  const 加载应付 = useCallback(
    async (sid: string, 付款分: number) => {
      setLoadingPayables(true);
      const { data, error } = await supabase.rpc("list_supplier_payables", { p_supplier_id: sid });
      setLoadingPayables(false);
      if (error) {
        toast("加载应付清单失败: " + error.message, "error");
        return;
      }
      const 结果 = data as PayablesResult | null;
      if (!结果?.success) {
        toast("加载应付清单失败: " + (结果?.error || "未知错误"), "error");
        return;
      }
      const 清单 = 结果.payables || [];
      const 可用 = 元到分(结果.available || 0);
      set可用额度分(可用);
      set欠款分(元到分(结果.balance || 0));
      setPayables(先进先出勾稽(清单, 付款分, 可用));
    },
    [supabase]
  );

  /* 选供应商 / 进入弹窗时加载 */
  useEffect(() => {
    if (supplierId) {
      加载应付(supplierId, 转分(amountStrRef.current) + 转分(discountStrRef.current));
    } else {
      setPayables([]);
      set可用额度分(0);
      set欠款分(0);
    }
  }, [supplierId, 加载应付]);

  /* 金额/优惠变化 → 基于已加载清单重新 FIFO（不重新拉接口）。
     FIFO 的"本单额度"= 实付 + 优惠（批次6：优惠也算能拿去勾单的钱） */
  function 金额变化(新金额: string) {
    setAmountStr(新金额);
    if (payables.length > 0) {
      setPayables(先进先出勾稽(payables, 转分(新金额) + 转分(discountStr), 可用额度分));
    }
  }

  function 优惠变化(新优惠: string) {
    setDiscountStr(新优惠);
    if (payables.length > 0) {
      setPayables(先进先出勾稽(payables, 转分(amountStr) + 转分(新优惠), 可用额度分));
    }
  }

  function 勾选行(tid: string, 勾选: boolean) {
    setPayables((prev) =>
      prev.map((r) =>
        r.transaction_id === tid
          ? { ...r, checked: 勾选, allocStr: 勾选 ? r.remaining.toFixed(2) : "" }
          : r
      )
    );
  }

  function 改勾稽金额(tid: string, 值: string) {
    setPayables((prev) =>
      prev.map((r) => (r.transaction_id === tid ? { ...r, allocStr: 值 } : r))
    );
  }

  const 付款分 = 转分(amountStr);
  const 优惠分 = 转分(discountStr);
  const 核销合计分 = 计算核销合计分(payables);
  /* 本单可用额度 = 实付 + 优惠 + 历史余额；剩余预付 = 没勾完的部分 */
  const 剩余预付分 = 付款分 + 优惠分 + 可用额度分 - 核销合计分;

  async function 提交() {
    if (!supplierId) {
      toast("请选择供应商", "warning");
      return;
    }
    if (付款分 + 优惠分 <= 0) {
      toast("付款金额和优惠金额至少一项要大于 0", "warning");
      return;
    }
    /* 实付为 0 时必须填优惠才有意义（纯抹零单），界面上不强制选支付方式 */
    for (const r of payables) {
      if (!r.checked) continue;
      const 勾 = 转分(r.allocStr);
      if (勾 <= 0) {
        toast(`入库单 ${r.inbound_no || r.description || ""} 的核销金额必须大于 0`, "warning");
        return;
      }
      if (勾 > 元到分(r.remaining)) {
        toast(`入库单 ${r.inbound_no || r.description || ""} 的核销金额超过未付余额`, "warning");
        return;
      }
    }
    if (核销合计分 > 付款分 + 优惠分 + 可用额度分) {
      toast("核销合计超过可核销额度（本次付款 + 优惠 + 历史付款余额）", "warning");
      return;
    }

    setSaving(true);
    try {
      const res = await 创建供应商付款单({
        supplier_id: supplierId,
        amount: 付款分 / 100,
        discount_amount: 优惠分 / 100,
        payment_method: method || undefined,
        paid_at: paidAt ? new Date(paidAt).toISOString() : undefined,
        note: note || undefined,
        allocations: payables
          .filter((r) => r.checked)
          .map((r) => ({ transaction_id: r.transaction_id, amount: 转分(r.allocStr) / 100 })),
      });
      setSaving(false);
      if (!res.success) {
        toast("保存失败: " + (res.error || "未知错误"), "error");
        /* 并发超勾等情况：重拉清单让用户看到最新可勾状态 */
        加载应付(supplierId, 付款分 + 优惠分);
        return;
      }
      toast(`付款单 ${res.payment_no || ""} 已保存`, "success");
      onSaved();
    } catch (err: unknown) {
      setSaving(false);
      toast("保存失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">新建付款单</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">
          {/* 基本信息 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">供应商 *</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">请选择</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">付款金额（实付）</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                value={amountStr}
                onChange={(e) => 金额变化(e.target.value)}
                placeholder="实际付出去的钱"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">优惠金额（抹零）</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                value={discountStr}
                onChange={(e) => 优惠变化(e.target.value)}
                placeholder="供应商少收的，填0"
              />
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
            <div className="sm:col-span-2">
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

          {/* 供应商账务摘要 */}
          {supplierId && (
            <div className="flex flex-wrap gap-4 text-sm bg-gray-50 rounded-lg px-4 py-3">
              <span className="text-gray-600">
                当前欠款：<b className={欠款分 > 0 ? "text-red-600" : "text-gray-900"}>{formatCurrency(欠款分 / 100)}</b>
              </span>
              <span className="text-gray-600">
                历史付款余额（可勾稽）：<b className="text-gray-900">{formatCurrency(可用额度分 / 100)}</b>
              </span>
              {loadingPayables && <span className="text-gray-400">应付清单加载中...</span>}
            </div>
          )}

          {/* 应付清单 + 勾稽 */}
          {supplierId && payables.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-900">核销到哪几笔应付（默认从老到新自动勾）</h4>
                <button
                  type="button"
                  onClick={() => setPayables(先进先出勾稽(payables, 付款分 + 优惠分, 可用额度分))}
                  className="text-xs text-blue-600 hover:underline"
                >
                  重新自动勾稽
                </button>
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 w-10"></th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">应付时间</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">入库单</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">应付</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">已付</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">未付</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500 w-32">本次勾稽</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {payables.map((r) => (
                      <tr key={r.transaction_id} className={r.checked ? "bg-blue-50/40" : ""}>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={r.checked}
                            onChange={(e) => 勾选行(r.transaction_id, e.target.checked)}
                          />
                        </td>
                        <td className="px-3 py-2 text-gray-500 text-xs">
                          {new Date(r.created_at).toLocaleDateString("zh-CN")}
                        </td>
                        <td className="px-3 py-2 text-gray-900">
                          {r.inbound_no || r.description || "-"}
                          {r.supplier_order_no && (
                            <span className="block text-xs text-gray-400">销售单 {r.supplier_order_no}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600">{formatCurrency(r.amount)}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{formatCurrency(r.allocated)}</td>
                        <td className="px-3 py-2 text-right font-medium text-red-600">{formatCurrency(r.remaining)}</td>
                        <td className="px-3 py-2 text-right">
                          {r.checked && (
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              className="w-28 px-2 py-1 border border-gray-300 rounded text-sm text-right"
                              value={r.allocStr}
                              onChange={(e) => 改勾稽金额(r.transaction_id, e.target.value)}
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-4 mt-2 text-sm">
                <span className="text-gray-600">
                  本次核销合计：<b className="text-blue-700">{formatCurrency(核销合计分 / 100)}</b>
                </span>
                <span className="text-gray-600">
                  付款后剩余预付：<b className={剩余预付分 < 0 ? "text-red-600" : "text-gray-900"}>
                    {formatCurrency(Math.max(0, 剩余预付分) / 100)}
                  </b>
                </span>
                {剩余预付分 < 0 && <span className="text-red-600 text-xs">核销超过可核销额度，请减少勾稽</span>}
              </div>
            </div>
          )}

          {supplierId && !loadingPayables && payables.length === 0 && (
            <div className="text-sm text-gray-400 bg-gray-50 rounded-lg px-4 py-6 text-center">
              该供应商没有应付记录，本次付款将全额记为预付
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={提交}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "保存中..." : "确认付款"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══ 新建收款弹窗（2026-09-16 批次7：供应商退回多付/退货款时记一笔，销负余额） ═══ */

function ReceiptFormModal({
  supplierName,
  待退余额,
  paymentMethods,
  onClose,
  onSaved,
  onSubmit,
}: {
  supplierName: string;
  待退余额: number; /* 正数：供应商欠咱的金额 */
  paymentMethods: PaymentMethod[];
  onClose: () => void;
  onSaved: () => void;
  onSubmit: (参数: { amount: number; payment_method?: string; received_at?: string; note?: string }) => Promise<{ success: boolean; receipt_no?: string; error?: string }>;
}) {
  const [amountStr, setAmountStr] = useState(待退余额.toFixed(2));
  const [method, setMethod] = useState("");
  const [receivedAt, setReceivedAt] = useState(() => 本地时间字符串(new Date()));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function 提交() {
    const 分 = 转分(amountStr);
    if (分 <= 0) {
      toast("收款金额必须大于 0", "warning");
      return;
    }
    if (分 > 元到分(待退余额)) {
      toast(`收款金额不能超过该供应商的待退余额 ${formatCurrency(待退余额)}`, "warning");
      return;
    }
    setSaving(true);
    try {
      const res = await onSubmit({
        amount: 分 / 100,
        payment_method: method || undefined,
        received_at: receivedAt ? new Date(receivedAt).toISOString() : undefined,
        note: note || undefined,
      });
      setSaving(false);
      if (!res.success) {
        toast("保存失败: " + (res.error || "未知错误"), "error");
        return;
      }
      toast(`收款单 ${res.receipt_no || ""} 已保存`, "success");
      onSaved();
    } catch (err: unknown) {
      setSaving(false);
      toast("保存失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">新建收款单</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="text-sm bg-green-50 border border-green-100 rounded-lg px-4 py-3 text-green-800">
            <b>{supplierName}</b> 欠咱 <b>{formatCurrency(待退余额)}</b>（咱多付的/待退的货款），
            收到对方退回的钱后在这里记一笔，账目自动销平。
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">收款金额 *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder="实际收到的钱"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">收款方式</label>
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
              <label className="block text-xs text-gray-500 mb-1">收款时间</label>
              <input
                type="datetime-local"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                value={receivedAt}
                onChange={(e) => setReceivedAt(e.target.value)}
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
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={提交}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? "保存中..." : "确认收款"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══ 主页面组件 ═══ */

type 页签 = "summary" | "payments" | "receipts" | "returnCheck";

export default function SupplierPaymentsContent({
  initialPayments,
  initialSuppliers,
  paymentMethods,
  initialSummary,
  initialReceipts,
  initialCreditTxns,
  returnOrders,
  returnRecords,
  预选供应商id,
  自动开单,
}: {
  initialPayments: PaymentRecord[];
  initialSuppliers: Supplier[];
  paymentMethods: PaymentMethod[];
  initialSummary: SupplierSummaryRow[];
  initialReceipts: ReceiptRecord[];
  initialCreditTxns: CreditTxn[];
  returnOrders: ReturnOrder[];
  returnRecords: ReturnRecord[];
  预选供应商id: string;
  自动开单: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { 请求确认, 确认弹窗 } = useConfirm();

  const [tab, setTab] = useState<页签>("summary");
  const [payments, setPayments] = useState<PaymentRecord[]>(initialPayments);
  const [suppliers] = useState<Supplier[]>(initialSuppliers);
  const [summary, setSummary] = useState<SupplierSummaryRow[]>(initialSummary);
  const [receipts, setReceipts] = useState<ReceiptRecord[]>(initialReceipts);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const debouncedQuery = useDebounce(query, 300);

  /* 汇总大表筛选（批次7） */
  const [汇总搜索, set汇总搜索] = useState("");
  const [只看有余额, set只看有余额] = useState(true);
  const debounced汇总搜索 = useDebounce(汇总搜索, 300);

  const [showForm, setShowForm] = useState(自动开单);
  const [付款预选, set付款预选] = useState(预选供应商id);
  const [收款目标, set收款目标] = useState<{ id: string; name: string; 待退: number } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [allocDetails, setAllocDetails] = useState<Record<string, AllocDetailRow[]>>({});
  const [detailLoading, setDetailLoading] = useState(false);

  async function loadPayments() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("supplier_payments")
      .select("*, suppliers(name), profiles!supplier_payments_created_by_fkey(full_name)")
      .order("created_at", { ascending: false })
      .limit(500);
    setLoading(false);
    if (error) {
      toast("加载失败: " + error.message, "error");
      return;
    }
    setPayments((data || []) as PaymentRecord[]);
    setAllocDetails({});
    setExpandedId(null);
  }

  /* 批次7：汇总大表和收款单列表的刷新（付款/收款/作废后调用） */
  async function loadSummary() {
    const { data, error } = await supabase.rpc("supplier_balances");
    if (error) {
      toast("加载供应商汇总失败: " + error.message, "error");
      return;
    }
    setSummary((data || []) as SupplierSummaryRow[]);
  }

  async function loadReceipts() {
    const { data, error } = await supabase
      .from("supplier_receipts")
      .select("*, suppliers(name), profiles!supplier_receipts_created_by_fkey(full_name)")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      toast("加载收款单失败: " + error.message, "error");
      return;
    }
    setReceipts((data || []) as ReceiptRecord[]);
  }

  /* ═══ 汇总大表（供应商汇总页签） ═══ */

  const filteredSummary = useMemo(() => {
    let list = summary;
    if (只看有余额) {
      /* 应付（正）和应收（负）都显示 */
      list = list.filter((r) => 有余额(Number(r.balance)));
    } else {
      /* 全部 = 有过任何往来记录的 */
      list = list.filter(
        (r) =>
          Number(r.inbound_count) > 0 ||
          Number(r.total_payment) > 0 ||
          Number(r.total_credit) > 0 ||
          Number(r.total_discount) > 0 ||
          有余额(Number(r.balance))
      );
    }
    const q = debounced汇总搜索.trim();
    if (q) list = list.filter((r) => r.supplier_name.includes(q));
    return list;
  }, [summary, 只看有余额, debounced汇总搜索]);

  /* 顶部卡片：基于全部供应商（口径固定，不随筛选变） */
  const 汇总卡片 = useMemo(() => {
    let 应付 = 0;
    let 应收 = 0;
    for (const r of summary) {
      const b = Number(r.balance);
      if (b > 0.004) 应付 += b;
      else if (b < -0.004) 应收 += Math.abs(b);
    }
    return { 应付, 应收 };
  }, [summary]);

  /* 底部合计行：跟随当前筛选 */
  const 合计 = useMemo(
    () => ({
      balance: filteredSummary.reduce((s, r) => s + Number(r.balance), 0),
      inbound: filteredSummary.reduce((s, r) => s + Number(r.inbound_count), 0),
      debit: filteredSummary.reduce((s, r) => s + Number(r.total_debit), 0),
      payment: filteredSummary.reduce((s, r) => s + Number(r.total_payment), 0),
      discount: filteredSummary.reduce((s, r) => s + Number(r.total_discount), 0),
      credit: filteredSummary.reduce((s, r) => s + Number(r.total_credit), 0),
    }),
    [filteredSummary]
  );

  /* ═══ 退货核对（批次7）：每笔退货入账流水 vs 来源单据金额逐笔对 ═══ */
  const [只看对不上, set只看对不上] = useState(false);

  const 对账行们 = useMemo<对账行[]>(() => {
    const 记录Map = new Map(returnRecords.map((r) => [r.id, r]));
    const 采退单Map = new Map(returnOrders.map((o) => [o.id, o]));
    /* 采退单 → 其下退货记录合计金额（任一记录缺单价则整单算不出） */
    const 采退单金额 = new Map<string, number | null>();
    for (const rec of returnRecords) {
      if (!rec.return_order_id) continue;
      const 已有 = 采退单金额.get(rec.return_order_id);
      if (rec.quantity == null || rec.unit_cost == null) {
        采退单金额.set(rec.return_order_id, null);
      } else if (已有 !== null) {
        采退单金额.set(rec.return_order_id, (已有 || 0) + rec.quantity * rec.unit_cost);
      }
    }

    return initialCreditTxns.map((t): 对账行 => {
      const 流水金额 = Number(t.amount);
      const 基础 = {
        流水id: t.id,
        时间: t.created_at,
        供应商名: t.suppliers?.name || "-",
        流水金额,
      };
      if (t.reference_type === "supplier_return_record" && t.reference_id) {
        const rec = 记录Map.get(t.reference_id);
        if (!rec) {
          return { ...基础, 单据类型: "退货记录" as const, 单据标识: "记录不存在", 单据金额: null, 差额: null, 核对: "对不上" as const };
        }
        if (rec.quantity == null || rec.unit_cost == null) {
          return { ...基础, 单据类型: "退货记录" as const, 单据标识: rec.part_name || "退货记录", 单据金额: null, 差额: null, 核对: "无法核对" as const };
        }
        const 单据金额 = Math.round(rec.quantity * rec.unit_cost * 100) / 100;
        const 差额 = Math.round((流水金额 - 单据金额) * 100) / 100;
        return {
          ...基础,
          单据类型: "退货记录" as const,
          单据标识: `${rec.part_name || "配件"} ×${rec.quantity}`,
          单据金额,
          差额,
          核对: Math.abs(差额) <= 0.005 ? ("一致" as const) : ("对不上" as const),
        };
      }
      if (t.reference_type === "purchase_return_order" && t.reference_id) {
        const 单 = 采退单Map.get(t.reference_id);
        if (!单) {
          return { ...基础, 单据类型: "采退单" as const, 单据标识: "采退单不存在", 单据金额: null, 差额: null, 核对: "对不上" as const };
        }
        const 单据金额原始 = 采退单金额.get(t.reference_id);
        if (单据金额原始 == null) {
          return { ...基础, 单据类型: "采退单" as const, 单据标识: 单.return_no || "采退单", 单据金额: null, 差额: null, 核对: "无法核对" as const };
        }
        const 单据金额 = Math.round(单据金额原始 * 100) / 100;
        const 差额 = Math.round((流水金额 - 单据金额) * 100) / 100;
        return {
          ...基础,
          单据类型: "采退单" as const,
          单据标识: 单.return_no || "采退单",
          单据金额,
          差额,
          核对: Math.abs(差额) <= 0.005 ? ("一致" as const) : ("对不上" as const),
        };
      }
      /* 老数据/手工冲减：没有关联单据可核 */
      return { ...基础, 单据类型: "无关联" as const, 单据标识: t.description || "-", 单据金额: null, 差额: null, 核对: "无法核对" as const };
    });
  }, [initialCreditTxns, returnOrders, returnRecords]);

  const 对账统计 = useMemo(() => {
    const 对不上 = 对账行们.filter((r) => r.核对 === "对不上").length;
    return { 总数: 对账行们.length, 对不上 };
  }, [对账行们]);

  const 显示对账行 = useMemo(
    () => (只看对不上 ? 对账行们.filter((r) => r.核对 === "对不上") : 对账行们),
    [对账行们, 只看对不上]
  );

  async function 导出汇总Excel() {
    /* xlsx 约 400KB，改为点导出时才动态加载（2026-09-19，9-15 诊断🟡#20） */
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const 明细 = filteredSummary.map((r) => ({
      供应商: r.supplier_name,
      剩余欠款: Number(Number(r.balance).toFixed(2)),
      说明: Number(r.balance) > 0.004 ? "咱欠供应商" : Number(r.balance) < -0.004 ? "供应商欠咱" : "",
      入库单数: Number(r.inbound_count),
      累计进货: Number(Number(r.total_debit).toFixed(2)),
      累计已付: Number(Number(r.total_payment).toFixed(2)),
      累计优惠: Number(Number(r.total_discount).toFixed(2)),
      累计退货: Number(Number(r.total_credit).toFixed(2)),
    }));
    const 合计行 = {
      供应商: "合计",
      剩余欠款: Number(合计.balance.toFixed(2)),
      说明: "",
      入库单数: 合计.inbound,
      累计进货: Number(合计.debit.toFixed(2)),
      累计已付: Number(合计.payment.toFixed(2)),
      累计优惠: Number(合计.discount.toFixed(2)),
      累计退货: Number(合计.credit.toFixed(2)),
    };
    const ws = XLSX.utils.json_to_sheet([...明细, 合计行]);
    XLSX.utils.book_append_sheet(wb, ws, "供应商款项汇总");
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    XLSX.writeFile(wb, `供应商款项汇总_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.xlsx`);
  }

  /* 行内「付款」：预选该供应商直接开付款弹窗 */
  function 行内付款(r: SupplierSummaryRow) {
    set付款预选(r.supplier_id);
    setShowForm(true);
  }

  /* 行内「收款」：预选该供应商开收款弹窗（仅负数余额行显示） */
  function 行内收款(r: SupplierSummaryRow) {
    set收款目标({ id: r.supplier_id, name: r.supplier_name, 待退: Math.abs(Number(r.balance)) });
  }

  /* 前端过滤（供应商/状态走服务端条件重新拉也行，数据量小直接前端过滤） */
  const filtered = useMemo(() => {
    let list = payments;
    if (supplierFilter) list = list.filter((p) => p.supplier_id === supplierFilter);
    if (statusFilter) list = list.filter((p) => p.status === statusFilter);
    const sq = debouncedQuery.trim().toLowerCase();
    if (sq) {
      list = list.filter((p) => {
        const 名 = p.suppliers?.name || "";
        return (
          p.payment_no.toLowerCase().includes(sq) ||
          名.toLowerCase().includes(sq) ||
          (p.note || "").toLowerCase().includes(sq)
        );
      });
    }
    return list;
  }, [payments, supplierFilter, statusFilter, debouncedQuery]);

  /* 筛选变化回第 1 页 */
  useEffect(() => {
    setPage(1);
  }, [supplierFilter, statusFilter, debouncedQuery]);

  const 统计 = useMemo(() => {
    const 有效 = filtered.filter((p) => p.status === "confirmed");
    return {
      总额: 有效.reduce((s, p) => s + (p.amount || 0), 0),
      笔数: 有效.length,
      作废数: filtered.length - 有效.length,
    };
  }, [filtered]);

  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const 当前页 = Math.min(page, totalPages);
  const pagedRecords = filtered.slice((当前页 - 1) * pageSize, 当前页 * pageSize);

  /* 展开/收起核销明细（首次展开时拉取） */
  async function 切换展开(p: PaymentRecord) {
    if (expandedId === p.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(p.id);
    if (allocDetails[p.id]) return;
    setDetailLoading(true);
    const { data, error } = await supabase
      .from("supplier_payment_allocations")
      .select("id, amount, transaction_id, supplier_transactions(description, reference_id, reference_type)")
      .eq("payment_id", p.id)
      .order("created_at");
    if (error) {
      setDetailLoading(false);
      toast("加载核销明细失败: " + error.message, "error");
      return;
    }
    interface 嵌套行 {
      id: string;
      amount: number;
      transaction_id: string;
      supplier_transactions: { description: string | null; reference_id: string | null; reference_type: string | null } | null;
    }
    const 行们 = (data || []) as unknown as 嵌套行[];
    const 入库ids = 行们
      .map((r) => r.supplier_transactions?.reference_id)
      .filter((v): v is string => Boolean(v));
    let 单号Map = new Map<string, string>();
    if (入库ids.length > 0) {
      const { data: 入库单们 } = await supabase
        .from("inbound_orders")
        .select("id, inbound_no")
        .in("id", 入库ids);
      单号Map = new Map(((入库单们 || []) as { id: string; inbound_no: string }[]).map((o) => [o.id, o.inbound_no]));
    }
    setDetailLoading(false);
    setAllocDetails((prev) => ({
      ...prev,
      [p.id]: 行们.map((r) => ({
        id: r.id,
        amount: r.amount,
        transaction_id: r.transaction_id,
        description: r.supplier_transactions?.description || null,
        inbound_no: r.supplier_transactions?.reference_id
          ? 单号Map.get(r.supplier_transactions.reference_id) || null
          : null,
      })),
    }));
  }

  async function 作废(p: PaymentRecord) {
    if (
      !(await 请求确认({
        title: "作废付款单",
        message: `确定作废付款单 ${p.payment_no}（${formatCurrency(p.amount)}）吗？\n\n作废后：核销记录和付款流水一并删除，应付款恢复未付状态。`,
        confirmText: "确定作废",
      }))
    )
      return;
    const res = await 作废供应商付款单(p.id);
    if (!res.success) {
      toast("作废失败: " + (res.error || "未知错误"), "error");
      return;
    }
    toast(`付款单 ${p.payment_no} 已作废`, "success");
    loadPayments();
    loadSummary();
  }

  async function 作废收款(r: ReceiptRecord) {
    if (
      !(await 请求确认({
        title: "作废收款单",
        message: `确定作废收款单 ${r.receipt_no}（${formatCurrency(r.amount)}）吗？\n\n作废后：收款流水一并删除，该供应商的待退余额恢复。`,
        confirmText: "确定作废",
      }))
    )
      return;
    const res = await 作废供应商收款单(r.id);
    if (!res.success) {
      toast("作废失败: " + (res.error || "未知错误"), "error");
      return;
    }
    toast(`收款单 ${r.receipt_no} 已作废`, "success");
    loadReceipts();
    loadSummary();
  }

  const 页签们: { key: 页签; label: string }[] = [
    { key: "summary", label: "供应商汇总" },
    { key: "payments", label: "付款单" },
    { key: "receipts", label: "收款单" },
    { key: "returnCheck", label: `退货核对${对账统计.对不上 > 0 ? `（${对账统计.对不上}笔对不上）` : ""}` },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="供应商款项"
        description="供应商应付/应收一览：正数=咱欠供应商，负数=供应商欠咱（多付/待退款）；付款核销到入库单"
        action={{ href: "/supplier-transactions", label: "往来款项" }}
      />

      {/* 页签 */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {页签们.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`pb-3 text-sm font-medium border-b-2 -mb-px ${
                tab === t.key
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ═══ 页签1：供应商汇总大表（批次7，参考 1 号车间） ═══ */}
      {tab === "summary" && (
        <div className="space-y-4">
          {/* 应付/应收合计卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-sm text-gray-500">应付合计（咱欠供应商的）</div>
              <div className="text-xl font-bold text-red-600 mt-1">{formatCurrency(汇总卡片.应付)}</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-sm text-gray-500">应收合计（供应商欠咱的：多付/待退款）</div>
              <div className="text-xl font-bold text-green-600 mt-1">{formatCurrency(汇总卡片.应收)}</div>
            </div>
          </div>

          {/* 工具栏 */}
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="搜供应商名称..."
              className="w-full max-w-xs px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={汇总搜索}
              onChange={(e) => set汇总搜索(e.target.value)}
            />
            <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={只看有余额}
                onChange={(e) => set只看有余额(e.target.checked)}
              />
              只看有余额的
            </label>
            <button
              onClick={导出汇总Excel}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              导出 Excel
            </button>
            <button
              onClick={() => {
                set付款预选("");
                setShowForm(true);
              }}
              className="ml-auto px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              新建付款
            </button>
          </div>

          {/* 大表 */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">供应商</th>
                    <th
                      className="px-4 py-3 text-right font-medium text-gray-500"
                      title="正数（红）= 咱欠供应商的；负数（绿）= 供应商欠咱的（咱多付/待退款）"
                    >
                      剩余欠款 ⓘ
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">入库单数</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">累计进货</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">累计已付</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500" title="付款时供应商抹零少收的">
                      累计优惠 ⓘ
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">累计退货</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredSummary.map((r) => {
                    const bal = Number(r.balance);
                    return (
                      <tr key={r.supplier_id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <Link href={`/suppliers/${r.supplier_id}`} className="font-medium text-blue-600 hover:underline">
                            {r.supplier_name}
                          </Link>
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-semibold ${
                            bal > 0.004 ? "text-red-600" : bal < -0.004 ? "text-green-600" : "text-gray-400"
                          }`}
                        >
                          {余额文本(bal)}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600">{Number(r.inbound_count)}</td>
                        <td className="px-4 py-3 text-right text-gray-900">{formatCurrency(Number(r.total_debit))}</td>
                        <td className="px-4 py-3 text-right text-gray-900">{formatCurrency(Number(r.total_payment))}</td>
                        <td className="px-4 py-3 text-right text-orange-600">{formatCurrency(Number(r.total_discount))}</td>
                        <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(Number(r.total_credit))}</td>
                        <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                          <Link href={`/suppliers/${r.supplier_id}/statement`} className="text-xs text-gray-600 hover:underline">
                            对账单
                          </Link>
                          {bal > 0.004 && (
                            <button onClick={() => 行内付款(r)} className="text-xs text-blue-600 hover:underline font-medium">
                              付款
                            </button>
                          )}
                          {bal < -0.004 && (
                            <button onClick={() => 行内收款(r)} className="text-xs text-green-600 hover:underline font-medium">
                              收款
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredSummary.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-gray-400">
                        {只看有余额 ? "没有未结清的供应商款项" : "没有匹配的供应商"}
                      </td>
                    </tr>
                  )}
                </tbody>
                {filteredSummary.length > 0 && (
                  <tfoot>
                    <tr className="bg-blue-50/60 font-semibold text-gray-900">
                      <td className="px-4 py-3">合计（{filteredSummary.length} 家）</td>
                      <td className={`px-4 py-3 text-right ${合计.balance >= 0 ? "text-red-600" : "text-green-600"}`}>
                        {余额文本(合计.balance)}
                      </td>
                      <td className="px-4 py-3 text-right">{合计.inbound}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(合计.debit)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(合计.payment)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(合计.discount)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(合计.credit)}</td>
                      <td className="px-4 py-3"></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══ 页签2：付款单（原列表内容） ═══ */}
      {tab === "payments" && (
        <div className="space-y-6">
          {/* 统计卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-sm text-gray-500">付款总额（当前筛选）</div>
              <div className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(统计.总额)}</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-sm text-gray-500">有效付款单</div>
              <div className="text-xl font-bold text-gray-900 mt-1">{统计.笔数} 张</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-sm text-gray-500">已作废</div>
              <div className="text-xl font-bold text-gray-400 mt-1">{统计.作废数} 张</div>
            </div>
          </div>

          {/* 筛选栏 + 新建按钮 */}
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="搜索单号、供应商、备注..."
              className="w-full max-w-sm px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
              value={supplierFilter}
              onChange={(e) => setSupplierFilter(e.target.value)}
            >
              <option value="">全部供应商</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <select
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">全部状态</option>
              <option value="confirmed">已确认</option>
              <option value="voided">已作废</option>
            </select>
            <button
              onClick={() => {
                set付款预选("");
                setShowForm(true);
              }}
              className="ml-auto px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              新建付款
            </button>
          </div>

          {/* 列表 */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">付款单号</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">供应商</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">实付金额</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">优惠</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">支付方式</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">付款时间</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">状态</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">经办人</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">备注</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pagedRecords.map((p) => (
                    <Fragment key={p.id}>
                      <tr className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <button onClick={() => 切换展开(p)} className="text-blue-600 hover:underline font-medium">
                            {p.payment_no}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-gray-900">{p.suppliers?.name || "-"}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">{formatCurrency(p.amount)}</td>
                        <td className="px-4 py-3 text-right text-orange-600">
                          {p.discount_amount ? formatCurrency(p.discount_amount) : "-"}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{p.payment_method || "-"}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{new Date(p.paid_at).toLocaleString("zh-CN")}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-xs px-2 py-0.5 rounded ${
                              p.status === "confirmed" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-400"
                            }`}
                          >
                            {p.status === "confirmed" ? "已确认" : "已作废"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{p.profiles?.full_name || "-"}</td>
                        <td className="px-4 py-3 text-gray-500">{p.note || "-"}</td>
                        <td className="px-4 py-3 text-right">
                          {p.status === "confirmed" && (
                            <button onClick={() => 作废(p)} className="text-xs text-red-600 hover:underline">
                              作废
                            </button>
                          )}
                        </td>
                      </tr>
                      {expandedId === p.id && (
                        <tr className="bg-gray-50/60">
                          <td colSpan={10} className="px-8 py-3">
                            {detailLoading && !allocDetails[p.id] ? (
                              <span className="text-xs text-gray-400">核销明细加载中...</span>
                            ) : (allocDetails[p.id] || []).length === 0 ? (
                              <span className="text-xs text-gray-400">未核销到具体应付（全额记为预付）</span>
                            ) : (
                              <div className="text-xs text-gray-600 space-y-1">
                                <div className="font-medium text-gray-700">核销明细：</div>
                                {(allocDetails[p.id] || []).map((a) => (
                                  <div key={a.id} className="flex gap-4">
                                    <span>{a.inbound_no || a.description || a.transaction_id.slice(0, 8)}</span>
                                    <span className="text-blue-700">{formatCurrency(a.amount)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {pagedRecords.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-6 py-12 text-center text-gray-400">
                        {loading ? "加载中..." : "暂无付款单，点右上角「新建付款」开始"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={当前页 <= 1}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                上一页
              </button>
              <span className="text-sm text-gray-600 px-2">
                {当前页} / {totalPages}（共 {filtered.length} 条）
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={当前页 >= totalPages}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                下一页
              </button>
            </div>
          )}
        </div>
      )}

      {/* ═══ 页签3：收款单（批次7 新增） ═══ */}
      {tab === "receipts" && (
        <div className="space-y-4">
          <div className="text-sm text-gray-500">
            供应商退回给咱的钱（多付的货款、退货款）。收款入口：到「供应商汇总」页签，找负数（绿色）的供应商点「收款」。
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">收款单号</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">供应商</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">收款金额</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">收款方式</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">收款时间</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">状态</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">经办人</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">备注</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {receipts.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{r.receipt_no}</td>
                      <td className="px-4 py-3 text-gray-900">{r.suppliers?.name || "-"}</td>
                      <td className="px-4 py-3 text-right font-medium text-green-600">{formatCurrency(r.amount)}</td>
                      <td className="px-4 py-3 text-gray-600">{r.payment_method || "-"}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{new Date(r.received_at).toLocaleString("zh-CN")}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs px-2 py-0.5 rounded ${
                            r.status === "confirmed" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-400"
                          }`}
                        >
                          {r.status === "confirmed" ? "已确认" : "已作废"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{r.profiles?.full_name || "-"}</td>
                      <td className="px-4 py-3 text-gray-500">{r.note || "-"}</td>
                      <td className="px-4 py-3 text-right">
                        {r.status === "confirmed" && (
                          <button onClick={() => 作废收款(r)} className="text-xs text-red-600 hover:underline">
                            作废
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {receipts.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-6 py-12 text-center text-gray-400">
                        暂无收款单
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══ 页签4：退货核对（批次7：退货入账流水 vs 退货单据逐笔对金额） ═══ */}
      {tab === "returnCheck" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-gray-500">
              每笔退货入账和退货单据（采退单/退货记录）逐笔核对金额，对不上的标红。
              共 {对账统计.总数} 笔退货入账，
              {对账统计.对不上 > 0 ? (
                <b className="text-red-600">{对账统计.对不上} 笔对不上</b>
              ) : (
                <b className="text-green-600">全部对得上</b>
              )}
            </span>
            <label className="flex items-center gap-1.5 text-gray-600 cursor-pointer ml-auto">
              <input
                type="checkbox"
                checked={只看对不上}
                onChange={(e) => set只看对不上(e.target.checked)}
              />
              只看对不上的
            </label>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">入账时间</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">供应商</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">退货入账金额</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">来源单据</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">单据金额</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">差额</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-500">核对结果</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {显示对账行.map((r) => (
                    <tr key={r.流水id} className={r.核对 === "对不上" ? "bg-red-50/50" : "hover:bg-gray-50"}>
                      <td className="px-4 py-3 text-gray-500 text-xs">{new Date(r.时间).toLocaleString("zh-CN")}</td>
                      <td className="px-4 py-3 text-gray-900">{r.供应商名}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{formatCurrency(r.流水金额)}</td>
                      <td className="px-4 py-3 text-gray-600">
                        <span className="text-xs text-gray-400 mr-1">{r.单据类型}</span>
                        {r.单据标识}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900">
                        {r.单据金额 == null ? <span className="text-gray-400">算不出</span> : formatCurrency(r.单据金额)}
                      </td>
                      <td className={`px-4 py-3 text-right font-medium ${r.差额 != null && Math.abs(r.差额) > 0.005 ? "text-red-600" : "text-gray-400"}`}>
                        {r.差额 == null ? "-" : r.差额 === 0 ? "0" : formatCurrency(r.差额)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {r.核对 === "一致" && <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700">一致</span>}
                        {r.核对 === "对不上" && <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700 font-medium">对不上</span>}
                        {r.核对 === "无法核对" && <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500">无法核对</span>}
                      </td>
                    </tr>
                  ))}
                  {显示对账行.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-gray-400">
                        {只看对不上 ? "没有对不上的退货入账" : "暂无退货入账记录"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <PaymentFormModal
          suppliers={suppliers}
          paymentMethods={paymentMethods}
          预选供应商id={付款预选}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            loadPayments();
            loadSummary();
          }}
        />
      )}
      {收款目标 && (
        <ReceiptFormModal
          supplierName={收款目标.name}
          待退余额={收款目标.待退}
          paymentMethods={paymentMethods}
          onClose={() => set收款目标(null)}
          onSaved={() => {
            set收款目标(null);
            loadReceipts();
            loadSummary();
          }}
          onSubmit={(参数) => 创建供应商收款单({ supplier_id: 收款目标.id, ...参数 })}
        />
      )}
      {确认弹窗}
    </div>
  );
}

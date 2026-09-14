"use client";

import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDebounce } from "@/lib/useDebounce";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/utils";
import { useConfirm } from "@/components/ConfirmDialog";
import { 转分, 元到分, 先进先出勾稽, 核销合计分 as 计算核销合计分, type 应付勾选行 } from "@/lib/supplierPaymentAlloc";
import { 创建供应商付款单, 作废供应商付款单 } from "./actions";
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
  payment_method: string | null;
  paid_at: string;
  status: string;
  note: string | null;
  created_at: string;
  suppliers: { name: string } | null;
  profiles: { full_name: string } | null;
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
  const [method, setMethod] = useState("");
  const [paidAt, setPaidAt] = useState(() => 本地时间字符串(new Date()));
  const [note, setNote] = useState("");
  const [payables, setPayables] = useState<PayableUI[]>([]);
  const [可用额度分, set可用额度分] = useState(0);
  const [欠款分, set欠款分] = useState(0);
  const [loadingPayables, setLoadingPayables] = useState(false);
  const [saving, setSaving] = useState(false);
  /* 金额镜像：选供应商加载应付时要用最新金额做 FIFO，但不想把 amountStr 挂进 effect 依赖（每敲数字就重拉）。
     注意：ref 只能在 effect 里写（react-hooks/refs 新规），不能渲染期直接赋值 */
  const amountStrRef = useRef(amountStr);
  useEffect(() => {
    amountStrRef.current = amountStr;
  }, [amountStr]);

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
      加载应付(supplierId, 转分(amountStrRef.current));
    } else {
      setPayables([]);
      set可用额度分(0);
      set欠款分(0);
    }
  }, [supplierId, 加载应付]);

  /* 金额变化 → 基于已加载清单重新 FIFO（不重新拉接口） */
  function 金额变化(新金额: string) {
    setAmountStr(新金额);
    if (payables.length > 0) {
      setPayables(先进先出勾稽(payables, 转分(新金额), 可用额度分));
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
  const 核销合计分 = 计算核销合计分(payables);
  const 剩余预付分 = 付款分 + 可用额度分 - 核销合计分;

  async function 提交() {
    if (!supplierId) {
      toast("请选择供应商", "warning");
      return;
    }
    if (付款分 <= 0) {
      toast("请输入有效的付款金额", "warning");
      return;
    }
    /* 逐行校验：勾了就必须 0 < 金额 ≤ 未付余额 */
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
    if (核销合计分 > 付款分 + 可用额度分) {
      toast("核销合计超过可核销额度（本次付款 + 历史付款余额）", "warning");
      return;
    }

    setSaving(true);
    try {
      const res = await 创建供应商付款单({
        supplier_id: supplierId,
        amount: 付款分 / 100,
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
        加载应付(supplierId, 付款分);
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
              <label className="block text-xs text-gray-500 mb-1">付款金额 *</label>
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
                  onClick={() => setPayables(先进先出勾稽(payables, 付款分, 可用额度分))}
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

/* ═══ 主页面组件 ═══ */

export default function SupplierPaymentsContent({
  initialPayments,
  initialSuppliers,
  paymentMethods,
  预选供应商id,
  自动开单,
}: {
  initialPayments: PaymentRecord[];
  initialSuppliers: Supplier[];
  paymentMethods: PaymentMethod[];
  预选供应商id: string;
  自动开单: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { 请求确认, 确认弹窗 } = useConfirm();

  const [payments, setPayments] = useState<PaymentRecord[]>(initialPayments);
  const [suppliers] = useState<Supplier[]>(initialSuppliers);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const debouncedQuery = useDebounce(query, 300);

  const [showForm, setShowForm] = useState(自动开单);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [allocDetails, setAllocDetails] = useState<Record<string, AllocDetailRow[]>>({});
  const [detailLoading, setDetailLoading] = useState(false);

  async function loadPayments() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("supplier_payments")
      .select("*, suppliers(name), profiles(full_name)")
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
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="供应商付款单"
        description="给供应商付款并核销到具体入库单；欠款余额仍以供应商往来账为准"
        action={{ href: "/supplier-transactions", label: "往来款项" }}
      />

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
          onClick={() => setShowForm(true)}
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
                <th className="px-4 py-3 text-right font-medium text-gray-500">金额</th>
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
                      <td colSpan={9} className="px-8 py-3">
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
                  <td colSpan={9} className="px-6 py-12 text-center text-gray-400">
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

      {showForm && (
        <PaymentFormModal
          suppliers={suppliers}
          paymentMethods={paymentMethods}
          预选供应商id={预选供应商id}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            loadPayments();
          }}
        />
      )}
      {确认弹窗}
    </div>
  );
}

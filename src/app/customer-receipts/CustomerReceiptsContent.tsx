"use client";

import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDebounce } from "@/lib/useDebounce";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency } from "@/lib/utils";
import { useConfirm } from "@/components/ConfirmDialog";
import { 转分, 元到分, 先进先出勾稽, 核销合计分 as 计算核销合计分, type 应付勾选行 } from "@/lib/supplierPaymentAlloc";
import { 创建客户收款单, 作废客户收款单 } from "./actions";
import { toast } from "@/lib/globalToast";

/* ═══ 类型定义 ═══ */

interface Customer {
  id: string;
  name: string;
  phone: string | null;
}

interface PaymentMethod {
  code: string;
  name: string;
}

interface Account {
  id: string;
  name: string;
}

interface ReceiptRecord {
  id: string;
  receipt_no: string;
  customer_id: string;
  amount: number;
  payment_method: string | null;
  account_id: string;
  received_at: string;
  status: string;
  note: string | null;
  created_at: string;
  customers: { name: string; phone: string | null } | null;
  profiles: { full_name: string } | null;
  finance_accounts: { name: string } | null;
}

/* list_customer_receivables 返回的单笔应收
 * （transaction_id = 应收记录 id，对齐 supplierPaymentAlloc 勾稽函数的口径，直接复用） */
interface ReceivableRow {
  transaction_id: string;
  work_order_id: string | null;
  order_no: string | null;
  amount: number;
  paid_amount: number;
  remaining: number;
  created_at: string;
  due_date: string | null;
  notes: string | null;
}

interface ReceivablesResult {
  success: boolean;
  error?: string;
  receivables?: ReceivableRow[];
  total_remaining?: number;
}

/* 弹窗里应收行 + 用户勾选状态（勾稽纯函数来自 @/lib/supplierPaymentAlloc，有单元测试） */
type ReceivableUI = 应付勾选行<ReceivableRow>;

/* 展开的核销明细行 */
interface AllocDetailRow {
  id: string;
  amount: number;
  receivable_id: string;
  notes: string | null;
  order_no: string | null;
}

/* ═══ 工具函数（金额一律转分比较，防浮点误差） ═══ */

/* datetime-local 输入框的默认值（本地时区） */
function 本地时间字符串(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ═══ 新建收款弹窗（独立组件：放主组件外面，符合静态组件规范） ═══ */

function ReceiptFormModal({
  customers,
  accounts,
  paymentMethods,
  预选客户id,
  onClose,
  onSaved,
}: {
  customers: Customer[];
  accounts: Account[];
  paymentMethods: PaymentMethod[];
  预选客户id: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [customerId, setCustomerId] = useState(预选客户id);
  const [amountStr, setAmountStr] = useState("");
  const [accountId, setAccountId] = useState("");
  const [method, setMethod] = useState("");
  const [receivedAt, setReceivedAt] = useState(() => 本地时间字符串(new Date()));
  const [note, setNote] = useState("");
  const [receivables, setReceivables] = useState<ReceivableUI[]>([]);
  const [待收合计分, set待收合计分] = useState(0);
  const [loadingList, setLoadingList] = useState(false);
  const [saving, setSaving] = useState(false);
  /* 金额镜像：选客户加载应收时要用最新金额做 FIFO，但不想挂进 effect 依赖（每敲数字就重拉）。
     注意：ref 只能在 effect 里写（react-hooks/refs 新规），不能渲染期直接赋值 */
  const amountStrRef = useRef(amountStr);
  useEffect(() => {
    amountStrRef.current = amountStr;
  }, [amountStr]);

  /* 加载客户待收应收清单，并做 FIFO 预勾 */
  const 加载应收 = useCallback(
    async (cid: string, 收款分: number) => {
      setLoadingList(true);
      const { data, error } = await supabase.rpc("list_customer_receivables", { p_customer_id: cid });
      setLoadingList(false);
      if (error) {
        toast("加载应收清单失败: " + error.message, "error");
        return;
      }
      const 结果 = data as ReceivablesResult | null;
      if (!结果?.success) {
        toast("加载应收清单失败: " + (结果?.error || "未知错误"), "error");
        return;
      }
      const 清单 = 结果.receivables || [];
      set待收合计分(元到分(结果.total_remaining || 0));
      setReceivables(先进先出勾稽(清单, 收款分, 0));
    },
    [supabase]
  );

  /* 选客户 / 进入弹窗时加载 */
  useEffect(() => {
    if (customerId) {
      加载应收(customerId, 转分(amountStrRef.current));
    } else {
      setReceivables([]);
      set待收合计分(0);
    }
  }, [customerId, 加载应收]);

  /* 金额变化 → 基于已加载清单重新 FIFO（不重新拉接口） */
  function 金额变化(新金额: string) {
    setAmountStr(新金额);
    if (receivables.length > 0) {
      setReceivables(先进先出勾稽(receivables, 转分(新金额), 0));
    }
  }

  function 勾选行(rid: string, 勾选: boolean) {
    setReceivables((prev) =>
      prev.map((r) =>
        r.transaction_id === rid
          ? { ...r, checked: 勾选, allocStr: 勾选 ? r.remaining.toFixed(2) : "" }
          : r
      )
    );
  }

  function 改勾稽金额(rid: string, 值: string) {
    setReceivables((prev) =>
      prev.map((r) => (r.transaction_id === rid ? { ...r, allocStr: 值 } : r))
    );
  }

  const 收款分 = 转分(amountStr);
  const 核销合计分 = 计算核销合计分(receivables);
  /* 收多少销多少：核销合计必须等于收款金额 */
  const 差额分 = 收款分 - 核销合计分;

  async function 提交() {
    if (!customerId) {
      toast("请选择客户", "warning");
      return;
    }
    if (收款分 <= 0) {
      toast("收款金额必须大于 0", "warning");
      return;
    }
    if (!accountId) {
      toast("请选择收款账户（钱进到哪个账户）", "warning");
      return;
    }
    for (const r of receivables) {
      if (!r.checked) continue;
      const 勾 = 转分(r.allocStr);
      if (勾 <= 0) {
        toast(`工单 ${r.order_no || r.notes || ""} 的核销金额必须大于 0`, "warning");
        return;
      }
      if (勾 > 元到分(r.remaining)) {
        toast(`工单 ${r.order_no || r.notes || ""} 的核销金额超过未收余额`, "warning");
        return;
      }
    }
    if (核销合计分 !== 收款分) {
      toast(`核销合计与收款金额不一致（收多少销多少，还差 ${formatCurrency(Math.abs(差额分) / 100)}）`, "warning");
      return;
    }

    setSaving(true);
    try {
      const res = await 创建客户收款单({
        customer_id: customerId,
        amount: 收款分 / 100,
        account_id: accountId,
        payment_method: method || undefined,
        received_at: receivedAt ? new Date(receivedAt).toISOString() : undefined,
        note: note || undefined,
        allocations: receivables
          .filter((r) => r.checked)
          .map((r) => ({ receivable_id: r.transaction_id, amount: 转分(r.allocStr) / 100 })),
      });
      setSaving(false);
      if (!res.success) {
        toast("保存失败: " + (res.error || "未知错误"), "error");
        /* 并发超销等情况：重拉清单让用户看到最新可勾状态 */
        加载应收(customerId, 收款分);
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
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">新建收款单（客户还欠款）</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">
          {/* 基本信息 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">客户 *（只列有欠款的）</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">请选择</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.phone ? `（${c.phone}）` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">收款金额 *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                value={amountStr}
                onChange={(e) => 金额变化(e.target.value)}
                placeholder="实际收到的钱"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">收款账户 *（钱进到哪个账户）</label>
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

          {/* 客户欠款摘要 */}
          {customerId && (
            <div className="flex flex-wrap gap-4 text-sm bg-gray-50 rounded-lg px-4 py-3">
              <span className="text-gray-600">
                该客户待收合计：<b className={待收合计分 > 0 ? "text-red-600" : "text-gray-900"}>{formatCurrency(待收合计分 / 100)}</b>
              </span>
              {loadingList && <span className="text-gray-400">应收清单加载中...</span>}
            </div>
          )}

          {/* 应收清单 + 勾稽 */}
          {customerId && receivables.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-900">销到哪几笔欠款（默认从老到新自动勾）</h4>
                <button
                  type="button"
                  onClick={() => setReceivables(先进先出勾稽(receivables, 收款分, 0))}
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
                      <th className="px-3 py-2 text-left font-medium text-gray-500">产生时间</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">工单 / 说明</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">应收</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">已收</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">未收</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500 w-32">本次核销</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {receivables.map((r) => (
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
                          {r.order_no || "-"}
                          {r.notes && <span className="block text-xs text-gray-400">{r.notes}</span>}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600">{formatCurrency(r.amount)}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{formatCurrency(r.paid_amount)}</td>
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
                {差额分 !== 0 && (
                  <span className="text-red-600 text-xs">
                    核销合计必须与收款金额一致（{差额分 > 0 ? "还差" : "超出"} {formatCurrency(Math.abs(差额分) / 100)}）
                  </span>
                )}
              </div>
            </div>
          )}

          {customerId && !loadingList && receivables.length === 0 && (
            <div className="text-sm text-gray-400 bg-gray-50 rounded-lg px-4 py-6 text-center">
              该客户没有待收欠款
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
            {saving ? "保存中..." : "确认收款"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══ 主页面组件 ═══ */

export default function CustomerReceiptsContent({
  initialReceipts,
  initialCustomers,
  accounts,
  paymentMethods,
  预选客户id,
  自动开单,
}: {
  initialReceipts: ReceiptRecord[];
  initialCustomers: Customer[];
  accounts: Account[];
  paymentMethods: PaymentMethod[];
  预选客户id: string;
  自动开单: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { 请求确认, 确认弹窗 } = useConfirm();

  const [receipts, setReceipts] = useState<ReceiptRecord[]>(initialReceipts);
  const [customers, setCustomers] = useState<Customer[]>(initialCustomers);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const debouncedQuery = useDebounce(query, 300);

  const [showForm, setShowForm] = useState(自动开单);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [allocDetails, setAllocDetails] = useState<Record<string, AllocDetailRow[]>>({});
  const [detailLoading, setDetailLoading] = useState(false);

  async function loadReceipts() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setLoading(true);
    /* 收款单 + 有欠款客户下拉 一起刷新（收完款客户可能不再欠，要出下拉；别的工单结算又欠了，要进下拉） */
    const [{ data, error }, { data: 欠款行 }] = await Promise.all([
      supabase
        .from("customer_receipts")
        .select("*, customers(name, phone), profiles!customer_receipts_created_by_fkey(full_name), finance_accounts(name)")
        .order("created_at", { ascending: false })
        .limit(500),
      supabase.from("accounts_receivable").select("customer_id").in("status", ["pending", "partial"]),
    ]);
    setLoading(false);
    if (error) {
      toast("加载失败: " + error.message, "error");
      return;
    }
    setReceipts((data || []) as ReceiptRecord[]);
    const 欠款客户ids = [...new Set(((欠款行 || []) as { customer_id: string }[]).map((r) => r.customer_id))];
    if (欠款客户ids.length > 0) {
      const { data: 客户们 } = await supabase.from("customers").select("id, name, phone").in("id", 欠款客户ids).order("name");
      setCustomers((客户们 || []) as Customer[]);
    } else {
      setCustomers([]);
    }
    setAllocDetails({});
    setExpandedId(null);
  }

  /* 前端过滤（数据量小直接前端过滤） */
  const filtered = useMemo(() => {
    let list = receipts;
    if (customerFilter) list = list.filter((r) => r.customer_id === customerFilter);
    if (statusFilter) list = list.filter((r) => r.status === statusFilter);
    const sq = debouncedQuery.trim().toLowerCase();
    if (sq) {
      list = list.filter((r) => {
        const 名 = r.customers?.name || "";
        return (
          r.receipt_no.toLowerCase().includes(sq) ||
          名.toLowerCase().includes(sq) ||
          (r.note || "").toLowerCase().includes(sq)
        );
      });
    }
    return list;
  }, [receipts, customerFilter, statusFilter, debouncedQuery]);

  /* 筛选变化回第 1 页 */
  useEffect(() => {
    setPage(1);
  }, [customerFilter, statusFilter, debouncedQuery]);

  const 统计 = useMemo(() => {
    const 有效 = filtered.filter((r) => r.status === "confirmed");
    return {
      总额: 有效.reduce((s, r) => s + (r.amount || 0), 0),
      笔数: 有效.length,
      作废数: filtered.length - 有效.length,
    };
  }, [filtered]);

  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const 当前页 = Math.min(page, totalPages);
  const pagedRecords = filtered.slice((当前页 - 1) * pageSize, 当前页 * pageSize);

  /* 筛选下拉的候选客户 = 收款单里出现过的客户 + 当前有欠款的客户（并集去重） */
  const 筛选客户列表 = useMemo(() => {
    const map = new Map<string, Customer>();
    for (const c of customers) map.set(c.id, c);
    for (const r of receipts) {
      if (!map.has(r.customer_id) && r.customers) {
        map.set(r.customer_id, { id: r.customer_id, name: r.customers.name, phone: r.customers.phone });
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [customers, receipts]);

  /* 展开/收起核销明细（首次展开时拉取） */
  async function 切换展开(r: ReceiptRecord) {
    if (expandedId === r.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(r.id);
    if (allocDetails[r.id]) return;
    setDetailLoading(true);
    const { data, error } = await supabase
      .from("customer_receipt_allocations")
      .select("id, amount, receivable_id, accounts_receivable(notes, work_order_id)")
      .eq("receipt_id", r.id)
      .order("created_at");
    if (error) {
      setDetailLoading(false);
      toast("加载核销明细失败: " + error.message, "error");
      return;
    }
    interface 嵌套行 {
      id: string;
      amount: number;
      receivable_id: string;
      accounts_receivable: { notes: string | null; work_order_id: string | null } | null;
    }
    const 行们 = (data || []) as unknown as 嵌套行[];
    const 工单ids = 行们
      .map((x) => x.accounts_receivable?.work_order_id)
      .filter((v): v is string => Boolean(v));
    let 单号Map = new Map<string, string>();
    if (工单ids.length > 0) {
      const { data: 工单们 } = await supabase
        .from("work_orders")
        .select("id, order_no")
        .in("id", 工单ids);
      单号Map = new Map(((工单们 || []) as { id: string; order_no: string }[]).map((o) => [o.id, o.order_no]));
    }
    setDetailLoading(false);
    setAllocDetails((prev) => ({
      ...prev,
      [r.id]: 行们.map((x) => ({
        id: x.id,
        amount: x.amount,
        receivable_id: x.receivable_id,
        notes: x.accounts_receivable?.notes || null,
        order_no: x.accounts_receivable?.work_order_id
          ? 单号Map.get(x.accounts_receivable.work_order_id) || null
          : null,
      })),
    }));
  }

  async function 作废(r: ReceiptRecord) {
    if (
      !(await 请求确认({
        title: "作废收款单",
        message: `确定作废收款单 ${r.receipt_no}（${formatCurrency(r.amount)}）吗？\n\n作废后：核销记录删除、应收款恢复未收状态、账户余额自动扣回。`,
        confirmText: "确定作废",
      }))
    )
      return;
    const res = await 作废客户收款单(r.id);
    if (!res.success) {
      toast("作废失败: " + (res.error || "未知错误"), "error");
      return;
    }
    toast(`收款单 ${r.receipt_no} 已作废`, "success");
    loadReceipts();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="客户收款单"
        description="登记客户事后偿还的挂账/尾款，核销到具体应收记录并自动销账"
        action={{ href: "/finance/receivable", label: "应收账款" }}
      />

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">收款总额（当前筛选）</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(统计.总额)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">有效收款单</div>
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
          placeholder="搜索单号、客户、备注..."
          className="w-full max-w-sm px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          value={customerFilter}
          onChange={(e) => setCustomerFilter(e.target.value)}
        >
          <option value="">全部客户</option>
          {筛选客户列表.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
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
          新建收款
        </button>
      </div>

      {/* 列表 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">收款单号</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">客户</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">收款金额</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">支付方式</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">收款账户</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">收款时间</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">经办人</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">备注</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pagedRecords.map((r) => (
                <Fragment key={r.id}>
                  <tr className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <button onClick={() => 切换展开(r)} className="text-blue-600 hover:underline font-medium">
                        {r.receipt_no}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-900">{r.customers?.name || "-"}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">{formatCurrency(r.amount)}</td>
                    <td className="px-4 py-3 text-gray-600">{r.payment_method || "-"}</td>
                    <td className="px-4 py-3 text-gray-600">{r.finance_accounts?.name || "-"}</td>
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
                        <button onClick={() => 作废(r)} className="text-xs text-red-600 hover:underline">
                          作废
                        </button>
                      )}
                    </td>
                  </tr>
                  {expandedId === r.id && (
                    <tr className="bg-gray-50/60">
                      <td colSpan={10} className="px-8 py-3">
                        {detailLoading && !allocDetails[r.id] ? (
                          <span className="text-xs text-gray-400">核销明细加载中...</span>
                        ) : (allocDetails[r.id] || []).length === 0 ? (
                          <span className="text-xs text-gray-400">无核销明细</span>
                        ) : (
                          <div className="text-xs text-gray-600 space-y-1">
                            <div className="font-medium text-gray-700">核销明细（销到哪几笔欠款）：</div>
                            {(allocDetails[r.id] || []).map((a) => (
                              <div key={a.id} className="flex gap-4">
                                <span>{a.order_no ? `工单 ${a.order_no}` : a.notes || a.receivable_id.slice(0, 8)}</span>
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
                    {loading ? "加载中..." : "暂无收款单，点右上角「新建收款」开始"}
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
        <ReceiptFormModal
          customers={customers}
          accounts={accounts}
          paymentMethods={paymentMethods}
          预选客户id={预选客户id}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            loadReceipts();
          }}
        />
      )}
      {确认弹窗}
    </div>
  );
}

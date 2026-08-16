"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { 重置外包财务记录 } from "@/app/outsource-orders/actions";
import { useConfirm } from "./ConfirmDialog";

interface Supplier {
  id: string;
  name: string;
}

interface ExistingItem {
  id: string;
  service_item_id: string;
  service_name: string;
  amount: number;
}

interface ExistingOrder {
  id: string;
  order_no: string;
  supplier_id: string;
  total_amount: number;
  is_paid: boolean;
  payment_method?: string | null;
  notes?: string | null;
  suppliers?: { name: string } | null;
  outsource_order_items?: Array<{
    id: string;
    work_order_item_id: string;
    service_item_id: string;
    service_name: string;
    amount: number;
  }>;
}

interface Props {
  open: boolean;
  workOrderId: string;
  workOrderItemId: string;
  currentItemName: string;
  serviceItemId?: string | null;
  existingOrder?: ExistingOrder | null;
  existingItem?: ExistingItem | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function OutsourceModal({
  open,
  workOrderId,
  workOrderItemId,
  currentItemName,
  serviceItemId,
  existingOrder,
  existingItem,
  onClose,
  onSuccess,
}: Props) {
  const supabase = createClient();
  const isEditItem = !!existingItem;
  const hasExistingOrder = !!existingOrder;

  // 外包金额
  const [amount, setAmount] = useState("");

  // 供应商（订单级）
  const [supplierKeyword, setSupplierKeyword] = useState("");
  const [supplierResults, setSupplierResults] = useState<Supplier[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const supplierTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 支付信息（订单级）
  const [isPaid, setIsPaid] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("");

  // 备注（订单级）
  const [notes, setNotes] = useState("");

  const [loading, setLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const { 请求确认, 确认弹窗 } = useConfirm();

  // 初始化表单
  useEffect(() => {
    if (!open) return;

    setSupplierKeyword("");
    setSupplierResults([]);

    if (existingItem) {
      setAmount(existingItem.amount != null ? String(existingItem.amount) : "");
    } else {
      setAmount("");
    }

    if (existingOrder) {
      setSelectedSupplier({
        id: existingOrder.supplier_id,
        name: existingOrder.suppliers?.name || "",
      });
      setIsPaid(existingOrder.is_paid || false);
      setPaymentMethod(existingOrder.payment_method || "");
      setNotes(existingOrder.notes || "");
    } else {
      setSelectedSupplier(null);
      setIsPaid(false);
      setPaymentMethod("");
      setNotes("");
    }
  }, [open, existingOrder, existingItem]);

  // 搜索供应商
  function handleSupplierSearch(val: string) {
    setSupplierKeyword(val);
    if (supplierTimer.current) clearTimeout(supplierTimer.current);
    supplierTimer.current = setTimeout(async () => {
      if (!val.trim()) {
        setSupplierResults([]);
        return;
      }
      const { data } = await supabase
        .from("suppliers")
        .select("id, name")
        .ilike("name", `%${val.trim()}%`)
        .limit(20);
      setSupplierResults((data || []) as Supplier[]);
    }, 300);
  }

  /* 财务记录重置（2026-08-16 批次3 破口修复）：原客户端直写 supplier_transactions /
     accounts_payable 已被 RLS 角色化拦截，且按单号 ILIKE 模糊删有误删风险；
     现统一走 RPC 一个事务"清旧+建新"（精确匹配）。 */
  async function resetFinance(orderNo: string, supplierId: string | null, amount: number, paid: boolean) {
    const res = await 重置外包财务记录({ 单号: orderNo, 供应商id: supplierId, 金额: amount, 已付: paid });
    if (!res.success) throw new Error("财务记录更新失败: " + (res.error || "未知错误"));
  }

  async function handleSubmit() {
    // 校验
    if (!serviceItemId) {
      alert("当前项目未关联服务项目，无法创建外包单");
      return;
    }
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      alert("外包金额必须大于 0");
      return;
    }
    if (!selectedSupplier) {
      alert("请选择外包供应商");
      return;
    }
    if (isPaid && !paymentMethod) {
      alert("请选择支付方式");
      return;
    }

    // 检测供应商变更（影响整个外包单）
    if (
      hasExistingOrder &&
      existingOrder &&
      selectedSupplier.id !== existingOrder.supplier_id
    ) {
      const otherItemsCount =
        (existingOrder.outsource_order_items?.length || 0) -
        (existingItem ? 1 : 0);
      if (otherItemsCount > 0) {
        const confirmed = await 请求确认(
          `当前外包单下还有 ${otherItemsCount} 个其他项目，更换供应商将影响所有项目。确定继续吗？`
        );
        if (!confirmed) return;
      }
    }

    setLoading(true);
    try {
      let orderId: string;
      let orderNo: string;

      if (hasExistingOrder && existingOrder) {
        orderId = existingOrder.id;
        orderNo = existingOrder.order_no;

        // 更新订单级字段
        const { error: orderErr } = await supabase
          .from("outsource_orders")
          .update({
            supplier_id: selectedSupplier.id,
            is_paid: isPaid,
            payment_method: isPaid ? paymentMethod : null,
            paid_at: isPaid ? new Date().toISOString() : null,
            status: isPaid ? "settled" : "pending",
            notes: notes.trim() || null,
          })
          .eq("id", orderId);
        if (orderErr) throw new Error("更新外包单失败: " + orderErr.message);
      } else {
        // 创建新订单
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const randomStr = Math.floor(1000 + Math.random() * 9000).toString();
        orderNo = `WB-${dateStr}-${randomStr}`;

        const { data: newOrder, error: orderErr } = await supabase
          .from("outsource_orders")
          .insert({
            order_no: orderNo,
            work_order_id: workOrderId,
            supplier_id: selectedSupplier.id,
            total_amount: 0,
            is_paid: isPaid,
            payment_method: isPaid ? paymentMethod : null,
            paid_at: isPaid ? new Date().toISOString() : null,
            status: isPaid ? "settled" : "pending",
            notes: notes.trim() || null,
          })
          .select("id")
          .single();
        if (orderErr || !newOrder) throw new Error("创建外包单失败: " + (orderErr?.message || ""));
        orderId = newOrder.id;
      }

      // 写入/更新明细
      if (isEditItem && existingItem) {
        const { error: itemErr } = await supabase
          .from("outsource_order_items")
          .update({
            service_item_id: serviceItemId,
            service_name: currentItemName,
            amount: numAmount,
          })
          .eq("id", existingItem.id);
        if (itemErr) throw new Error("更新外包项目失败: " + itemErr.message);
      } else {
        const { error: itemErr } = await supabase
          .from("outsource_order_items")
          .insert({
            outsource_order_id: orderId,
            work_order_item_id: workOrderItemId,
            service_item_id: serviceItemId,
            service_name: currentItemName,
            amount: numAmount,
          });
        if (itemErr) throw new Error("添加外包项目失败: " + itemErr.message);
      }

      // 更新工单项目标记
      const { error: woErr } = await supabase
        .from("work_order_items")
        .update({
          is_outsourced: true,
          outsourced_supplier_id: selectedSupplier.id,
        })
        .eq("id", workOrderItemId);
      if (woErr) throw new Error("更新工单项目失败: " + woErr.message);

    interface OutsourceOrderItemRow {
  amount: number | string;
  work_order_item_id: string;
}

  // 重新计算订单总额
      const { data: allItems } = await supabase
        .from("outsource_order_items")
        .select("amount, work_order_item_id")
        .eq("outsource_order_id", orderId);

      const newTotal = (allItems as OutsourceOrderItemRow[] | null || []).reduce(
        (sum, it) => sum + (parseFloat(String(it.amount)) || 0),
        0
      );

      await supabase
        .from("outsource_orders")
        .update({ total_amount: newTotal })
        .eq("id", orderId);

      // 若供应商变了，需要把同订单其他项目的 outsourced_supplier_id 一起更新
      if (
        hasExistingOrder &&
        existingOrder &&
        selectedSupplier.id !== existingOrder.supplier_id
      ) {
        const otherItemIds = (allItems as OutsourceOrderItemRow[] | null || [])
          .map((it) => it.work_order_item_id)
          .filter((wid) => wid !== workOrderItemId);
        if (otherItemIds.length > 0) {
          await supabase
            .from("work_order_items")
            .update({ outsourced_supplier_id: selectedSupplier.id })
            .in("id", otherItemIds);
        }
      }

      // 重建财务记录（先删后建一个事务，金额取最新合计）
      await resetFinance(orderNo, selectedSupplier.id, newTotal, isPaid);

      setLoading(false);
      onSuccess();
    } catch (err: unknown) {
      setLoading(false);
      alert(err instanceof Error ? err.message : "操作失败");
    }
  }

  // 移除本项目（从外包单中移除当前明细行）
  async function handleRemoveItem() {
    if (!isEditItem || !existingItem || !existingOrder) return;

    const otherItemsCount =
      (existingOrder.outsource_order_items?.length || 0) - 1;
    const willDeleteOrder = otherItemsCount <= 0;
    const msg = willDeleteOrder
      ? "本项目是外包单中最后一项，移除后将同时删除外包单和相关财务记录。确定吗？"
      : `确定将本项目从外包单中移除吗？`;
    if (!(await 请求确认(msg))) return;

    setCancelLoading(true);
    try {
      // 1. 删明细
      const { error: delErr } = await supabase
        .from("outsource_order_items")
        .delete()
        .eq("id", existingItem.id);
      if (delErr) throw new Error("移除外包项目失败: " + delErr.message);

      // 2. 清理工单项目标记
      const { error: woErr } = await supabase
        .from("work_order_items")
        .update({
          is_outsourced: false,
          outsourced_supplier_id: null,
        })
        .eq("id", workOrderItemId);
      if (woErr) throw new Error("更新工单项目失败: " + woErr.message);

      if (willDeleteOrder) {
        /* 整单删除：财务记录清掉不重建（金额 0） */
        await resetFinance(existingOrder.order_no, null, 0, false);

        // 删除整个外包单
        const { error: orderErr } = await supabase
          .from("outsource_orders")
          .delete()
          .eq("id", existingOrder.id);
        if (orderErr) throw new Error("删除外包单失败: " + orderErr.message);
      } else {
        // 重新计算总额并重建财务记录（清旧+建新一个事务）
        const { data: remaining } = await supabase
          .from("outsource_order_items")
          .select("amount")
          .eq("outsource_order_id", existingOrder.id);
        const newTotal = (remaining as Array<{ amount: number | string }> | null || []).reduce(
          (sum, it) => sum + (parseFloat(String(it.amount)) || 0),
          0
        );
        await supabase
          .from("outsource_orders")
          .update({ total_amount: newTotal })
          .eq("id", existingOrder.id);
        await resetFinance(
          existingOrder.order_no,
          existingOrder.supplier_id,
          newTotal,
          existingOrder.is_paid
        );
      }

      setCancelLoading(false);
      onSuccess();
    } catch (err: unknown) {
      setCancelLoading(false);
      alert(err instanceof Error ? err.message : "操作失败");
    }
  }

  if (!open) return null;

  const otherItems = (existingOrder?.outsource_order_items || []).filter(
    (it) => it.work_order_item_id !== workOrderItemId
  );

  return (
    <div className="fixed inset-0 z-[110] flex flex-col justify-end md:flex-row md:items-center md:justify-center bg-black/50">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl md:rounded-xl md:border md:border-gray-200 md:p-6 md:w-full md:max-w-md mx-2 mb-2 md:mx-0 md:mb-0 max-h-[92vh] md:max-h-[90vh] flex flex-col animate-slide-up">
        {/* 移动端头部 */}
        <div className="md:hidden px-4 pt-4 pb-2 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">
            {hasExistingOrder ? "编辑外包单" : "创建外包单"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500"
          >
            ✕
          </button>
        </div>

        {/* PC 端标题 */}
        <h2 className="hidden md:block text-lg font-semibold text-gray-900 mb-4">
          {hasExistingOrder
            ? `编辑外包单 ${existingOrder?.order_no}`
            : "创建外包单"}
        </h2>

        <div className="flex-1 overflow-y-auto px-4 py-3 md:px-0 md:py-0 space-y-4">
          {/* 当前项目 */}
          <div className="px-3 py-2 border border-blue-200 bg-blue-50 rounded-lg">
            <div className="text-xs text-blue-500 mb-0.5">当前工单项目</div>
            <div className="text-sm font-medium text-blue-700">{currentItemName}</div>
          </div>

          {/* 外包金额 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              外包金额 <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="请输入金额"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-right"
            />
          </div>

          {/* 外包供应商 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              外包供应商 <span className="text-red-500">*</span>
            </label>
            {selectedSupplier ? (
              <div className="flex items-center justify-between px-3 py-2 border border-green-200 bg-green-50 rounded-lg">
                <span className="text-sm text-green-700">
                  {selectedSupplier.name}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedSupplier(null)}
                  className="text-xs text-gray-500 hover:text-red-600"
                >
                  重新选择
                </button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={supplierKeyword}
                  onChange={(e) => handleSupplierSearch(e.target.value)}
                  placeholder="搜索供应商..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                />
                {supplierResults.length > 0 && (
                  <div className="mt-1 border border-gray-200 rounded-lg max-h-40 overflow-y-auto">
                    {supplierResults.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setSelectedSupplier(s);
                          setSupplierKeyword("");
                          setSupplierResults([]);
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {hasExistingOrder && otherItems.length > 0 && (
              <p className="text-xs text-gray-400 mt-1">
                修改供应商将同步更新本外包单下所有项目
              </p>
            )}
          </div>

          {/* 支付状态（订单级） */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              支付状态{otherItems.length > 0 && <span className="text-xs text-gray-400 ml-1">（订单级）</span>}
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsPaid(false)}
                className={`text-xs px-3 py-1.5 rounded border ${
                  !isPaid
                    ? "bg-orange-50 text-orange-700 border-orange-200"
                    : "bg-white text-gray-600 border-gray-200"
                }`}
              >
                未支付
              </button>
              <button
                type="button"
                onClick={() => setIsPaid(true)}
                className={`text-xs px-3 py-1.5 rounded border ${
                  isPaid
                    ? "bg-green-50 text-green-700 border-green-200"
                    : "bg-white text-gray-600 border-gray-200"
                }`}
              >
                已支付
              </button>
            </div>
          </div>

          {/* 支付方式 */}
          {isPaid && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                支付方式 <span className="text-red-500">*</span>
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
              >
                <option value="">请选择</option>
                <option value="cash">现金</option>
                <option value="wechat">微信支付</option>
                <option value="alipay">支付宝</option>
                <option value="bank_transfer">银行转账</option>
              </select>
            </div>
          )}

          {/* 备注 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              备注{otherItems.length > 0 && <span className="text-xs text-gray-400 ml-1">（订单级）</span>}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="输入备注（可选）"
              rows={2}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none"
            />
          </div>
        </div>

        <div className="shrink-0 px-4 py-3 md:px-0 md:py-0 md:mt-6 border-t border-gray-100 md:border-0 flex justify-between gap-2">
          {isEditItem && (
            <button
              type="button"
              onClick={handleRemoveItem}
              disabled={cancelLoading || loading}
              className="px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
            >
              {cancelLoading ? "处理中..." : "移除本项目"}
            </button>
          )}
          <div className="flex gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              disabled={loading || cancelLoading}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              关闭
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading || cancelLoading}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "保存中..." : "确定"}
            </button>
          </div>
        </div>
        {确认弹窗}
      </div>
    </div>
  );
}

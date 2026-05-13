"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

interface ServiceItem {
  id: string;
  name: string;
  code?: string | null;
}

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
  existingOrder,
  existingItem,
  onClose,
  onSuccess,
}: Props) {
  const supabase = createClient();
  const isEditItem = !!existingItem;
  const hasExistingOrder = !!existingOrder;

  // 外包项目（必须从搜索选择）
  const [selectedServiceItem, setSelectedServiceItem] = useState<ServiceItem | null>(null);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchResults, setSearchResults] = useState<ServiceItem[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // 初始化表单
  useEffect(() => {
    if (!open) return;

    setSearchKeyword("");
    setSearchResults([]);
    setSupplierKeyword("");
    setSupplierResults([]);

    if (existingItem) {
      setSelectedServiceItem({
        id: existingItem.service_item_id,
        name: existingItem.service_name,
      });
      setAmount(existingItem.amount != null ? String(existingItem.amount) : "");
    } else {
      setSelectedServiceItem(null);
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

  // 搜索服务项目
  function handleSearchChange(val: string) {
    setSearchKeyword(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      if (!val.trim()) {
        setSearchResults([]);
        return;
      }
      setSearching(true);
      const { data } = await supabase
        .from("service_items")
        .select("id, name, code")
        .ilike("name", `%${val.trim()}%`)
        .limit(20);
      setSearchResults((data || []) as ServiceItem[]);
      setSearching(false);
    }, 300);
  }

  function handleSelectServiceItem(si: ServiceItem) {
    setSelectedServiceItem(si);
    setSearchKeyword("");
    setSearchResults([]);
  }

  function handleClearServiceItem() {
    setSelectedServiceItem(null);
  }

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

  // 清除旧的财务记录（按订单号匹配）
  async function clearFinanceRecords(orderNo: string) {
    await supabase
      .from("supplier_transactions")
      .delete()
      .ilike("description", `%${orderNo}%`);
    await supabase
      .from("accounts_payable")
      .delete()
      .ilike("notes", `%${orderNo}%`);
  }

  // 生成新的财务记录
  async function createFinanceRecords(
    orderNo: string,
    supplierId: string,
    totalAmount: number,
    paid: boolean,
    method: string
  ) {
    if (paid) {
      const { error } = await supabase.from("supplier_transactions").insert({
        supplier_id: supplierId,
        transaction_type: "payment",
        amount: totalAmount,
        description: `外包服务单 ${orderNo}`,
      });
      if (error) throw new Error("生成付款记录失败: " + error.message);
    } else {
      const { error } = await supabase.from("accounts_payable").insert({
        supplier_id: supplierId,
        amount: totalAmount,
        paid_amount: 0,
        status: "pending",
        notes: `外包服务单 ${orderNo}`,
      });
      if (error) throw new Error("生成应付账款失败: " + error.message);
    }
  }

  async function handleSubmit() {
    // 校验
    if (!selectedServiceItem) {
      alert("请从搜索结果中选择外包项目");
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
        const confirmed = confirm(
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
            service_item_id: selectedServiceItem.id,
            service_name: selectedServiceItem.name,
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
            service_item_id: selectedServiceItem.id,
            service_name: selectedServiceItem.name,
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

      // 重新计算订单总额
      const { data: allItems } = await supabase
        .from("outsource_order_items")
        .select("amount, work_order_item_id")
        .eq("outsource_order_id", orderId);

      const newTotal = (allItems || []).reduce(
        (sum, it: any) => sum + (parseFloat(it.amount) || 0),
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
        const otherItemIds = (allItems || [])
          .map((it: any) => it.work_order_item_id)
          .filter((wid: string) => wid !== workOrderItemId);
        if (otherItemIds.length > 0) {
          await supabase
            .from("work_order_items")
            .update({ outsourced_supplier_id: selectedSupplier.id })
            .in("id", otherItemIds);
        }
      }

      // 重建财务记录（先删后建，金额取最新合计）
      await clearFinanceRecords(orderNo);
      await createFinanceRecords(orderNo, selectedSupplier.id, newTotal, isPaid, paymentMethod);

      setLoading(false);
      onSuccess();
    } catch (err: any) {
      setLoading(false);
      alert(err.message);
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
    if (!confirm(msg)) return;

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

      // 3. 清理旧财务记录
      await clearFinanceRecords(existingOrder.order_no);

      if (willDeleteOrder) {
        // 删除整个外包单
        const { error: orderErr } = await supabase
          .from("outsource_orders")
          .delete()
          .eq("id", existingOrder.id);
        if (orderErr) throw new Error("删除外包单失败: " + orderErr.message);
      } else {
        // 重新计算总额并重建财务记录
        const { data: remaining } = await supabase
          .from("outsource_order_items")
          .select("amount")
          .eq("outsource_order_id", existingOrder.id);
        const newTotal = (remaining || []).reduce(
          (sum, it: any) => sum + (parseFloat(it.amount) || 0),
          0
        );
        await supabase
          .from("outsource_orders")
          .update({ total_amount: newTotal })
          .eq("id", existingOrder.id);
        if (newTotal > 0) {
          await createFinanceRecords(
            existingOrder.order_no,
            existingOrder.supplier_id,
            newTotal,
            existingOrder.is_paid,
            existingOrder.payment_method || ""
          );
        }
      }

      setCancelLoading(false);
      onSuccess();
    } catch (err: any) {
      setCancelLoading(false);
      alert(err.message);
    }
  }

  if (!open) return null;

  const otherItems = (existingOrder?.outsource_order_items || []).filter(
    (it) => it.work_order_item_id !== workOrderItemId
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          {hasExistingOrder
            ? `编辑外包单 ${existingOrder?.order_no}`
            : "创建外包单"}
        </h2>

        <div className="space-y-4">
          {/* 当前项目 */}
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500">当前工单项目</p>
            <p className="text-sm font-medium text-gray-900">{currentItemName}</p>
          </div>

          {/* 同外包单的其他项目（提示） */}
          {otherItems.length > 0 && (
            <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
              <p className="text-xs text-blue-700 mb-1">
                本外包单已包含 {otherItems.length} 个其他项目：
              </p>
              <ul className="text-xs text-blue-600 list-disc pl-4 space-y-0.5">
                {otherItems.map((it) => (
                  <li key={it.id}>
                    {it.service_name} · ¥{it.amount}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 外包项目（必须从搜索选取） */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              外包项目 <span className="text-red-500">*</span>
            </label>
            {selectedServiceItem ? (
              <div className="flex items-center justify-between px-3 py-2 border border-green-200 bg-green-50 rounded-lg">
                <span className="text-sm text-green-700">
                  {selectedServiceItem.name}
                </span>
                <button
                  type="button"
                  onClick={handleClearServiceItem}
                  className="text-xs text-gray-500 hover:text-red-600"
                >
                  重新选择
                </button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={searchKeyword}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="搜索服务项目名称..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                />
                {searching && (
                  <p className="text-xs text-gray-400 mt-1">搜索中...</p>
                )}
                {searchResults.length > 0 && (
                  <div className="mt-1 border border-gray-200 rounded-lg max-h-40 overflow-y-auto">
                    {searchResults.map((si) => (
                      <button
                        key={si.id}
                        type="button"
                        onClick={() => handleSelectServiceItem(si)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                      >
                        <span className="font-medium">{si.name}</span>
                        {si.code && (
                          <span className="text-xs text-gray-400 ml-2">
                            {si.code}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {!searching &&
                  searchKeyword.trim() &&
                  searchResults.length === 0 && (
                    <p className="text-xs text-gray-400 mt-1">未找到匹配的服务项目</p>
                  )}
              </>
            )}
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

        <div className="flex justify-between gap-2 mt-6">
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
      </div>
    </div>
  );
}

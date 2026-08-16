"use client";

import {useState, useEffect, useCallback, useMemo} from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { PriceValue } from "@/components/PriceVisibilityContext";
import { 部分收货登记, 撤销作废采购单 } from "@/app/procurement/actions";

const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  submitted: "已提交",
  approved: "已审批",
  partial_received: "部分收货",
  fully_received: "全部收货",
  pending_storage: "待入库",
  completed: "已完成",
  cancelled: "已取消",
};

const STATUS_CLASS: Record<string, string> = {
  draft: "bg-gray-50 text-gray-600",
  submitted: "bg-blue-50 text-blue-700",
  approved: "bg-purple-50 text-purple-700",
  partial_received: "bg-yellow-50 text-yellow-700",
  fully_received: "bg-green-50 text-green-700",
  pending_storage: "bg-indigo-50 text-indigo-700",
  completed: "bg-green-50 text-green-700",
  cancelled: "bg-red-50 text-red-600",
};

interface Supplier {
  name?: string | null;
}

interface PurchaseOrder {
  id: string;
  order_no?: string | null;
  status: string;
  supplier_id?: string | null;
  total_amount?: number | null;
  created_at: string;
  notes?: string | null;
  suppliers?: Supplier | null;
}

interface PurchaseOrderItem {
  id: string;
  name: string;
  part_number?: string | null;
  brand?: string | null;
  specification?: string | null;
  quantity: number;
  unit_cost?: number | null;
  received_qty?: number | null;
  part_id?: string | null;
  work_order_item_part_id?: string | null;
  parts?: {
    id?: string;
    quantity?: number | null;
  } | null;
  work_order_item_parts?: {
    id?: string;
    is_arrived?: boolean | null;
  } | null;
}

/* 收货后库存不再在此页直接增加:统一由「采购管理 → 待入库 → 确认入库」完成 */

export default function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = useMemo(() => createClient(), []);
  const [orderId, setOrderId] = useState("");
  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [items, setItems] = useState<PurchaseOrderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [receiveForm, setReceiveForm] = useState<Record<string, string>>({});
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    params.then((p) => setOrderId(p.id));
  }, [params]);

  const fetchOrder = useCallback(async () => {
    if (!orderId) return;
    const { data: orderData } = await supabase
      .from("purchase_orders")
      .select("*, suppliers(*)")
      .eq("id", orderId)
      .single();
    setOrder(orderData);

    const { data: itemsData } = await supabase
      .from("purchase_order_items")
      .select("*, parts(id, quantity), work_order_item_parts(id, is_arrived)")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });
    setItems(itemsData || []);
  }, [orderId, supabase]);

  useEffect(() => {
    if (!orderId) return;
    fetchOrder();
  }, [fetchOrder, orderId]);

  function canReceive() {
    return order && ["submitted", "approved", "partial_received"].includes(order.status);
  }

  /* 撤销/作废整单（2026-08-17）：仅未收货(submitted)可操作；
     撤销=配件回待采购，作废=配件不回，单据都留档(cancelled) */
  async function handleCancelOrder(mode: "revoke" | "void") {
    if (!order) return;
    const 文案 = mode === "revoke"
      ? "撤销整单：该采购单将作废留档，明细配件【退回】待采购列表，是否继续？"
      : "作废整单：该采购单将作废留档，明细配件【不】退回待采购，是否继续？";
    if (!confirm(文案)) return;
    setCancelling(true);
    try {
      const res = await 撤销作废采购单(order.id, mode);
      if (!res.success) throw new Error(res.error || "操作失败");
      fetchOrder();
    } catch (err: unknown) {
      alert((mode === "revoke" ? "撤销失败: " : "作废失败: ") + (err instanceof Error ? err.message : String(err)));
    } finally {
      setCancelling(false);
    }
  }

  async function handleReceiveItem(itemId: string) {
    const qty = parseInt(receiveForm[itemId] || "0");
    if (qty <= 0) {
      alert("请输入有效的收货数量");
      return;
    }

    const item = items.find((i) => i.id === itemId);
    /* 收货按钮只在订单加载完成后渲染，此处 order 必存在 */
    if (!item || !order) return;

    const remainingToReceive = item.quantity - (item.received_qty || 0);
    if (qty > remainingToReceive) {
      alert(`该 item 最多还能收 ${remainingToReceive} 件`);
      return;
    }

    setLoading(true);

    try {
      /* 收货统一走待入库流程(B 路):这里只原子累加实收数量并推进状态,
         不再直接加库存——库存、批次、流水、应付款由「待入库→确认入库」
         (数据库事务函数 complete_purchase_inbound)一次性完成,保证账实一致 */
      const res = await 部分收货登记(orderId, itemId, qty);
      if (!res.success) throw new Error(res.error || "收货失败");

      setReceiveForm((prev) => ({ ...prev, [itemId]: "" }));
      fetchOrder();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("收货失败: " + msg);
    } finally {
      setLoading(false);
    }
  }

  if (!order) {
    return (
      <div>
        <PageHeader title="采购订单详情" />
        <div className="text-center text-gray-400 py-12">加载中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`采购订单 ${order.order_no || orderId.slice(0, 8)}`}
        action={{ href: "/procurement", label: "返回列表" }}
      />

      {/* 订单信息 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-gray-500 text-xs">供应商</div>
            <div className="font-medium text-gray-900">{order.suppliers?.name || "-"}</div>
          </div>
          <div>
            <div className="text-gray-500 text-xs">状态</div>
            <div>
              <span className={`text-xs px-2 py-0.5 rounded ${STATUS_CLASS[order.status]}`}>
                {STATUS_LABELS[order.status] || order.status}
              </span>
            </div>
          </div>
          <div>
            <div className="text-gray-500 text-xs">总金额</div>
            <div className="font-medium text-gray-900">
              {order.total_amount != null ? `¥${order.total_amount.toFixed(2)}` : "-"}
            </div>
          </div>
          <div>
            <div className="text-gray-500 text-xs">创建时间</div>
            <div className="font-medium text-gray-900">{new Date(order.created_at).toLocaleDateString()}</div>
          </div>
          {order.notes && (
            <div className="col-span-2 sm:col-span-4">
              <div className="text-gray-500 text-xs">备注</div>
              <div className="text-gray-700">{order.notes}</div>
            </div>
          )}
        </div>
      </div>

      {/* 采购项目 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">采购项目</h3>
          <div className="flex items-center gap-3">
            {canReceive() && (
              <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                可收货 · 收满后请前往「采购管理 → 待入库」确认入库;破损/错发请在待收货列表处理
              </span>
            )}
            {order.status === "submitted" && (
              <>
                <button
                  type="button"
                  disabled={cancelling}
                  onClick={() => handleCancelOrder("revoke")}
                  className="text-xs text-amber-600 hover:text-amber-700 hover:underline disabled:opacity-50"
                >
                  撤销整单
                </button>
                <button
                  type="button"
                  disabled={cancelling}
                  onClick={() => handleCancelOrder("void")}
                  className="text-xs text-red-400 hover:text-red-600 hover:underline disabled:opacity-50"
                >
                  作废整单
                </button>
              </>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">配件</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">品牌/规格</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">数量</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">单价</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">已收/总计</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
                {canReceive() && <th className="px-6 py-3 text-left font-medium text-gray-500">收货</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item: PurchaseOrderItem) => {
                const isFullyReceived = (item.received_qty || 0) >= item.quantity;
                const canReceiveItem = canReceive() && !isFullyReceived;
                return (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{item.name}</div>
                      <div className="text-xs text-gray-500">{item.part_number || "-"}</div>
                      {item.work_order_item_parts?.id && (
                        <div className="text-xs text-orange-600 mt-0.5">关联工单</div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      <div>{item.brand || "-"}</div>
                      <div className="text-xs text-gray-400">{item.specification || "-"}</div>
                    </td>
                    <td className="px-6 py-4 text-gray-900">{item.quantity}</td>
                    <td className="px-6 py-4 text-gray-600">
                      {item.unit_cost != null ? <PriceValue value={item.unit_cost} /> : "-"}
                    </td>
                    <td className="px-6 py-4 text-gray-900">
                      {item.received_qty || 0} / {item.quantity}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          isFullyReceived
                            ? "bg-green-50 text-green-700"
                            : (item.received_qty || 0) > 0
                            ? "bg-yellow-50 text-yellow-700"
                            : "bg-gray-50 text-gray-500"
                        }`}
                      >
                        {isFullyReceived ? "已收齐" : (item.received_qty || 0) > 0 ? "部分收货" : "待收货"}
                      </span>
                    </td>
                    {canReceive() && (
                      <td className="px-6 py-4">
                        {canReceiveItem && item.part_id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="1"
                              max={item.quantity - (item.received_qty || 0)}
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                              placeholder="数量"
                              value={receiveForm[item.id] || ""}
                              onChange={(e) =>
                                setReceiveForm((prev) => ({ ...prev, [item.id]: e.target.value }))
                              }
                            />
                            <button
                              type="button"
                              disabled={loading}
                              onClick={() => handleReceiveItem(item.id)}
                              className="px-2 py-1 text-xs text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50"
                            >
                              收货
                            </button>
                          </div>
                        ) : canReceiveItem && !item.part_id ? (
                          <span className="text-xs text-orange-600">新配件，请去入库登记</span>
                        ) : (
                          <span className="text-xs text-gray-400">-</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr>
                  <td colSpan={canReceive() ? 7 : 6} className="px-6 py-8 text-center text-gray-400">
                    暂无采购项目
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  submitted: "已提交",
  approved: "已审批",
  partial_received: "部分收货",
  fully_received: "全部收货",
  cancelled: "已取消",
};

const STATUS_CLASS: Record<string, string> = {
  draft: "bg-gray-50 text-gray-600",
  submitted: "bg-blue-50 text-blue-700",
  approved: "bg-purple-50 text-purple-700",
  partial_received: "bg-yellow-50 text-yellow-700",
  fully_received: "bg-green-50 text-green-700",
  cancelled: "bg-red-50 text-red-600",
};

export default function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const supabase = createClient();
  const [orderId, setOrderId] = useState("");
  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [receiveForm, setReceiveForm] = useState<Record<string, string>>({});

  useEffect(() => {
    params.then((p) => setOrderId(p.id));
  }, [params]);

  useEffect(() => {
    if (!orderId) return;
    fetchOrder();
  }, [orderId]);

  async function fetchOrder() {
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
  }

  function allReceived() {
    return items.every((item) => item.received_qty >= item.quantity);
  }

  function canReceive() {
    return order && ["submitted", "approved", "partial_received"].includes(order.status);
  }

  async function handleReceiveItem(itemId: string) {
    const qty = parseInt(receiveForm[itemId] || "0");
    if (qty <= 0) {
      alert("请输入有效的收货数量");
      return;
    }

    const item = items.find((i) => i.id === itemId);
    if (!item) return;

    const remainingToReceive = item.quantity - (item.received_qty || 0);
    if (qty > remainingToReceive) {
      alert(`该 item 最多还能收 ${remainingToReceive} 件`);
      return;
    }

    setLoading(true);

    try {
      // 1. 更新采购订单项的 received_qty
      const newReceivedQty = (item.received_qty || 0) + qty;
      const { error: updateError } = await supabase
        .from("purchase_order_items")
        .update({ received_qty: newReceivedQty })
        .eq("id", itemId);

      if (updateError) throw updateError;

      // 2. 入库处理
      let partId = item.part_id;
      const unitCost = item.unit_cost || 0;

      if (partId) {
        // 现有配件入库
        const beforeQty = item.parts?.quantity || 0;
        const afterQty = beforeQty + qty;

        await supabase.from("parts").update({ quantity: afterQty }).eq("id", partId);

        await supabase.from("part_batches").insert({
          part_id: partId,
          quantity: qty,
          remaining: qty,
          unit_cost: unitCost,
          supplier_id: order.supplier_id,
        });

        await supabase.from("inventory_logs").insert({
          part_id: partId,
          change_type: "in",
          quantity: qty,
          before_qty: beforeQty,
          after_qty: afterQty,
          notes: `采购入库: 订单 ${order.order_no || orderId.slice(0, 8)}`,
        });
      }

      // 3. 如果有关联的工单配件分支，标记为已到货
      if (item.work_order_item_part_id) {
        await supabase
          .from("work_order_item_parts")
          .update({ is_arrived: true })
          .eq("id", item.work_order_item_part_id);
      }

      // 4. 更新采购订单状态
      const { data: updatedItems } = await supabase
        .from("purchase_order_items")
        .select("quantity, received_qty")
        .eq("order_id", orderId);

      const allDone = updatedItems?.every((i: any) => (i.received_qty || 0) >= i.quantity);
      const anyReceived = updatedItems?.some((i: any) => (i.received_qty || 0) > 0);

      let newStatus = order.status;
      if (allDone) {
        newStatus = "fully_received";
      } else if (anyReceived) {
        newStatus = "partial_received";
      }

      if (newStatus !== order.status) {
        await supabase.from("purchase_orders").update({ status: newStatus }).eq("id", orderId);
      }

      setReceiveForm((prev) => ({ ...prev, [itemId]: "" }));
      fetchOrder();
    } catch (err: any) {
      alert("收货失败: " + err.message);
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
          {canReceive() && (
            <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">可收货</span>
          )}
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
              {items.map((item: any) => {
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
                      {item.unit_cost != null ? `¥${item.unit_cost.toFixed(2)}` : "-"}
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

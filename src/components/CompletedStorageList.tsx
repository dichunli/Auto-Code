"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PriceValue } from "@/components/PriceVisibilityContext";

interface PurchaseOrderItem {
  id: string;
  name: string;
  brand: string | null;
  specification: string | null;
  quantity: number;
  unit_cost: number | null;
  received_qty: number | null;
  part_id: string | null;
  work_order_item_part_id: string | null;
  part_number: string | null;
  supplier_part_name: string | null;
  unit: string | null;
  category: string | null;
  license_plate: string | null;
  photos: string[] | null;
  notes: string | null;
}

interface InboundOrder {
  id: string;
  inbound_no: string;
  total_quantity: number;
  total_amount: number | null;
  created_at: string;
}

interface PurchaseOrder {
  id: string;
  order_no: string | null;
  supplier_id: string | null;
  status: string;
  total_amount: number | null;
  notes: string | null;
  created_at: string;
  suppliers: { id: string; name: string } | null;
  purchase_order_items: PurchaseOrderItem[];
  inbound_orders: InboundOrder[] | null;
}

export function CompletedStorageList() {
  const supabase = createClient();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    const { data, error } = await supabase
      .from("purchase_orders")
      .select(
        `
        id, order_no, supplier_id, status, total_amount, notes, created_at,
        suppliers(id, name),
        purchase_order_items(
          id, name, brand, specification, quantity, unit_cost, received_qty,
          part_id, work_order_item_part_id, part_number, supplier_part_name,
          unit, category, license_plate, photos, notes
        ),
        inbound_orders(id, inbound_no, total_quantity, total_amount, created_at)
      `
      )
      .eq("status", "completed")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("加载已入库采购单失败:", error);
      setLoading(false);
      return;
    }

    setOrders((data || []) as unknown as PurchaseOrder[]);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRevokeCompleted(orderId: string) {
    setSubmitting(`revoke-${orderId}`);
    try {
      /* 1. 查询关联的入库单 */
      const { data: inboundOrderList } = await supabase
        .from("inbound_orders")
        .select("id, inbound_no")
        .eq("purchase_order_id", orderId);
      const inboundIds = inboundOrderList?.map((o) => o.id) || [];

      const { data: inboundItemList } = await supabase
        .from("inbound_order_items")
        .select("id, part_id, quantity, warehouse_id, location")
        .in("inbound_order_id", inboundIds);

      /* 2. 查询关联的待退货记录 */
      const { data: poiList } = await supabase
        .from("purchase_order_items")
        .select("work_order_item_part_id")
        .eq("order_id", orderId);
      const workOrderItemPartIds = (poiList || [])
        .map((p: any) => p.work_order_item_part_id)
        .filter(Boolean);

      let returnRecords: any[] = [];
      if (workOrderItemPartIds.length > 0) {
        const { data: retList } = await supabase
          .from("supplier_return_records")
          .select("id, return_reason, quantity")
          .in("work_order_item_part_id", workOrderItemPartIds)
          .eq("status", "pending");
        returnRecords = retList || [];
      }

      /* 3. 组装提示信息 */
      const inboundCount = inboundOrderList?.length || 0;
      const returnCount = returnRecords.length;
      const parts: string[] = [];
      if (inboundCount > 0) {
        parts.push(`入库单 ${inboundOrderList!.map((o) => o.inbound_no).join("、")}`);
      }
      if (returnCount > 0) {
        parts.push(`${returnCount} 条待退货记录`);
      }
      const msg =
        parts.length > 0
          ? `该采购单已生成 ${parts.join(" 和 ")}，撤销将同时删除这些数据并回退库存，是否继续？`
          : "确认退回待收货？这将清空所有处理结果。";
      if (!confirm(msg)) {
        setSubmitting(null);
        return;
      }

      /* 4. 扣减总库存 */
      for (const it of inboundItemList || []) {
        if (!it.part_id || !it.quantity) continue;
        const { data: part } = await supabase
          .from("parts")
          .select("quantity")
          .eq("id", it.part_id)
          .single();
        if (part) {
          const newQty = Math.max(0, (part.quantity || 0) - it.quantity);
          const { error: stockErr } = await supabase
            .from("parts")
            .update({ quantity: newQty })
            .eq("id", it.part_id);
          if (stockErr) console.error(`回退库存失败(${it.part_id}):`, stockErr);
        }
      }

      /* 5. 扣减仓位库存 */
      for (const it of inboundItemList || []) {
        if (!it.part_id || !it.quantity || !it.warehouse_id) continue;
        const { data: loc } = await supabase
          .from("part_stock_locations")
          .select("id, quantity")
          .eq("part_id", it.part_id)
          .eq("warehouse_id", it.warehouse_id)
          .eq("location", it.location || "")
          .single();
        if (loc) {
          const newQty = Math.max(0, loc.quantity - it.quantity);
          const { error: locErr } = await supabase
            .from("part_stock_locations")
            .update({ quantity: newQty })
            .eq("id", loc.id);
          if (locErr) console.error(`回退仓位库存失败(${it.part_id}):`, locErr);
        }
      }

      /* 6. 删除入库单明细和入库单 */
      if (inboundIds.length > 0) {
        await supabase.from("inbound_order_items").delete().in("inbound_order_id", inboundIds);
        await supabase.from("inbound_orders").delete().in("id", inboundIds);
      }

      /* 7. 删除待退货记录 */
      if (returnRecords.length > 0) {
        await supabase
          .from("supplier_return_records")
          .delete()
          .in(
            "id",
            returnRecords.map((r) => r.id)
          );
      }

      /* 8. 删除批次记录和库存日志 */
      await supabase
        .from("part_batches")
        .delete()
        .eq("reference_id", orderId)
        .eq("inbound_type", "purchase");
      if (inboundIds.length > 0) {
        await supabase
          .from("inventory_logs")
          .delete()
          .eq("reference_type", "inbound_order")
          .in("reference_id", inboundIds);
      }

      /* 9. 删除关联的应付账款记录 */
      if (inboundIds.length > 0) {
        await supabase
          .from("supplier_transactions")
          .delete()
          .eq("reference_type", "inbound_order")
          .in("reference_id", inboundIds);
      }

      /* 10. 清空采购明细处理结果 */
      await supabase
        .from("purchase_order_items")
        .update({
          handle_action: null,
          received_qty: null,
          discount_amount: null,
          evidence_photos: null,
        })
        .eq("order_id", orderId);

      /* 10. 订单状态改回 submitted（待收货） */
      const { error: stErr } = await supabase
        .from("purchase_orders")
        .update({ status: "submitted" })
        .eq("id", orderId);
      if (stErr) throw stErr;

      loadData();
    } catch (err: any) {
      alert("退回失败: " + (err.message || String(err)));
    } finally {
      setSubmitting(null);
    }
  }

  const displayGroups = useMemo(() => {
    const map = new Map<string, PurchaseOrder[]>();
    for (const o of orders) {
      const key = o.suppliers?.name || "未指定供应商";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(o);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, "zh"))
      .map(([key, list]) => ({ key, orders: list }));
  }, [orders]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
        加载中...
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
        暂无已入库的采购单
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {displayGroups.map((g) => (
        <div key={g.key} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">供应商: {g.key}</h3>
              <span className="text-xs text-gray-500">共 {g.orders.length} 张采购单</span>
            </div>
          </div>

          <div className="divide-y divide-gray-100">
            {g.orders.map((order) => (
              <div key={order.id} className="px-6 py-4">
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  <Link
                    href={`/procurement/${order.id}`}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                  >
                    {order.order_no || order.id.slice(0, 8)}
                  </Link>
                  <span className="text-xs text-gray-500">
                    {new Date(order.created_at).toLocaleDateString()}
                  </span>
                  <span className="text-xs text-gray-500">
                    {order.purchase_order_items.length} 项 · <PriceValue value={order.total_amount} />
                  </span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-green-50 text-green-700">
                    已入库
                  </span>
                  {order.inbound_orders && order.inbound_orders.length > 0 ? (
                    order.inbound_orders.map((io) => (
                      <Link
                        key={io.id}
                        href={`/inbound-orders/${io.id}`}
                        className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600 hover:text-blue-700"
                      >
                        入库单:{io.inbound_no}
                      </Link>
                    ))
                  ) : (
                    <span className="text-xs text-gray-400">暂无入库单</span>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm border border-gray-100 rounded-lg">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-500 w-10">序号</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">零件编码</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">商品名称</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">单据名称</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-500 w-14">数量</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500 w-12">单位</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">分类</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">车牌</th>
                        <th className="px-3 py-2 text-center font-medium text-gray-500 w-32">到货数量</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {order.purchase_order_items.map((item, idx) => (
                        <tr key={item.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-gray-500">{idx + 1}</td>
                          <td className="px-3 py-2 text-gray-700">{item.part_number || "-"}</td>
                          <td className="px-3 py-2">
                            <div className="text-gray-900 font-medium">{item.name}</div>
                            {item.brand || item.specification ? (
                              <div className="text-xs text-gray-400">
                                {item.brand || ""} {item.specification || ""}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-gray-700">{item.supplier_part_name || "-"}</td>
                          <td className="px-3 py-2 text-right text-gray-700">{item.quantity}</td>
                          <td className="px-3 py-2 text-gray-500">{item.unit || "-"}</td>
                          <td className="px-3 py-2 text-gray-500">{item.category || "-"}</td>
                          <td className="px-3 py-2 text-gray-500">{item.license_plate || "-"}</td>
                          <td className="px-3 py-2 text-center">
                            <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700">
                              {item.received_qty || 0} / {item.quantity}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleRevokeCompleted(order.id)}
                    disabled={submitting === `revoke-${order.id}`}
                    className="px-3 py-1.5 border border-orange-200 text-orange-600 bg-orange-50 text-sm font-medium rounded-lg hover:bg-orange-100 transition-colors disabled:opacity-50"
                  >
                    {submitting === `revoke-${order.id}` ? "处理中..." : "退回待入库"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

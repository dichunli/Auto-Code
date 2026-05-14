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
}

export function PendingStorageList() {
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
        )
      `
      )
      .eq("status", "pending_storage")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("加载待入库采购单失败:", error);
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

  async function handleCompleteStorage(orderId: string) {
    if (!confirm("确认已完成入库？")) return;
    setSubmitting(`complete-${orderId}`);
    try {
      const { error } = await supabase
        .from("purchase_orders")
        .update({ status: "completed" })
        .eq("id", orderId);
      if (error) {
        alert("操作失败: " + error.message);
        return;
      }
      loadData();
    } catch (err: any) {
      alert("操作失败: " + (err.message || String(err)));
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
        暂无待入库的采购单
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
                  <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">
                    待入库
                  </span>
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
                        <th className="px-3 py-2 text-left font-medium text-gray-500">备注</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500 w-16">图片</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">车牌</th>
                        <th className="px-3 py-2 text-center font-medium text-gray-500 w-32">到货数量</th>
                        <th className="px-3 py-2 text-center font-medium text-gray-500 w-28">操作</th>
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
                          <td className="px-3 py-2 text-gray-500">{item.notes || "-"}</td>
                          <td className="px-3 py-2">
                            {item.photos && item.photos.length > 0 ? (
                              <div className="flex gap-1">
                                {item.photos.slice(0, 2).map((url, i) => (
                                  <img
                                    key={i}
                                    src={url}
                                    alt=""
                                    className="w-8 h-8 rounded object-cover border border-gray-200"
                                  />
                                ))}
                              </div>
                            ) : (
                              <span className="text-gray-300">-</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-500">{item.license_plate || "-"}</td>
                          <td className="px-3 py-2 text-center">
                            <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700">
                              {item.received_qty || 0} / {item.quantity}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            {item.part_id ? (
                              <Link
                                href={`/inventory/in?auto_fill=1&part_id=${encodeURIComponent(item.part_id)}&quantity=${encodeURIComponent(item.received_qty || item.quantity)}`}
                                className="text-xs px-2 py-1 rounded bg-orange-50 text-orange-600 hover:bg-orange-100 inline-block"
                              >
                                入库登记
                              </Link>
                            ) : (
                              <Link
                                href={`/inventory/in?auto_fill=1&name=${encodeURIComponent(item.name)}&part_number=${encodeURIComponent(item.part_number || "")}&brand=${encodeURIComponent(item.brand || "")}&specification=${encodeURIComponent(item.specification || "")}&unit=${encodeURIComponent(item.unit || "")}&quantity=${encodeURIComponent(item.received_qty || item.quantity)}`}
                                className="text-xs px-2 py-1 rounded bg-orange-50 text-orange-600 hover:bg-orange-100 inline-block"
                              >
                                入库登记
                              </Link>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleCompleteStorage(order.id)}
                    disabled={submitting === `complete-${order.id}`}
                    className="px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                  >
                    {submitting === `complete-${order.id}` ? "处理中..." : "提交入库"}
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

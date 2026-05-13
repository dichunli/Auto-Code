"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

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
}

interface Waybill {
  id: string;
  tracking_no: string;
  logistics_company_name: string | null;
  freight_amount: number | null;
  cod_amount: number | null;
  status: string;
  logistics_companies: { name: string } | null;
}

interface PurchaseOrder {
  id: string;
  order_no: string | null;
  supplier_id: string | null;
  status: string;
  total_amount: number | null;
  notes: string | null;
  waybill_id: string | null;
  created_at: string;
  suppliers: { id: string; name: string } | null;
  purchase_order_items: PurchaseOrderItem[];
  logistics_waybills: Waybill | null;
}

interface SupplierGroup {
  supplierId: string;
  supplierName: string;
  orders: PurchaseOrder[];
}

export function PendingReceiptList() {
  const supabase = createClient();
  const [groups, setGroups] = useState<SupplierGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [waybillModalFor, setWaybillModalFor] = useState<string | null>(null);
  const [pendingWaybills, setPendingWaybills] = useState<Waybill[]>([]);
  const [waybillLoading, setWaybillLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const { data, error } = await supabase
      .from("purchase_orders")
      .select(`
        id, order_no, supplier_id, status, total_amount, notes, waybill_id, created_at,
        suppliers(id, name),
        purchase_order_items(
          id, name, brand, specification, quantity, unit_cost, received_qty,
          part_id, work_order_item_part_id
        ),
        logistics_waybills:waybill_id(
          id, tracking_no, logistics_company_name, freight_amount, cod_amount, status,
          logistics_companies(name)
        )
      `)
      .in("status", ["submitted", "approved", "partial_received"])
      .order("created_at", { ascending: false });

    if (error) {
      console.error("加载待收货采购单失败:", error);
      setLoading(false);
      return;
    }

    const orders = (data || []) as unknown as PurchaseOrder[];

    // 按供应商分组
    const grouped: Record<string, SupplierGroup> = {};
    orders.forEach((o) => {
      const sid = o.supplier_id || "_unknown";
      const sname = o.suppliers?.name || "未指定供应商";
      if (!grouped[sid]) grouped[sid] = { supplierId: sid, supplierName: sname, orders: [] };
      grouped[sid].orders.push(o);
    });

    setGroups(Object.values(grouped));
    setLoading(false);
  }

  async function openWaybillModal(orderId: string) {
    setWaybillModalFor(orderId);
    setWaybillLoading(true);
    const { data } = await supabase
      .from("logistics_waybills")
      .select("id, tracking_no, logistics_company_name, freight_amount, cod_amount, status, logistics_companies(name)")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    setPendingWaybills(((data || []) as unknown) as Waybill[]);
    setWaybillLoading(false);
  }

  function closeWaybillModal() {
    setWaybillModalFor(null);
    setPendingWaybills([]);
  }

  async function handleAssignWaybill(waybillId: string) {
    if (!waybillModalFor) return;
    const orderId = waybillModalFor;
    const { error } = await supabase
      .from("purchase_orders")
      .update({ waybill_id: waybillId })
      .eq("id", orderId);
    if (error) {
      alert("关联运单失败: " + error.message);
      return;
    }
    closeWaybillModal();
    loadData();
  }

  async function handleConfirmReceived(order: PurchaseOrder) {
    if (!order.waybill_id) {
      alert("请先选择运单后再确认到货");
      return;
    }
    if (!confirm(`确认采购单「${order.order_no || order.id.slice(0, 8)}」已全部到货?\n注意:此操作仅标记到货,不会自动入库,需另行到「入库登记」累加库存。`)) {
      return;
    }

    setSubmitting(order.id);
    try {
      // 1. 更新采购单明细,received_qty = quantity
      for (const item of order.purchase_order_items) {
        await supabase
          .from("purchase_order_items")
          .update({ received_qty: item.quantity })
          .eq("id", item.id);
      }

      // 2. 工单分支 is_arrived = true
      const branchIds = order.purchase_order_items
        .map((it) => it.work_order_item_part_id)
        .filter((x): x is string => !!x);
      if (branchIds.length > 0) {
        await supabase
          .from("work_order_item_parts")
          .update({ is_arrived: true })
          .in("id", branchIds);
      }

      // 3. 采购单状态 = fully_received
      await supabase
        .from("purchase_orders")
        .update({ status: "fully_received" })
        .eq("id", order.id);

      // 4. 运单状态 = received
      await supabase
        .from("logistics_waybills")
        .update({ status: "received", received_at: new Date().toISOString() })
        .eq("id", order.waybill_id);

      loadData();
    } catch (err: any) {
      alert("确认到货失败: " + (err.message || String(err)));
    } finally {
      setSubmitting(null);
    }
  }

  async function handleConfirmGroup(group: SupplierGroup) {
    const allHaveWaybill = group.orders.every((o) => o.waybill_id);
    if (!allHaveWaybill) {
      alert("该供应商下还有采购单未关联运单,无法批量确认");
      return;
    }
    if (!confirm(`确认供应商「${group.supplierName}」的全部 ${group.orders.length} 张采购单都已到货?`)) {
      return;
    }
    setSubmitting(group.supplierId);
    try {
      for (const order of group.orders) {
        for (const item of order.purchase_order_items) {
          await supabase
            .from("purchase_order_items")
            .update({ received_qty: item.quantity })
            .eq("id", item.id);
        }
        const branchIds = order.purchase_order_items
          .map((it) => it.work_order_item_part_id)
          .filter((x): x is string => !!x);
        if (branchIds.length > 0) {
          await supabase
            .from("work_order_item_parts")
            .update({ is_arrived: true })
            .in("id", branchIds);
        }
        await supabase
          .from("purchase_orders")
          .update({ status: "fully_received" })
          .eq("id", order.id);
        if (order.waybill_id) {
          await supabase
            .from("logistics_waybills")
            .update({ status: "received", received_at: new Date().toISOString() })
            .eq("id", order.waybill_id);
        }
      }
      loadData();
    } catch (err: any) {
      alert("批量确认失败: " + (err.message || String(err)));
    } finally {
      setSubmitting(null);
    }
  }

  if (loading) {
    return <div className="text-center text-gray-400 py-12">加载中...</div>;
  }

  if (groups.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
        暂无待收货的采购单
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const allHaveWaybill = group.orders.every((o) => o.waybill_id);
        return (
          <div key={group.supplierId} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  供应商: {group.supplierName}
                </h3>
                <span className="text-xs text-gray-500">共 {group.orders.length} 张采购单</span>
              </div>
              <button
                type="button"
                onClick={() => handleConfirmGroup(group)}
                disabled={!allHaveWaybill || submitting === group.supplierId}
                className="px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={allHaveWaybill ? "确认本组全部到货" : "需所有采购单先关联运单"}
              >
                {submitting === group.supplierId ? "处理中..." : "全部确认到货"}
              </button>
            </div>

            <div className="divide-y divide-gray-100">
              {group.orders.map((order) => {
                const itemCount = order.purchase_order_items.length;
                const wb = order.logistics_waybills;
                return (
                  <div key={order.id} className="px-6 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                          <Link
                            href={`/procurement/${order.id}`}
                            className="text-blue-600 hover:text-blue-700 font-medium"
                          >
                            {order.order_no || order.id.slice(0, 8)}
                          </Link>
                          <span className="text-xs text-gray-500">
                            {new Date(order.created_at).toLocaleDateString()}
                          </span>
                          <span className="text-xs text-gray-500">
                            {itemCount} 项 · ¥{Number(order.total_amount || 0).toFixed(2)}
                          </span>
                        </div>

                        {/* 运单状态 */}
                        <div className="mt-1 flex items-center gap-2 text-xs">
                          {wb ? (
                            <>
                              <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700">
                                运单 {wb.tracking_no}
                              </span>
                              <span className="text-gray-500">
                                {wb.logistics_companies?.name || wb.logistics_company_name || "-"}
                              </span>
                              {wb.cod_amount != null && wb.cod_amount > 0 && (
                                <span className="text-orange-600">代收 ¥{Number(wb.cod_amount).toFixed(2)}</span>
                              )}
                              <button
                                type="button"
                                onClick={() => openWaybillModal(order.id)}
                                className="text-blue-600 hover:underline"
                              >
                                更换
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="px-2 py-0.5 rounded bg-yellow-50 text-yellow-700">
                                ⚠ 未关联运单
                              </span>
                              <button
                                type="button"
                                onClick={() => openWaybillModal(order.id)}
                                className="text-blue-600 hover:underline"
                              >
                                选择运单
                              </button>
                            </>
                          )}
                        </div>

                        {/* 配件列表 */}
                        <div className="mt-2 text-xs text-gray-600">
                          {order.purchase_order_items.slice(0, 3).map((it) => (
                            <span key={it.id} className="inline-block mr-3">
                              · {it.name} × {it.quantity}
                            </span>
                          ))}
                          {order.purchase_order_items.length > 3 && (
                            <span className="text-gray-400">等 {order.purchase_order_items.length} 项</span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleConfirmReceived(order)}
                        disabled={!order.waybill_id || submitting === order.id}
                        className="shrink-0 px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {submitting === order.id ? "处理中..." : "确认到货"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* 选择运单弹窗 */}
      {waybillModalFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">选择运单</h3>
              <button
                type="button"
                onClick={closeWaybillModal}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {waybillLoading ? (
                <div className="py-12 text-center text-gray-400">加载中...</div>
              ) : pendingWaybills.length === 0 ? (
                <div className="py-12 text-center text-gray-500">
                  <div className="mb-3">暂无待签收的运单</div>
                  <Link
                    href="/logistics"
                    className="inline-block px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
                    onClick={closeWaybillModal}
                  >
                    去物流页面创建运单
                  </Link>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">物流单号</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">物流公司</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-500">运费</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-500">代收款</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-500">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pendingWaybills.map((w) => (
                      <tr key={w.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-900 font-medium">{w.tracking_no}</td>
                        <td className="px-4 py-2 text-gray-600">
                          {w.logistics_companies?.name || w.logistics_company_name || "-"}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-700">
                          ¥{Number(w.freight_amount || 0).toFixed(2)}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-700">
                          ¥{Number(w.cod_amount || 0).toFixed(2)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => handleAssignWaybill(w.id)}
                            className="text-blue-600 hover:text-blue-700 text-xs font-medium"
                          >
                            选择
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

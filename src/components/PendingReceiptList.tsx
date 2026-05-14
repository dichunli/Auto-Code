"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ImageUploader } from "@/components/ImageUploader";
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
  not_arrived_reason: string | null;
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
  logistics_company_id: string | null;
  created_at: string;
  suppliers: { id: string; name: string; region?: string | null; phone?: string | null } | null;
  logistics_companies: { name: string } | null;
  purchase_order_items: PurchaseOrderItem[];
  logistics_waybills: Waybill | null;
}

type GroupBy = "supplier" | "logistics";

const GROUP_OPTIONS: { key: GroupBy; label: string }[] = [
  { key: "supplier", label: "按供应商" },
  { key: "logistics", label: "按物流公司" },
];

function resolveImageUrl(path: string): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return path;
  return `${base}/storage/v1/object/public/work-order-media/${path}`;
}

export function PendingReceiptList() {
  const supabase = createClient();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>("supplier");

  /* 运单弹窗 */
  const [waybillModalFor, setWaybillModalFor] = useState<string | null>(null);
  const [pendingWaybills, setPendingWaybills] = useState<Waybill[]>([]);
  const [waybillLoading, setWaybillLoading] = useState(false);

  /* 创建运单弹窗 */
  const [showCreateWaybillModal, setShowCreateWaybillModal] = useState(false);
  const [createWaybillOrder, setCreateWaybillOrder] = useState<PurchaseOrder | null>(null);
  const [wbTrackingNo, setWbTrackingNo] = useState("");
  const [wbCompanyId, setWbCompanyId] = useState("");
  const [wbPhone, setWbPhone] = useState("");
  const [wbPackageCount, setWbPackageCount] = useState("1");
  const [wbFreight, setWbFreight] = useState("");
  const [wbCod, setWbCod] = useState("");
  const [wbPhotos, setWbPhotos] = useState<string[]>([]);
  const [wbCompanies, setWbCompanies] = useState<{ id: string; name: string; scopes?: string[] | null }[]>([]);

  /* 明细未到货弹窗 */
  const [notArrivedItem, setNotArrivedItem] = useState<PurchaseOrderItem | null>(null);
  const [notArrivedOrder, setNotArrivedOrder] = useState<PurchaseOrder | null>(null);
  const [notArrivedOption, setNotArrivedOption] = useState<"pre_received" | "return_order" | "reship" | "cancel" | "">("");

  /* 行内到货数量编辑 */
  const [editingQtyMap, setEditingQtyMap] = useState<Record<string, string>>({});

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const { data, error } = await supabase
      .from("purchase_orders")
      .select(`
        id, order_no, supplier_id, status, total_amount, notes, waybill_id, created_at, logistics_company_id,
        suppliers(id, name, region, phone),
        logistics_companies:logistics_company_id(name),
        purchase_order_items(
          id, name, brand, specification, quantity, unit_cost, received_qty,
          part_id, work_order_item_part_id, part_number, supplier_part_name,
          unit, category, license_plate, photos, notes, not_arrived_reason
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

    const rawOrders = (data || []) as unknown as PurchaseOrder[];
    const filtered = rawOrders.filter((order) => {
      const items = order.purchase_order_items || [];
      const hasPending = items.some(
        (it) => (it.received_qty || 0) < it.quantity && !it.not_arrived_reason
      );
      return hasPending;
    });
    setOrders(filtered);
    setLoading(false);
  }

  function orderNeedsWaybill(order: PurchaseOrder): boolean {
    return order.suppliers?.region !== "local";
  }

  function getReceiptStatus(order: PurchaseOrder): { label: string; color: string } {
    const items = order.purchase_order_items;
    if (items.length === 0) return { label: "未到货", color: "bg-gray-100 text-gray-600" };
    const allReceived = items.every((it) => (it.received_qty || 0) >= it.quantity);
    if (allReceived) return { label: "全部到货", color: "bg-green-100 text-green-700" };
    const anyReceived = items.some((it) => (it.received_qty || 0) > 0);
    if (anyReceived) return { label: "部分到货", color: "bg-orange-100 text-orange-700" };
    return { label: "未到货", color: "bg-gray-100 text-gray-600" };
  }

  function getItemStatus(item: PurchaseOrderItem): { label: string; color: string } | null {
    if (item.not_arrived_reason) {
      return { label: "未到货", color: "bg-red-100 text-red-700" };
    }
    if ((item.received_qty || 0) >= item.quantity) {
      return { label: "已到货", color: "bg-green-100 text-green-700" };
    }
    if ((item.received_qty || 0) > 0) {
      return { label: `到货 ${item.received_qty}/${item.quantity}`, color: "bg-orange-100 text-orange-700" };
    }
    return null;
  }

  async function handleConfirmItemArrived(order: PurchaseOrder, item: PurchaseOrderItem, qty: number) {
    if (qty < 0) qty = 0;
    if (qty > item.quantity) {
      if (!confirm(`到货数量 ${qty} 大于订货数量 ${item.quantity}，是否继续？`)) return;
    }

    setSubmitting(`item-${item.id}`);
    try {
      await supabase.from("purchase_order_items").update({ received_qty: qty }).eq("id", item.id);

      const items = order.purchase_order_items.map((it) =>
        it.id === item.id ? { ...it, received_qty: qty } : it
      );
      const hasPending = items.some(
        (it) => (it.received_qty || 0) < it.quantity && !it.not_arrived_reason
      );
      const anyReceived = items.some((it) => (it.received_qty || 0) > 0);
      const anyNotArrived = items.some((it) => !!it.not_arrived_reason);

      let newStatus = order.status;
      if (!hasPending) {
        const anyArrived = items.some((it) => (it.received_qty || 0) >= it.quantity);
        if (anyArrived) newStatus = "pending_storage";
        else {
          const allCancelled = items.every((it) => it.not_arrived_reason === "取消发货");
          newStatus = allCancelled ? "cancelled" : "completed";
        }
      } else if (anyReceived) {
        newStatus = "partial_received";
      } else {
        newStatus = "submitted";
      }

      await supabase.from("purchase_orders").update({ status: newStatus }).eq("id", order.id);

      if (newStatus === "pending_storage" && !anyNotArrived) {
        const branchIds = items
          .map((it) => it.work_order_item_part_id)
          .filter((x): x is string => !!x);
        if (branchIds.length > 0) {
          await supabase.from("work_order_item_parts").update({ is_arrived: true }).in("id", branchIds);
        }
      }

      if (newStatus === "pending_storage" && order.waybill_id) {
        await supabase
          .from("logistics_waybills")
          .update({ status: "received", received_at: new Date().toISOString() })
          .eq("id", order.waybill_id);
      }

      loadData();
    } catch (err: any) {
      alert("确认到货失败: " + (err.message || String(err)));
    } finally {
      setSubmitting(null);
    }
  }

  async function handleConfirmItemNotArrived(
    order: PurchaseOrder,
    item: PurchaseOrderItem,
    option: "pre_received" | "return_order" | "reship" | "cancel"
  ) {
    const reasonMap = {
      pre_received: "欠发货已入库",
      return_order: "未收到货",
      reship: "漏发，重新补发",
      cancel: "取消发货",
    };
    const reasonText = reasonMap[option];

    setSubmitting(`item-${item.id}`);
    try {
      const isPreReceive = option === "pre_received" || option === "return_order";
      const receiveQty = isPreReceive ? item.quantity : 0;

      await supabase
        .from("purchase_order_items")
        .update({ not_arrived_reason: reasonText, received_qty: receiveQty })
        .eq("id", item.id);

      if (item.work_order_item_part_id) {
        const wpUpdate: Record<string, any> = {};
        if (option === "pre_received") {
          wpUpdate.pre_received_qty = item.quantity;
          wpUpdate.is_purchased = false;
        } else if (option === "reship") {
          wpUpdate.is_purchased = false;
        }
        if (Object.keys(wpUpdate).length > 0) {
          await supabase
            .from("work_order_item_parts")
            .update(wpUpdate)
            .eq("id", item.work_order_item_part_id);
        }
      }

      const { data: freshItems } = await supabase
        .from("purchase_order_items")
        .select("id, quantity, received_qty, not_arrived_reason")
        .eq("order_id", order.id);
      const items = freshItems || [];

      const hasPending = items.some(
        (it) => (it.received_qty || 0) < it.quantity && !it.not_arrived_reason
      );
      if (!hasPending) {
        const anyArrived = items.some((it) => (it.received_qty || 0) >= it.quantity);
        let newStatus: string;
        if (anyArrived) {
          newStatus = "pending_storage";
        } else {
          const allCancelled = items.every((it) => it.not_arrived_reason === "取消发货");
          newStatus = allCancelled ? "cancelled" : "completed";
        }
        await supabase.from("purchase_orders").update({ status: newStatus }).eq("id", order.id);
      } else {
        const anyReceived = items.some((it) => (it.received_qty || 0) > 0);
        let newStatus = order.status;
        if (anyReceived) newStatus = "partial_received";
        else newStatus = "submitted";
        await supabase.from("purchase_orders").update({ status: newStatus }).eq("id", order.id);
      }

      loadData();
    } catch (err: any) {
      alert("标记未到货失败: " + (err.message || String(err)));
    } finally {
      setSubmitting(null);
      setNotArrivedItem(null);
      setNotArrivedOrder(null);
      setNotArrivedOption("");
    }
  }

  function openNotArrivedModal(order: PurchaseOrder, item: PurchaseOrderItem) {
    setNotArrivedOrder(order);
    setNotArrivedItem(item);
    setNotArrivedOption("");
  }

  function closeNotArrivedModal() {
    setNotArrivedOrder(null);
    setNotArrivedItem(null);
    setNotArrivedOption("");
  }

  const displayGroups = useMemo(() => {
    const map = new Map<string, PurchaseOrder[]>();
    for (const o of orders) {
      let key: string;
      if (groupBy === "supplier") {
        key = o.suppliers?.name || "未指定供应商";
      } else {
        key =
          o.logistics_companies?.name ||
          o.logistics_waybills?.logistics_companies?.name ||
          o.logistics_waybills?.logistics_company_name ||
          "未选择物流";
      }
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(o);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, "zh"))
      .map(([key, list]) => ({ key, orders: list }));
  }, [orders, groupBy]);

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

  function generateTrackingNo(): string {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const randomStr = Math.floor(1000 + Math.random() * 9000);
    return `YD-${dateStr}-${randomStr}`;
  }

  async function openCreateWaybillModal(order: PurchaseOrder) {
    setCreateWaybillOrder(order);
    setWbTrackingNo(generateTrackingNo());
    setWbCompanyId(order.logistics_company_id || "");
    setWbPhone(order.suppliers?.phone || "");
    setWbPackageCount("1");
    setWbFreight("");
    setWbCod("");
    setWbPhotos([]);
    setShowCreateWaybillModal(true);
    const { data } = await supabase
      .from("logistics_companies")
      .select("id, name, scopes")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    setWbCompanies(data || []);
  }

  function closeCreateWaybillModal() {
    setShowCreateWaybillModal(false);
    setCreateWaybillOrder(null);
    setWbTrackingNo("");
    setWbCompanyId("");
    setWbPhone("");
    setWbPackageCount("1");
    setWbFreight("");
    setWbCod("");
    setWbPhotos([]);
  }

  async function handleCreateWaybill() {
    if (!wbTrackingNo.trim()) {
      alert("请填写运单号");
      return;
    }
    if (!createWaybillOrder) return;

    setSubmitting("create-waybill");
    try {
      const company = wbCompanies.find((c) => c.id === wbCompanyId);
      const { data: waybill, error } = await supabase
        .from("logistics_waybills")
        .insert({
          tracking_no: wbTrackingNo.trim(),
          logistics_company_id: wbCompanyId || null,
          logistics_company_name: company?.name || null,
          phone: wbPhone.trim() || null,
          package_count: parseInt(wbPackageCount) || 1,
          freight_amount: parseFloat(wbFreight) || 0,
          cod_amount: parseFloat(wbCod) || 0,
          photos: wbPhotos.length > 0 ? wbPhotos : null,
          status: "pending",
        })
        .select("id")
        .single();

      if (error || !waybill) throw error || new Error("创建运单失败");

      await supabase
        .from("purchase_orders")
        .update({ waybill_id: waybill.id })
        .eq("id", createWaybillOrder.id);

      alert("运单创建成功");
      closeCreateWaybillModal();
      loadData();
    } catch (err: any) {
      alert("创建运单失败: " + (err.message || String(err)));
    } finally {
      setSubmitting(null);
    }
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

  if (loading) {
    return <div className="text-center text-gray-400 py-12">加载中...</div>;
  }

  if (orders.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
        暂无待收货的采购单
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">分组:</span>
        {GROUP_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setGroupBy(opt.key)}
            className={`px-2 py-1 text-xs rounded border transition-colors ${
              groupBy === opt.key
                ? "bg-blue-600 border-blue-600 text-white"
                : "bg-white border-gray-200 text-gray-600 hover:border-blue-400"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {displayGroups.map((g) => (
          <div key={g.key} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  {groupBy === "supplier" ? `供应商: ${g.key}` : `物流: ${g.key}`}
                </h3>
                <span className="text-xs text-gray-500">共 {g.orders.length} 张采购单</span>
              </div>
            </div>

            <div className="divide-y divide-gray-100">
              {g.orders.map((order) => {
                const receiptStatus = getReceiptStatus(order);
                const needsWaybill = orderNeedsWaybill(order);
                const canConfirm = !needsWaybill || !!order.waybill_id;
                const wb = order.logistics_waybills;
                return (
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
                      <span className={`text-xs px-1.5 py-0.5 rounded ${receiptStatus.color}`}>
                        {receiptStatus.label}
                      </span>

                      {wb ? (
                        <>
                          <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-xs">
                            运单 {wb.tracking_no}
                          </span>
                          <span className="text-xs text-gray-500">
                            {wb.logistics_companies?.name || wb.logistics_company_name || "-"}
                          </span>
                          <button
                            type="button"
                            onClick={() => openWaybillModal(order.id)}
                            className="text-blue-600 hover:underline text-xs"
                          >
                            更换
                          </button>
                        </>
                      ) : needsWaybill ? (
                        <>
                          <span className="px-2 py-0.5 rounded bg-yellow-50 text-yellow-700 text-xs">
                            未关联运单
                          </span>
                          {order.logistics_companies?.name && (
                            <span className="text-xs text-gray-500">
                              物流: {order.logistics_companies.name}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => openCreateWaybillModal(order)}
                            className="text-blue-600 hover:underline text-xs"
                          >
                            创建运单
                          </button>
                          <button
                            type="button"
                            onClick={() => openWaybillModal(order.id)}
                            className="text-gray-500 hover:text-blue-600 hover:underline text-xs"
                          >
                            选择已有运单
                          </button>
                        </>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-gray-50 text-gray-500 text-xs">
                          本地供货 · 无需运单
                        </span>
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
                            <th className="px-3 py-2 text-left font-medium text-gray-500">备注</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500 w-16">图片</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500">车牌</th>
                            <th className="px-3 py-2 text-center font-medium text-gray-500 w-32">到货数量</th>
                            <th className="px-3 py-2 text-center font-medium text-gray-500 w-28">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {order.purchase_order_items.map((item, idx) => {
                            const itemStatus = getItemStatus(item);
                            return (
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
                                <td className="px-3 py-2 text-gray-700">{item.unit || "-"}</td>
                                <td className="px-3 py-2 text-gray-700">{item.category || "-"}</td>
                                <td
                                  className="px-3 py-2 text-gray-700 max-w-[120px] truncate"
                                  title={item.notes || ""}
                                >
                                  {item.notes || "-"}
                                </td>
                                <td className="px-3 py-2">
                                  {item.photos && item.photos.length > 0 ? (
                                    <div className="flex gap-1">
                                      {item.photos.slice(0, 2).map((p, i) => (
                                        <img
                                          key={i}
                                          src={resolveImageUrl(p)}
                                          alt=""
                                          className="w-8 h-8 object-cover rounded border border-gray-100"
                                          onError={(e) => {
                                            (e.target as HTMLImageElement).style.display = "none";
                                          }}
                                        />
                                      ))}
                                      {item.photos.length > 2 && (
                                        <span className="text-xs text-gray-400 self-center">
                                          +{item.photos.length - 2}
                                        </span>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-gray-300">-</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-gray-700">{item.license_plate || "-"}</td>
                                <td className="px-3 py-2 text-center">
                                  {itemStatus ? (
                                    <span className={`text-xs px-2 py-0.5 rounded ${itemStatus.color}`}>
                                      {itemStatus.label}
                                    </span>
                                  ) : item.quantity === 1 ? (
                                    <span className="text-xs text-gray-400">—</span>
                                  ) : (
                                    <input
                                      type="number"
                                      min={0}
                                      max={item.quantity}
                                      placeholder=""
                                      value={editingQtyMap[item.id] ?? ""}
                                      onChange={(e) =>
                                        setEditingQtyMap((prev) => ({ ...prev, [item.id]: e.target.value }))
                                      }
                                      className="w-16 px-1 py-0.5 text-xs text-center border border-gray-300 rounded"
                                    />
                                  )}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  {itemStatus ? (
                                    <span className="text-xs text-gray-400">—</span>
                                  ) : (
                                    <div className="flex items-center justify-center gap-1">
                                      {item.quantity === 1 ? (
                                        <button
                                          type="button"
                                          onClick={() => handleConfirmItemArrived(order, item, 1)}
                                          disabled={!canConfirm || submitting === `item-${item.id}`}
                                          className="px-2 py-0.5 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50"
                                        >
                                          确认到货
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const raw = editingQtyMap[item.id]?.trim();
                                            if (!raw) {
                                              alert("请填写到货数量");
                                              return;
                                            }
                                            const qty = parseInt(raw, 10);
                                            if (isNaN(qty) || qty < 0) {
                                              alert("到货数量必须大于或等于0");
                                              return;
                                            }
                                            if (qty > item.quantity) {
                                              alert(`到货数量不能大于订货数量 ${item.quantity}`);
                                              return;
                                            }
                                            handleConfirmItemArrived(order, item, qty);
                                          }}
                                          disabled={!canConfirm || submitting === `item-${item.id}`}
                                          className="px-2 py-0.5 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50"
                                        >
                                          确认
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => openNotArrivedModal(order, item)}
                                        disabled={submitting === `item-${item.id}`}
                                        className="px-2 py-0.5 bg-red-50 text-red-600 text-xs rounded hover:bg-red-100 disabled:opacity-50"
                                      >
                                        未到货
                                      </button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

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

      {/* 创建运单弹窗 */}
      {showCreateWaybillModal && createWaybillOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">创建运单</h3>
              <button
                type="button"
                onClick={closeCreateWaybillModal}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">运单号 *</label>
                  <input
                    type="text"
                    value={wbTrackingNo}
                    onChange={(e) => setWbTrackingNo(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">物流公司</label>
                  <select
                    value={wbCompanyId}
                    onChange={(e) => setWbCompanyId(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="">请选择</option>
                    {wbCompanies.filter((c) => !c.scopes || c.scopes.length === 0 || c.scopes.includes("harbin")).length > 0 && (
                      <optgroup label="哈市物流">
                        {wbCompanies.filter((c) => !c.scopes || c.scopes.length === 0 || c.scopes.includes("harbin")).map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </optgroup>
                    )}
                    {wbCompanies.filter((c) => c.scopes?.includes("outside")).length > 0 && (
                      <optgroup label="外阜快递">
                        {wbCompanies.filter((c) => c.scopes?.includes("outside")).map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">运单电话</label>
                  <input
                    type="text"
                    value={wbPhone}
                    onChange={(e) => setWbPhone(e.target.value)}
                    placeholder="调自供货商"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">件数</label>
                  <input
                    type="number"
                    min={1}
                    value={wbPackageCount}
                    onChange={(e) => setWbPackageCount(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">运费金额</label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={wbFreight}
                    onChange={(e) => setWbFreight(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">代收金额</label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={wbCod}
                    onChange={(e) => setWbCod(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">运单照片</label>
                <ImageUploader
                  onUpload={(paths) => setWbPhotos(paths)}
                  existingImages={wbPhotos}
                  maxImages={5}
                  bucket="work-order-media"
                  folder="waybill-photos"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeCreateWaybillModal}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleCreateWaybill}
                disabled={submitting === "create-waybill"}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting === "create-waybill" ? "保存中..." : "创建运单"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 未到货弹窗 */}
      {notArrivedItem && notArrivedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">标记未到货</h3>
              <button
                type="button"
                onClick={closeNotArrivedModal}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-3">
              <p className="text-sm text-gray-700">
                配件：<span className="font-medium">{notArrivedItem.name}</span>
              </p>
              <label className="flex items-start gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="notArrivedOption"
                  value="pre_received"
                  checked={notArrivedOption === "pre_received"}
                  onChange={() => setNotArrivedOption("pre_received")}
                  className="mt-0.5"
                />
                <div className="text-sm">
                  <div className="font-medium text-gray-900">欠发货已入库</div>
                  <div className="text-gray-500 text-xs mt-0.5">先按采购单入库（与供应商单据一致），商品返回待采购，真正到货时不重复增加库存</div>
                </div>
              </label>
              <label className="flex items-start gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="notArrivedOption"
                  value="return_order"
                  checked={notArrivedOption === "return_order"}
                  onChange={() => setNotArrivedOption("return_order")}
                  className="mt-0.5"
                />
                <div className="text-sm">
                  <div className="font-medium text-gray-900">未收到货，生成退单</div>
                  <div className="text-gray-500 text-xs mt-0.5">先按采购单入库（与供应商单据一致），然后走退货流程生成退单</div>
                </div>
              </label>
              <label className="flex items-start gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="notArrivedOption"
                  value="reship"
                  checked={notArrivedOption === "reship"}
                  onChange={() => setNotArrivedOption("reship")}
                  className="mt-0.5"
                />
                <div className="text-sm">
                  <div className="font-medium text-gray-900">漏发，重新补发</div>
                  <div className="text-gray-500 text-xs mt-0.5">商品返回待采购，标记漏发，重新安排采购</div>
                </div>
              </label>
              <label className="flex items-start gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="notArrivedOption"
                  value="cancel"
                  checked={notArrivedOption === "cancel"}
                  onChange={() => setNotArrivedOption("cancel")}
                  className="mt-0.5"
                />
                <div className="text-sm">
                  <div className="font-medium text-gray-900">取消发货</div>
                  <div className="text-gray-500 text-xs mt-0.5">取消该条采购，归档到被取消的采购单</div>
                </div>
              </label>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeNotArrivedModal}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!notArrivedOption) {
                    alert("请选择未到货原因");
                    return;
                  }
                  handleConfirmItemNotArrived(notArrivedOrder, notArrivedItem, notArrivedOption);
                }}
                disabled={!notArrivedOption || submitting === `item-${notArrivedItem.id}`}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {submitting === `item-${notArrivedItem.id}` ? "处理中..." : "确认"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

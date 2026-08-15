"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PriceValue } from "@/components/PriceVisibilityContext";
import { PartSearchDropdown } from "@/components/PartSearchDropdown";
import { useConfirm } from "./ConfirmDialog";
import PartForm from "@/app/parts/new/PartForm";
import { ACTION_LABELS } from "@/lib/purchaseFlowLabels";
import { usePartLinking } from "./usePartLinking";
import { 确认采购入库, 退回待收货 } from "@/app/procurement/actions";
import { DocumentNameInput } from "./DocumentNameInput";

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
  handle_action: string | null;
  discount_amount: number | null;
  evidence_photos: string[] | null;
  return_reason: string | null;
}

interface PurchaseOrder {
  id: string;
  order_no: string | null;
  supplier_id: string | null;
  status: string;
  total_amount: number | null;
  notes: string | null;
  created_at: string;
  waybill_id: string | null;
  suppliers: { id: string; name: string } | null;
  purchase_order_items: PurchaseOrderItem[];
}

/* 处理动作标签已抽到 @/lib/purchaseFlowLabels（唯一来源）;
   「哪些动作要生成待退货」映射已下沉到数据库函数 complete_purchase_inbound,前端不再单独创建退货记录 */

/* 算每个 item 在入库时需要登记的库存数量
   - wrong_discard: 0 (不入库)
   - excess_return: 只入采购单数量(多出部分直接生成退货,不入库)
   - excess_paid / excess_free: received_qty (全入库)
   - short_*: received_qty
   - 其它: 取 received_qty || quantity
*/
function getStorageQty(item: PurchaseOrderItem): number {
  if (item.handle_action === "wrong_discard") return 0;
  if (item.handle_action === "excess_return") return item.quantity; /* 多发退货只入采购单数量 */
  return item.received_qty ?? item.quantity;
}

interface Warehouse {
  id: string;
  name: string;
}

interface InboundItemForm {
  id: string;
  item: PurchaseOrderItem;
  quantity: string;
  batchNo: string;
  notes: string;
  warehouseId: string;
  location: string;
  isExcess: boolean;
}

export function PendingStorageList() {
  const supabase = createClient();
  const { 请求确认, 确认弹窗 } = useConfirm();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null);

  /* 入库单确认弹窗 */
  const [inboundModalOpen, setInboundModalOpen] = useState(false);
  const [inboundModalOrder, setInboundModalOrder] = useState<PurchaseOrder | null>(null);
  const [inboundItems, setInboundItems] = useState<InboundItemForm[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [freightAmount, setFreightAmount] = useState("");
  const [waybillInfo, setWaybillInfo] = useState<{ logistics_company_name: string | null; tracking_no: string | null; freight_amount: number | null } | null>(null);

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
          unit, category, license_plate, photos, notes,
          handle_action, discount_amount, evidence_photos, return_reason
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
     
  }, []);

  /* 打开入库单确认弹窗 */
  async function openInboundModal(order: PurchaseOrder) {
    const items = order.purchase_order_items || [];
    let formIdCounter = 0;
    const forms: InboundItemForm[] = items
      .filter((it) => it.handle_action !== "wrong_discard" && getStorageQty(it) > 0)
      .flatMap((it) => {
        if (it.handle_action === "excess_return") {
          /* 多发退货拆分为两行：正常采购数量 + 多出数量 */
          return [
            {
              id: `form-${formIdCounter++}`,
              item: it,
              quantity: String(it.quantity),
              batchNo: "",
              notes: it.notes || "",
              warehouseId: "",
              location: "",
              isExcess: false,
            },
            {
              id: `form-${formIdCounter++}`,
              item: it,
              quantity: String(Math.max(0, (it.received_qty ?? 0) - it.quantity)),
              batchNo: "",
              notes: "多发退货",
              warehouseId: "",
              location: "",
              isExcess: true,
            },
          ];
        }
        return [
          {
            id: `form-${formIdCounter++}`,
            item: it,
            quantity: String(getStorageQty(it)),
            batchNo: "",
            notes: it.notes || "",
            warehouseId: "",
            location: "",
            isExcess: false,
          },
        ];
      });

    /* 加载仓库列表 */
    const { data: whData } = await supabase.from("warehouses").select("id, name").order("name");
    setWarehouses(whData || []);

    /* 加载关联运单信息 */
    if (order.waybill_id) {
      const { data: wb } = await supabase
        .from("logistics_waybills")
        .select("logistics_company_name, tracking_no, freight_amount")
        .eq("id", order.waybill_id)
        .single();
      if (wb) {
        setWaybillInfo(wb as { logistics_company_name: string | null; tracking_no: string | null; freight_amount: number | null });
        setFreightAmount(wb.freight_amount != null ? String(wb.freight_amount) : "");
      } else {
        setWaybillInfo(null);
        setFreightAmount("");
      }
    } else {
      setWaybillInfo(null);
      setFreightAmount("");
    }

    setInboundModalOrder(order);
    setInboundItems(forms);
    setInboundModalOpen(true);
  }

  function closeInboundModal() {
    setInboundModalOpen(false);
    setInboundModalOrder(null);
    setInboundItems([]);
    setWaybillInfo(null);
    setFreightAmount("");
  }

  /* 计算分摊后的成本价（多发退货部分不参与分摊） */
  const allocatedCosts = useMemo(() => {
    const totalFreight = parseFloat(freightAmount) || 0;
    const totalQty = inboundItems
      .filter((f) => !f.isExcess)
      .reduce((sum, f) => sum + (parseInt(f.quantity, 10) || 0), 0);
    if (totalFreight <= 0 || totalQty <= 0) {
      return inboundItems.map(() => 0);
    }
    const perUnit = totalFreight / totalQty;
    return inboundItems.map((f) => {
      if (f.isExcess) return 0;
      const q = parseInt(f.quantity, 10) || 0;
      return Math.round(perUnit * q * 100) / 100;
    });
  }, [inboundItems, freightAmount]);

  async function handleConfirmInbound() {
    if (!inboundModalOrder) return;
    const orderId = inboundModalOrder.id;
    setSubmitting(`complete-${orderId}`);
    try {
      /* 多表写入已收编进数据库事务函数 complete_purchase_inbound:
         入库单/明细/加库存/仓位/批次/流水/应付款/采购单状态/退货记录,任一失败整体回滚 */
      const 明细 = inboundItems.map((f) => ({
        purchase_order_item_id: f.item.id,
        quantity: parseInt(f.quantity, 10) || 0,
        batch_no: f.batchNo,
        warehouse_id: f.warehouseId,
        location: f.location,
        notes: f.notes,
        is_excess: f.isExcess,
      }));
      const res = await 确认采购入库(orderId, 明细, parseFloat(freightAmount) || 0);
      if (!res.success) {
        alert("入库失败: " + (res.error || "未知错误"));
        return;
      }
      closeInboundModal();
      loadData();
    } catch (err: unknown) {
      const e = err as Error;
      alert("操作失败: " + (e.message || String(err)));
    } finally {
      setSubmitting(null);
    }
  }

  async function handleRevokeStorage(order: PurchaseOrder) {
    if (!(await 请求确认("确认退回待收货?这会清除所有处理结果并删除已生成的待采购分支。"))) return;
    setSubmitting(`revoke-${order.id}`);
    try {
      /* 回退的多表写入已收编进数据库事务函数 revoke_pending_storage */
      const res = await 退回待收货(order.id);
      if (!res.success) {
        alert("退回失败: " + (res.error || "未知错误"));
        return;
      }
      loadData();
    } catch (err: unknown) {
      const e = err as Error;
      alert("退回失败: " + (e.message || String(err)));
    } finally {
      setSubmitting(null);
    }
  }

  /* 行内配件编辑逻辑已抽到 usePartLinking（对照表驱动的共享实现） */
  const 配件联动 = usePartLinking<PurchaseOrderItem>({
    supabase,
    主表: "purchase_order_items",
    双写WOI: true,
    getRowId: (item) => item.id,
    getWoiId: (item) => item.work_order_item_part_id,
    getWoi当前值: async (item) => {
      if (!item.work_order_item_part_id) return null;
      const { data } = await supabase
        .from("work_order_item_parts")
        .select("name, unit, brand, specification, unit_cost, unit_price")
        .eq("id", item.work_order_item_part_id)
        .single();
      return data;
    },
    写WoiPartId: false,
    行内unitCost来源: "unit_cost",
    行内写售价: true,
    弹窗写supplierPartName: true,
    弹窗写WoiDocumentName: true,
    弹窗规格来源: "specification_text",
    取弹前行: (item) => item,
    setSubmitting,
    reload: loadData,
  });
  const {
    editRow: editItem,
    editId,
    prefillData: 配件预填,
    openEditModal,
    openCreateNewModal,
    closeEditModal,
    handlePartSaved,
    handleInlinePartSelect,
    handleInlineClear,
  } = 配件联动;


  const supplierOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      if (o.suppliers?.name) set.add(o.suppliers.name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh"));
  }, [orders]);

  const supplierCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of orders) {
      const name = o.suppliers?.name || "未指定供应商";
      const qty = (o.purchase_order_items || []).reduce((sum, it) => sum + it.quantity, 0);
      map.set(name, (map.get(name) || 0) + qty);
    }
    return map;
  }, [orders]);

  const filteredOrders = useMemo(() => {
    if (!supplierFilter) return orders;
    return orders.filter((o) => (o.suppliers?.name || "未指定供应商") === supplierFilter);
  }, [orders, supplierFilter]);

  const displayGroups = useMemo(() => {
    const map = new Map<string, PurchaseOrder[]>();
    for (const o of filteredOrders) {
      const key = o.suppliers?.name || "未指定供应商";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(o);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, "zh"))
      .map(([key, list]) => ({ key, orders: list }));
  }, [filteredOrders]);

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
      {supplierOptions.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-xs text-gray-500">供应商:</span>
          <button
            type="button"
            onClick={() => setSupplierFilter(null)}
            className={`px-2 py-1 text-xs rounded border transition-colors ${
              supplierFilter === null
                ? "bg-blue-600 border-blue-600 text-white"
                : "bg-white border-gray-200 text-gray-600 hover:border-blue-400"
            }`}
          >
            全部
          </button>
          {supplierOptions.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setSupplierFilter(name)}
              className={`px-2 py-1 text-xs rounded border transition-colors ${
                supplierFilter === name
                  ? "bg-blue-600 border-blue-600 text-white"
                  : "bg-white border-gray-200 text-gray-600 hover:border-blue-400"
              }`}
            >
              {name} ({supplierCounts.get(name) || 0})
            </button>
          ))}
        </div>
      )}
      {displayGroups.map((g) => (
        /* 分组卡片：与待采购页统一风格（2026-08-15）——左侧蓝竖条+蓝色标签+加粗组名 */
        <div key={g.key} className="bg-white rounded-xl border border-gray-200 border-l-4 border-l-blue-500 overflow-hidden">
          <div className="px-6 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 flex items-center">
                <span className="inline-block px-2 py-0.5 rounded bg-blue-600 text-white mr-2 text-[10px] font-bold">供应商</span>
                <span className="font-bold text-gray-900">{g.key}</span>
              </h3>
              <span className="text-xs text-gray-500">
                共 {g.orders.length} 张采购单 · {g.orders.reduce((sum, o) => sum + o.purchase_order_items.reduce((s, it) => s + it.quantity, 0), 0)} 件
              </span>
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
                        <th className="px-3 py-2 text-center font-medium text-gray-500 w-36">处理结果</th>
                        <th className="px-3 py-2 text-center font-medium text-gray-500 w-28">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {order.purchase_order_items.map((item, idx) => {
                        const actionInfo = item.handle_action ? ACTION_LABELS[item.handle_action] : null;
                        const storageQty = getStorageQty(item);
                        const skipStorage = item.handle_action === "wrong_discard" || storageQty <= 0;
                        return (
                          <tr key={item.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-gray-500">{idx + 1}</td>
                            <td className="px-3 py-2">
                              <PartSearchDropdown
                                value={item.part_number || ""}
                                onChange={() => {}}
                                onSelect={(part) => handleInlinePartSelect(item, part)}
                                onCreateNew={(query) => openCreateNewModal(item, query)}
                                onClear={() => handleInlineClear(item)}
                                disabled={submitting === `inline-${item.id}`}
                                placeholder="编码"
                                inputClassName="w-20 border-gray-200 text-xs"
                              />
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <div className="text-gray-900 font-medium">{item.name}</div>
                              {item.brand || item.specification ? (
                                <div className="text-xs text-gray-400">
                                  {item.brand || ""} {item.specification || ""}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                              <DocumentNameInput 采购明细id={item.id} 初始值={item.supplier_part_name || ""} 保存后={loadData} />
                            </td>
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
                                      loading="lazy"
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
                              {actionInfo ? (
                                <span className={`text-xs px-2 py-0.5 rounded ${actionInfo.color}`}>
                                  {actionInfo.text} ({item.received_qty ?? 0}/{item.quantity})
                                </span>
                              ) : item.return_reason ? (
                                <span className="text-xs px-2 py-0.5 rounded bg-orange-50 text-orange-700">
                                  退货:{item.return_reason === "damaged" ? "破损" : item.return_reason === "wrong_ship" ? "错发" : item.return_reason === "excess" ? "多发退货" : "客户悔单"}
                                </span>
                              ) : (
                                <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700">
                                  {item.received_qty ?? 0} / {item.quantity}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <div className="flex items-center gap-1">
                                {skipStorage ? (
                                  <span className="text-xs text-gray-400">无需入库</span>
                                ) : item.part_id ? (
                                  /* 已有库存档案的配件统一走「确认入库」加库存+记账（2026-08-16 双入库防重），
                                     不再提供手工入库登记入口（会与确认入库重复加库存） */
                                  <span className="text-xs text-gray-400">走确认入库</span>
                                ) : (
                                  /* 全新配件（无库存档案）唯一入库通道：手工建档入库 */
                                  <Link
                                    href={`/inventory/in?auto_fill=1&name=${encodeURIComponent(item.name)}&part_number=${encodeURIComponent(item.part_number || "")}&brand=${encodeURIComponent(item.brand || "")}&specification=${encodeURIComponent(item.specification || "")}&unit=${encodeURIComponent(item.unit || "")}&quantity=${encodeURIComponent(storageQty)}`}
                                    className="text-xs px-2 py-1 rounded bg-orange-50 text-orange-600 hover:bg-orange-100 inline-block"
                                  >
                                    入库登记
                                  </Link>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openEditModal(item)}
                                  disabled={submitting === `edit-${item.id}`}
                                  className="text-xs text-gray-500 hover:text-blue-600 whitespace-nowrap"
                                >
                                  编辑
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => handleRevokeStorage(order)}
                    disabled={submitting === `revoke-${order.id}`}
                    className="px-3 py-1.5 border border-red-200 text-red-600 bg-red-50 text-sm font-medium rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50"
                  >
                    {submitting === `revoke-${order.id}` ? "处理中..." : "退回待收货"}
                  </button>
                  <button
                    type="button"
                    onClick={() => openInboundModal(order)}
                    disabled={submitting === `complete-${order.id}`}
                    className="px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                  >
                    {submitting === `complete-${order.id}` ? "处理中..." : "生成入库单"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* 入库单确认弹窗 */}
      {inboundModalOpen && inboundModalOrder && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-5xl my-8 relative">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div>
                <h3 className="text-base font-semibold text-gray-900">入库单确认</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  采购单: {inboundModalOrder.order_no || inboundModalOrder.id.slice(0, 8)} · 供应商: {inboundModalOrder.suppliers?.name || "-"}
                </p>
              </div>
              <button
                type="button"
                onClick={closeInboundModal}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-4">
              {/* 运费信息 */}
              <div className="bg-gray-50 rounded-lg p-3 flex items-center gap-4 flex-wrap">
                {waybillInfo ? (
                  <span className="text-xs text-gray-500">
                    关联运单: {waybillInfo.logistics_company_name || "-"} / {waybillInfo.tracking_no || "-"}
                  </span>
                ) : (
                  <span className="text-xs text-gray-500">无关联运单</span>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">运费金额(¥):</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={freightAmount}
                    onChange={(e) => setFreightAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-24 px-2 py-1 text-xs text-right rounded border border-gray-200 focus:outline-none focus:border-blue-400"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm border border-gray-100 rounded-lg">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-500 w-10">序号</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">商品名称</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500 w-24">编码</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500 w-16">数量</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500 w-20">单价</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500 w-20">分摊运费</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500 w-20">成本价</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500 w-28">批次号</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500 w-28">仓库</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500 w-24">仓位</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500 w-28">备注</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {inboundItems.map((f, idx) => {
                      const qty = parseInt(f.quantity, 10) || 0;
                      const baseCost = qty * (f.item.unit_cost || 0);
                      const alloc = allocatedCosts[idx] || 0;
                      const totalCost = baseCost + alloc;
                      return (
                        <tr key={f.id} className={f.isExcess ? "bg-gray-50" : "hover:bg-gray-50"}>
                          <td className="px-3 py-2 text-gray-500">{idx + 1}</td>
                          <td className="px-3 py-2 text-gray-900 font-medium">
                            {f.item.name}
                            {f.isExcess && (
                              <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 align-middle">
                                多发退货
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-600">{f.item.part_number || "-"}</td>
                          <td className="px-3 py-2">
                            {f.isExcess ? (
                              <span className="block text-right text-gray-500 text-sm">{f.quantity}</span>
                            ) : (
                              <input
                                type="number"
                                min={0}
                                value={f.quantity}
                                onChange={(e) => {
                                  setInboundItems((prev) =>
                                    prev.map((p) =>
                                      p.id === f.id ? { ...p, quantity: e.target.value } : p
                                    )
                                  );
                                }}
                                className="w-full px-2 py-1 text-xs text-right rounded border border-gray-200 focus:outline-none focus:border-blue-400"
                              />
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-600">
                            {f.item.unit_cost != null ? `¥${f.item.unit_cost}` : "-"}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-600">
                            {alloc > 0 ? `¥${alloc.toFixed(2)}` : "-"}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-900 font-medium">
                            {totalCost > 0 ? `¥${totalCost.toFixed(2)}` : "-"}
                          </td>
                          <td className="px-3 py-2">
                            {f.isExcess ? (
                              <span className="text-gray-400 text-xs">-</span>
                            ) : (
                              <input
                                type="text"
                                value={f.batchNo}
                                onChange={(e) => {
                                  setInboundItems((prev) =>
                                    prev.map((p) =>
                                      p.id === f.id ? { ...p, batchNo: e.target.value } : p
                                    )
                                  );
                                }}
                                placeholder="批次号"
                                className="w-full px-2 py-1 text-xs rounded border border-gray-200 focus:outline-none focus:border-blue-400"
                              />
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {f.isExcess ? (
                              <span className="text-gray-400 text-xs">-</span>
                            ) : (
                              <select
                                value={f.warehouseId}
                                onChange={(e) => {
                                  setInboundItems((prev) =>
                                    prev.map((p) =>
                                      p.id === f.id ? { ...p, warehouseId: e.target.value } : p
                                    )
                                  );
                                }}
                                className="w-full px-1 py-1 text-xs rounded border border-gray-200 focus:outline-none focus:border-blue-400"
                              >
                                <option value="">选择仓库</option>
                                {warehouses.map((w) => (
                                  <option key={w.id} value={w.id}>{w.name}</option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {f.isExcess ? (
                              <span className="text-gray-400 text-xs">-</span>
                            ) : (
                              <input
                                type="text"
                                value={f.location}
                                onChange={(e) => {
                                  setInboundItems((prev) =>
                                    prev.map((p) =>
                                      p.id === f.id ? { ...p, location: e.target.value } : p
                                    )
                                  );
                                }}
                                placeholder="仓位"
                                className="w-full px-2 py-1 text-xs rounded border border-gray-200 focus:outline-none focus:border-blue-400"
                              />
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {f.isExcess ? (
                              <span className="text-gray-500 text-xs">{f.notes || "-"}</span>
                            ) : (
                              <input
                                type="text"
                                value={f.notes}
                                onChange={(e) => {
                                  setInboundItems((prev) =>
                                    prev.map((p) =>
                                      p.id === f.id ? { ...p, notes: e.target.value } : p
                                    )
                                  );
                                }}
                                placeholder="备注"
                                className="w-full px-2 py-1 text-xs rounded border border-gray-200 focus:outline-none focus:border-blue-400"
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-gray-50">
                    <tr>
                      <td colSpan={3} className="px-3 py-2 text-right font-medium text-gray-700">
                        合计
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-gray-900">
                        {inboundItems
                          .filter((f) => !f.isExcess)
                          .reduce((sum, f) => sum + (parseInt(f.quantity, 10) || 0), 0)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-gray-900">
                        ¥
                        {inboundItems
                          .filter((f) => !f.isExcess)
                          .reduce(
                            (sum, f) =>
                              sum + (parseInt(f.quantity, 10) || 0) * (f.item.unit_cost || 0),
                            0
                          )
                          .toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-gray-900">
                        ¥{allocatedCosts.reduce((sum, a) => sum + a, 0).toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-gray-900">
                        ¥
                        {(
                          inboundItems
                            .filter((f) => !f.isExcess)
                            .reduce(
                              (sum, f) =>
                                sum + (parseInt(f.quantity, 10) || 0) * (f.item.unit_cost || 0),
                              0
                            ) + allocatedCosts.reduce((sum, a) => sum + a, 0)
                        ).toFixed(2)}
                      </td>
                      <td colSpan={4} />
                    </tr>
                  </tfoot>
                </table>
              </div>
              {inboundItems.some((f) => f.isExcess) && (
                <div className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                  该采购单包含多发退货配件，确认入库后将自动创建
                  {
                    inboundItems.filter((f) => f.isExcess).length
                  }{" "}
                  条待退货记录
                </div>
              )}
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeInboundModal}
                  className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleConfirmInbound}
                  disabled={submitting === `complete-${inboundModalOrder.id}`}
                  className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  {submitting === `complete-${inboundModalOrder.id}` ? "处理中..." : "确认入库"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 编辑配件信息弹窗 */}
      {editItem && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-6xl my-8 relative">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <h3 className="text-base font-semibold text-gray-900">
                {editItem.part_id ? "编辑配件信息" : "新增配件信息"}
              </h3>
              <button
                type="button"
                onClick={closeEditModal}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-6">
              <PartForm
                editId={editId}
                onSaved={handlePartSaved}
                onCancel={closeEditModal}
                prefillData={配件预填}
              />
            </div>
          </div>
        </div>
      )}

      {确认弹窗}
    </div>
  );
}

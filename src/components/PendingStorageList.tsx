"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PriceValue } from "@/components/PriceVisibilityContext";
import { PartSearchDropdown } from "@/components/PartSearchDropdown";
import PartForm from "@/app/parts/new/PartForm";

function resolveImageUrl(path: string): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return path;
  return `${base}/storage/v1/object/public/work-order-media/${path}`;
}

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

/* 处理动作标签 — 与 PendingReceiptList 保持一致 */
const ACTION_LABELS: Record<string, { text: string; color: string }> = {
  normal: { text: "正常", color: "bg-green-100 text-green-700" },
  broken_exchange: { text: "破损换货", color: "bg-orange-100 text-orange-700" },
  broken_discard: { text: "破损弃货", color: "bg-orange-100 text-orange-700" },
  wrong_exchange: { text: "错发换货", color: "bg-purple-100 text-purple-700" },
  wrong_discard: { text: "错发弃货", color: "bg-purple-100 text-purple-700" },
  excess_return: { text: "多发退货", color: "bg-blue-100 text-blue-700" },
  excess_paid: { text: "多发备用·付款", color: "bg-blue-100 text-blue-700" },
  excess_free: { text: "多发备用·免费", color: "bg-blue-100 text-blue-700" },
  short_repurchase: { text: "少发补货", color: "bg-red-100 text-red-700" },
  short_discard: { text: "少发弃货", color: "bg-red-100 text-red-700" },
};

/* 哪些 action 在入库后要生成「待退货」 */
const ACTION_TO_RETURN_REASON: Record<string, string> = {
  broken_exchange: "damaged",
  broken_discard: "damaged",
  wrong_exchange: "wrong_ship",
  wrong_discard: "wrong_ship",
  excess_return: "excess",
};

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

/* 算每个 item 在生成退货记录时的数量
   - excess_return: 多出的部分 = received_qty - quantity
   - 其它退货场景: 全部数量
*/
function getReturnQty(item: PurchaseOrderItem): number {
  if (item.handle_action === "excess_return") {
    return Math.max(0, (item.received_qty ?? 0) - item.quantity);
  }
  return item.quantity;
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
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null);

  /* 编辑配件信息弹窗 */
  const [editItem, setEditItem] = useState<PurchaseOrderItem | null>(null);
  const [newPartQuery, setNewPartQuery] = useState("");

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 打开入库单确认弹窗 */
  async function openInboundModal(order: PurchaseOrder) {
    const items = order.purchase_order_items || [];
    let formIdCounter = 0;
    const forms: InboundItemForm[] = items
      .filter((it) => it.handle_action !== "wrong_discard")
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
        setWaybillInfo(wb as any);
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
      const order = inboundModalOrder;
      const items = order.purchase_order_items || [];

      /* 找出需要生成退货记录的明细 */
      const returnItems = items.filter((it) => {
        if (!it.handle_action) return false;
        return !!ACTION_TO_RETURN_REASON[it.handle_action];
      });

      /* 计算入库单总数量和总金额（含分摊运费，多发退货部分不计入） */
      const totalFreight = parseFloat(freightAmount) || 0;
      let totalQty = 0;
      let totalAmount = 0;
      for (let i = 0; i < inboundItems.length; i++) {
        const f = inboundItems[i];
        if (f.isExcess) continue;
        const q = parseInt(f.quantity, 10) || 0;
        totalQty += q;
        totalAmount += q * (f.item.unit_cost || 0) + allocatedCosts[i];
      }

      /* 1. 创建入库单 */
      const { data: inboundOrder, error: inboundErr } = await supabase
        .from("inbound_orders")
        .insert({
          purchase_order_id: orderId,
          supplier_id: order.supplier_id,
          supplier_name: order.suppliers?.name || "",
          total_quantity: totalQty,
          total_amount: totalAmount,
          freight_amount: totalFreight,
          waybill_id: order.waybill_id || null,
          status: "completed",
          notes: "",
        })
        .select("id")
        .single();
      if (inboundErr) {
        alert("创建入库单失败: " + inboundErr.message);
        setSubmitting(null);
        return;
      }

      /* 2. 创建入库单明细（跳过多发退货部分） */
      const inboundOrderId = inboundOrder.id;
      const inboundItemRows = inboundItems
        .filter((f) => !f.isExcess && (parseInt(f.quantity, 10) || 0) > 0)
        .map((f, idx) => ({
          inbound_order_id: inboundOrderId,
          purchase_order_item_id: f.item.id,
          part_id: f.item.part_id,
          part_number: f.item.part_number,
          name: f.item.name,
          brand: f.item.brand,
          specification: f.item.specification,
          unit: f.item.unit,
          quantity: parseInt(f.quantity, 10) || 0,
          unit_cost: f.item.unit_cost,
          allocated_cost: allocatedCosts[idx] || 0,
          batch_no: f.batchNo || null,
          warehouse_id: f.warehouseId || null,
          location: f.location || null,
          notes: f.notes || null,
        }));

      if (inboundItemRows.length > 0) {
        const { error: itemErr } = await supabase
          .from("inbound_order_items")
          .insert(inboundItemRows);
        if (itemErr) {
          alert("创建入库单明细失败: " + itemErr.message);
          setSubmitting(null);
          return;
        }
      }

      /* 3. 增加库存、创建批次、日志和仓位（跳过多发退货部分） */
      for (let i = 0; i < inboundItems.length; i++) {
        const f = inboundItems[i];
        if (f.isExcess) continue;
        const qty = parseInt(f.quantity, 10) || 0;
        if (qty <= 0 || !f.item.part_id) continue;

        const { data: part } = await supabase
          .from("parts")
          .select("quantity")
          .eq("id", f.item.part_id)
          .single();
        if (part) {
          const newQty = (part.quantity || 0) + qty;
          const { error: stockErr } = await supabase
            .from("parts")
            .update({ quantity: newQty })
            .eq("id", f.item.part_id);
          if (stockErr) {
            console.error(`入库增库失败(${f.item.name}):`, stockErr);
            alert(`入库增库失败(${f.item.name}): ${stockErr.message}`);
            setSubmitting(null);
            return;
          }

          /* 更新配件采购价 */
          if (f.item.unit_cost != null) {
            const { error: priceErr } = await supabase
              .from("parts")
              .update({ purchase_price: f.item.unit_cost })
              .eq("id", f.item.part_id);
            if (priceErr) {
              console.warn(`更新配件采购价失败(${f.item.name}):`, priceErr);
            }
          }
        }

        /* 更新仓位库存 */
        if (f.warehouseId) {
          const { data: existingLoc } = await supabase
            .from("part_stock_locations")
            .select("id, quantity")
            .eq("part_id", f.item.part_id)
            .eq("warehouse_id", f.warehouseId)
            .eq("location", f.location || "")
            .single();
          if (existingLoc) {
            await supabase
              .from("part_stock_locations")
              .update({ quantity: existingLoc.quantity + qty })
              .eq("id", existingLoc.id);
          } else {
            await supabase.from("part_stock_locations").insert({
              part_id: f.item.part_id,
              warehouse_id: f.warehouseId,
              location: f.location || null,
              quantity: qty,
            });
          }
        }

        /* 创建批次记录 */
        const { error: batchErr } = await supabase.from("part_batches").insert({
          part_id: f.item.part_id,
          batch_no: f.batchNo || null,
          quantity: qty,
          unit_cost: f.item.unit_cost,
          inbound_type: "purchase",
          reference_id: orderId,
          notes: f.notes || null,
        });
        if (batchErr) {
          console.warn(`创建批次记录失败(${f.item.name}):`, batchErr);
        }

        /* 创建库存日志 */
        const { error: logErr } = await supabase.from("inventory_logs").insert({
          part_id: f.item.part_id,
          change_qty: qty,
          type: "inbound",
          reference_type: "inbound_order",
          reference_id: inboundOrderId,
          notes: `采购入库: ${f.item.name}${f.batchNo ? " 批次:" + f.batchNo : ""}`,
        });
        if (logErr) {
          console.warn(`创建库存日志失败(${f.item.name}):`, logErr);
        }
      }

      /* 4. 退库：对破损/错发配件减少库存
         注意：excess_return 的多出部分未入库，无需扣减 */
      for (const it of returnItems) {
        if (it.handle_action === "excess_return") continue;
        if (it.part_id) {
          const qty = getReturnQty(it);
          if (qty > 0) {
            const { data: part } = await supabase
              .from("parts")
              .select("quantity")
              .eq("id", it.part_id)
              .single();
            if (part) {
              const newQty = Math.max(0, (part.quantity || 0) - qty);
              const { error: stockErr } = await supabase
                .from("parts")
                .update({ quantity: newQty })
                .eq("id", it.part_id);
              if (stockErr) {
                console.error(`退库失败(${it.name}):`, stockErr);
                alert(`退库失败(${it.name}): ${stockErr.message}`);
                setSubmitting(null);
                return;
              }
            }
          }
        }
      }

      /* 5. 生成应付账款记录 */
      if (inboundOrderId && order.supplier_id && totalAmount > 0) {
        const { error: txnErr } = await supabase.from("supplier_transactions").insert({
          supplier_id: order.supplier_id,
          transaction_type: "debit",
          amount: parseFloat(totalAmount.toFixed(2)),
          description: "采购入库",
          reference_id: inboundOrderId,
          reference_type: "inbound_order",
        });
        if (txnErr) {
          console.warn("生成应付账款记录失败:", txnErr);
        }
      }

      /* 6. 更新采购单状态 */
      const { error } = await supabase
        .from("purchase_orders")
        .update({ status: "completed" })
        .eq("id", orderId);
      if (error) {
        alert("操作失败: " + error.message);
        setSubmitting(null);
        return;
      }

      /* 7. 创建退货记录 */
      if (returnItems.length > 0) {
        const supplierName = order?.suppliers?.name || "";
        const returnRecords = returnItems
          .filter((it) => it.work_order_item_part_id)
          .map((it) => ({
            work_order_item_part_id: it.work_order_item_part_id!,
            return_reason: ACTION_TO_RETURN_REASON[it.handle_action!],
            quantity: getReturnQty(it),
            supplier_name: supplierName,
            photos: it.evidence_photos || [],
            status: "pending",
          }))
          .filter((rec) => rec.quantity > 0);

        if (returnRecords.length > 0) {
          const { error: retErr } = await supabase
            .from("supplier_return_records")
            .insert(returnRecords);
          if (retErr) {
            console.error("自动创建退货记录失败:", retErr);
            alert("入库成功,但自动创建退货记录失败: " + retErr.message);
          }
        }
      }

      closeInboundModal();
      loadData();
    } catch (err: any) {
      alert("操作失败: " + (err.message || String(err)));
    } finally {
      setSubmitting(null);
    }
  }

  async function handleRevokeStorage(order: PurchaseOrder) {
    if (!confirm("确认退回待收货?这会清除所有处理结果并删除已生成的待采购分支。")) return;
    setSubmitting(`revoke-${order.id}`);
    try {
      /* 1. 获取该订单下所有有 work_order_item_part_id 的明细 */
      const itemsWithPartId = order.purchase_order_items.filter((it) => it.work_order_item_part_id);
      if (itemsWithPartId.length > 0) {
        /* 查原 work_order_item_parts 的 work_order_item_id */
        const { data: originals } = await supabase
          .from("work_order_item_parts")
          .select("id, work_order_item_id")
          .in(
            "id",
            itemsWithPartId.map((it) => it.work_order_item_part_id!)
          );
        const workOrderItemIds = (originals || [])
          .map((o: any) => o.work_order_item_id)
          .filter(Boolean);
        if (workOrderItemIds.length > 0) {
          /* 删除 purchase_reason 分支 */
          const { error: delErr } = await supabase
            .from("work_order_item_parts")
            .delete()
            .in("work_order_item_id", workOrderItemIds)
            .not("purchase_reason", "is", null)
            .eq("is_purchased", false)
            .eq("is_arrived", false);
          if (delErr) console.warn("删除待采购分支失败:", delErr);
        }
      }

      /* 2. 删除该采购单生成的待退货记录 */
      if (itemsWithPartId.length > 0) {
        const { error: retDelErr } = await supabase
          .from("supplier_return_records")
          .delete()
          .in(
            "work_order_item_part_id",
            itemsWithPartId.map((it) => it.work_order_item_part_id!)
          )
          .eq("status", "pending");
        if (retDelErr) console.warn("删除待退货记录失败:", retDelErr);
      }

      /* 3. 清空所有明细处理结果 */
      const { error: clrErr } = await supabase
        .from("purchase_order_items")
        .update({
          handle_action: null,
          received_qty: null,
          discount_amount: null,
          evidence_photos: null,
        })
        .eq("order_id", order.id);
      if (clrErr) throw clrErr;

      /* 4. 订单状态改回 submitted */
      const { error: stErr } = await supabase
        .from("purchase_orders")
        .update({ status: "submitted" })
        .eq("id", order.id);
      if (stErr) throw stErr;

      /* 4. 运单回退 */
      if (order.waybill_id) {
        const { data: otherOrders } = await supabase
          .from("purchase_orders")
          .select("id")
          .eq("waybill_id", order.waybill_id)
          .eq("status", "pending_storage")
          .neq("id", order.id);
        if (!otherOrders || otherOrders.length === 0) {
          await supabase
            .from("logistics_waybills")
            .update({ status: "pending", received_at: null })
            .eq("id", order.waybill_id);
        }
      }

      loadData();
    } catch (err: any) {
      alert("退回失败: " + (err.message || String(err)));
    } finally {
      setSubmitting(null);
    }
  }

  /* 编辑配件信息 */
  function openEditModal(item: PurchaseOrderItem) {
    setNewPartQuery("");
    setEditItem(item);
  }

  function closeEditModal() {
    setNewPartQuery("");
    setEditItem(null);
  }

  async function handlePartSaved(partId: string) {
    if (!editItem) return;
    setSubmitting(`edit-${editItem.id}`);
    try {
      const { data: part } = await supabase
        .from("parts")
        .select("part_number, name, unit, category_id, part_categories(name), brand_id, part_brands(name), specification_text, purchase_price, notes, document_name")
        .eq("id", partId)
        .single();

      const poiUpdates: Record<string, any> = { part_id: partId };
      if (part) {
        if (part.part_number != null) poiUpdates.part_number = part.part_number;
        if (part.name != null) poiUpdates.name = part.name;
        if (part.unit != null) poiUpdates.unit = part.unit;
        const pc = part.part_categories as any;
        const pb = part.part_brands as any;
        const catName = Array.isArray(pc) ? pc[0]?.name : pc?.name;
        const brandName = Array.isArray(pb) ? pb[0]?.name : pb?.name;
        if (catName != null) poiUpdates.category = catName;
        if (part.brand_id != null) poiUpdates.brand = brandName || null;
        if (part.specification_text != null) poiUpdates.specification = part.specification_text;
        if (part.purchase_price != null) poiUpdates.unit_cost = part.purchase_price;
        if (part.notes != null) poiUpdates.notes = part.notes;
        if (part.document_name != null) poiUpdates.supplier_part_name = part.document_name;
      }
      const { error: poiErr } = await supabase
        .from("purchase_order_items")
        .update(poiUpdates)
        .eq("id", editItem.id);
      if (poiErr) throw poiErr;

      if (editItem.work_order_item_part_id) {
        const woiUpdates: Record<string, any> = {};
        if (part) {
          if (part.part_number != null) woiUpdates.part_number = part.part_number;
          if (part.name != null) woiUpdates.name = part.name;
          if (part.unit != null) woiUpdates.unit = part.unit;
          if (part.brand_id != null) {
            const pb = part.part_brands as any;
            woiUpdates.brand = (Array.isArray(pb) ? pb[0]?.name : pb?.name) || null;
          }
          if (part.specification_text != null) woiUpdates.specification = part.specification_text;
          if (part.purchase_price != null) woiUpdates.unit_cost = part.purchase_price;
          if (part.notes != null) woiUpdates.notes = part.notes;
          if (part.document_name != null) woiUpdates.document_name = part.document_name;
        }
        if (Object.keys(woiUpdates).length > 0) {
          const { error: woiErr } = await supabase
            .from("work_order_item_parts")
            .update(woiUpdates)
            .eq("id", editItem.work_order_item_part_id);
          if (woiErr) console.warn("同步工单配件信息失败:", woiErr);
        }
      }

      closeEditModal();
      loadData();
    } catch (err: any) {
      alert("同步配件信息失败: " + (err.message || String(err)));
    } finally {
      setSubmitting(null);
    }
  }

  /* 行内搜索选中配件（待入库阶段不更新售价） */
  async function handleInlinePartSelect(item: PurchaseOrderItem, part: any) {
    setSubmitting(`inline-${item.id}`);
    try {
      /* 已有内容保留，为空才按配件填充 */
      const poiUpdates: Record<string, any> = { part_id: part.id };
      if (part.part_number != null) poiUpdates.part_number = part.part_number;
      if (part.barcode != null && !part.part_number) poiUpdates.part_number = part.barcode;
      if (!item.name) {
        if (part.name != null) poiUpdates.name = part.name;
        else if (part.part_names?.name != null) poiUpdates.name = part.part_names.name;
      }
      if (!item.unit) {
        if (part.unit != null) poiUpdates.unit = part.unit;
        else if (part.part_names?.unit != null) poiUpdates.unit = part.part_names.unit;
      }
      if (!item.brand && part.part_brands?.name != null) poiUpdates.brand = part.part_brands.name;
      if (!item.specification && part.part_specifications?.name != null) poiUpdates.specification = part.part_specifications.name;
      if (!item.category && part.part_categories?.name != null) poiUpdates.category = part.part_categories.name;

      const { error: poiErr } = await supabase
        .from("purchase_order_items")
        .update(poiUpdates)
        .eq("id", item.id);
      if (poiErr) throw poiErr;

      /* 同步更新工单配件表 */
      if (item.work_order_item_part_id) {
        const { data: woiCurrent } = await supabase
          .from("work_order_item_parts")
          .select("name, unit, brand, specification, unit_cost, unit_price")
          .eq("id", item.work_order_item_part_id)
          .single();

        const woiUpdates: Record<string, any> = {};
        if (part.part_number != null) woiUpdates.part_number = part.part_number;
        if (!woiCurrent?.name) {
          if (part.name != null) woiUpdates.name = part.name;
        }
        if (!woiCurrent?.unit) {
          if (part.unit != null) woiUpdates.unit = part.unit;
        }
        if (!woiCurrent?.brand && part.part_brands?.name != null) woiUpdates.brand = part.part_brands.name;
        if (!woiCurrent?.specification && part.part_specifications?.name != null) woiUpdates.specification = part.part_specifications.name;

        /* 采购价：为空才填充 */
        if ((woiCurrent?.unit_cost == null || woiCurrent.unit_cost === 0) && part.unit_cost != null) {
          woiUpdates.unit_cost = part.unit_cost;
        }

        /* 售价：已报不覆盖，没有才按配件更新 */
        if (woiCurrent?.unit_price == null && part.unit_price != null) {
          woiUpdates.unit_price = part.unit_price;
        }

        if (Object.keys(woiUpdates).length > 0) {
          const { error: woiErr } = await supabase
            .from("work_order_item_parts")
            .update(woiUpdates)
            .eq("id", item.work_order_item_part_id);
          if (woiErr) console.warn("同步工单配件信息失败:", woiErr);
        }
      }

      loadData();
    } catch (err: any) {
      alert("更新配件信息失败: " + (err.message || String(err)));
    } finally {
      setSubmitting(null);
    }
  }

  async function handleInlineClear(item: PurchaseOrderItem) {
    setSubmitting(`inline-${item.id}`);
    try {
      const { error: poiErr } = await supabase
        .from("purchase_order_items")
        .update({ part_id: null, part_number: null })
        .eq("id", item.id);
      if (poiErr) throw poiErr;

      if (item.work_order_item_part_id) {
        const { error: woiErr } = await supabase
          .from("work_order_item_parts")
          .update({ part_id: null, part_number: null })
          .eq("id", item.work_order_item_part_id);
        if (woiErr) console.warn("同步清除工单配件信息失败:", woiErr);
      }

      loadData();
    } catch (err: any) {
      alert("清除配件关联失败: " + (err.message || String(err)));
    } finally {
      setSubmitting(null);
    }
  }

  function handleInlineCreateNew(item: PurchaseOrderItem, query: string) {
    setNewPartQuery(query);
    openEditModal(item);
  }

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
        <div key={g.key} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">供应商: {g.key}</h3>
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
                        const skipStorage = item.handle_action === "wrong_discard";
                        return (
                          <tr key={item.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-gray-500">{idx + 1}</td>
                            <td className="px-3 py-2">
                              <PartSearchDropdown
                                value={item.part_number || ""}
                                onChange={() => {}}
                                onSelect={(part) => handleInlinePartSelect(item, part)}
                                onCreateNew={(query) => handleInlineCreateNew(item, query)}
                                onClear={() => handleInlineClear(item)}
                                disabled={submitting === `inline-${item.id}`}
                                placeholder="编码"
                                inputClassName="w-20 border-gray-200 text-xs"
                              />
                            </td>
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
                                  <Link
                                    href={`/inventory/in?auto_fill=1&part_id=${encodeURIComponent(item.part_id)}&quantity=${encodeURIComponent(storageQty)}`}
                                    className="text-xs px-2 py-1 rounded bg-orange-50 text-orange-600 hover:bg-orange-100 inline-block"
                                  >
                                    入库登记
                                  </Link>
                                ) : (
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
                editId={editItem.part_id || undefined}
                onSaved={handlePartSaved}
                onCancel={closeEditModal}
                prefillData={{
                  part_number: newPartQuery || editItem.part_number || undefined,
                  name: editItem.name || undefined,
                  unit: editItem.unit || undefined,
                  purchase_price: editItem.unit_cost != null ? String(editItem.unit_cost) : undefined,
                  notes: editItem.notes || undefined,
                  document_name: editItem.supplier_part_name || undefined,
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

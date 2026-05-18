"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PriceValue } from "@/components/PriceVisibilityContext";
import { PartSearchDropdown } from "@/components/PartSearchDropdown";
import { ImageUploader } from "@/components/ImageUploader";
import PartForm from "@/app/parts/new/PartForm";

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

interface Waybill {
  id: string;
  tracking_no: string;
  logistics_company_name: string | null;
  supplier_name: string | null;
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

/* 处理动作标签 */
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

/* 哪些 action 在入库后要生成"待退货" */
const ACTION_TO_RETURN_REASON: Record<string, string> = {
  broken_exchange: "damaged",
  broken_discard: "damaged",
  wrong_exchange: "wrong_ship",
  wrong_discard: "wrong_ship",
  excess_return: "excess",
};

/* 哪些 action 需要生成新的"待采购"行(写回 work_order_item_parts) */
const ACTION_TO_PURCHASE_REASON: Record<string, string> = {
  broken_exchange: "broken_resupply",
  wrong_exchange: "wrong_exchange",
  short_repurchase: "short_resupply",
};

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
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null);

  /* 批量运单 */
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [batchWaybillMode, setBatchWaybillMode] = useState(false);

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
  const [wbSupplierName, setWbSupplierName] = useState("");
  const [wbPackageCount, setWbPackageCount] = useState("");
  const [wbFreight, setWbFreight] = useState("");
  const [wbCod, setWbCod] = useState("");
  const [wbPhotos, setWbPhotos] = useState<string[]>([]);
  const [wbCompanies, setWbCompanies] = useState<{ id: string; name: string; scopes?: string[] | null }[]>([]);

  /* 批量创建运单弹窗（同物流页） */
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchCompanyId, setBatchCompanyId] = useState("");
  const [batchTrackingNos, setBatchTrackingNos] = useState("");
  const [batchCount, setBatchCount] = useState("");
  const [batchSaving, setBatchSaving] = useState(false);

  /* 批量创建结果弹窗 */
  const [batchResultOpen, setBatchResultOpen] = useState(false);
  const [batchCreatedList, setBatchCreatedList] = useState<string[]>([]);

  /* 运单电话变更时实时检索供应商 */
  useEffect(() => {
    async function lookup() {
      if (!wbPhone.trim()) {
        setWbSupplierName("");
        return;
      }
      const { data } = await supabase
        .from("suppliers")
        .select("name")
        .ilike("phone", `%${wbPhone.trim()}%`)
        .limit(1);
      if (data && data.length > 0) {
        setWbSupplierName(data[0].name);
      }
    }
    lookup();
  }, [wbPhone, supabase]);

  /* 收货主弹窗 */
  const [receiveItem, setReceiveItem] = useState<PurchaseOrderItem | null>(null);
  const [receiveOrder, setReceiveOrder] = useState<PurchaseOrder | null>(null);
  const [receiveQty, setReceiveQty] = useState("");
  const [receiveProblem, setReceiveProblem] = useState<"" | "broken" | "wrong">("");

  /* 破损处理选项 */
  const [brokenChoice, setBrokenChoice] = useState<"" | "exchange" | "discard">("");
  const [brokenEvidence, setBrokenEvidence] = useState<string[]>([]);

  /* 错发处理选项 */
  const [wrongChoice, setWrongChoice] = useState<"" | "exchange" | "discard">("");

  /* 多发处理选项 */
  const [excessChoice, setExcessChoice] = useState<"" | "return" | "keep">("");
  const [excessKeepPaid, setExcessKeepPaid] = useState<"" | "paid" | "free">("");

  /* 少发处理选项 */
  const [shortChoice, setShortChoice] = useState<"" | "repurchase" | "discard">("");
  const [shortEvidence, setShortEvidence] = useState<string[]>([]);

  /* 编辑配件信息弹窗 */
  const [editItem, setEditItem] = useState<PurchaseOrderItem | null>(null);
  const [newPartQuery, setNewPartQuery] = useState("");

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
          unit, category, license_plate, photos, notes, handle_action,
          discount_amount, evidence_photos, return_reason
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
    /* 只显示还有未处理明细的订单 */
    const filtered = rawOrders.filter((order) => {
      const items = order.purchase_order_items || [];
      return items.some((it) => !it.handle_action);
    });
    setOrders(filtered);
    setLoading(false);
  }

  function orderNeedsWaybill(order: PurchaseOrder): boolean {
    const region = order.suppliers?.region;
    if (!region) return false;
    return region !== "local";
  }

  function getReceiptStatus(order: PurchaseOrder): { label: string; color: string } {
    const items = order.purchase_order_items;
    if (items.length === 0) return { label: "未到货", color: "bg-gray-100 text-gray-600" };
    const allHandled = items.every((it) => !!it.handle_action);
    if (allHandled) return { label: "全部已处理", color: "bg-green-100 text-green-700" };
    const anyHandled = items.some((it) => !!it.handle_action);
    if (anyHandled) return { label: "部分已处理", color: "bg-orange-100 text-orange-700" };
    return { label: "未收货", color: "bg-gray-100 text-gray-600" };
  }

  /* ------------------ 收货主弹窗 ------------------ */

  function openReceiveModal(order: PurchaseOrder, item: PurchaseOrderItem) {
    const needsWaybill = orderNeedsWaybill(order);
    if (needsWaybill && !order.waybill_id) {
      alert("外阜供货商需先关联运单后才能收货");
      return;
    }
    setReceiveOrder(order);
    setReceiveItem(item);
    setReceiveQty(item.quantity === 1 ? "1" : "");
    setReceiveProblem("");
    setBrokenChoice("");
    setBrokenEvidence([]);
    setWrongChoice("");
    setExcessChoice("");
    setExcessKeepPaid("");
    setShortChoice("");
    setShortEvidence([]);
  }

  function closeReceiveModal() {
    setReceiveOrder(null);
    setReceiveItem(null);
    setReceiveQty("");
    setReceiveProblem("");
    setBrokenChoice("");
    setBrokenEvidence([]);
    setWrongChoice("");
    setExcessChoice("");
    setExcessKeepPaid("");
    setShortChoice("");
    setShortEvidence([]);
  }

  async function handleReceiveSubmit() {
    if (!receiveItem || !receiveOrder) return;

    const qtyRaw = receiveQty.trim();
    if (!qtyRaw) {
      alert("请填写实际到货数量(没到货请填 0)");
      return;
    }
    const qty = parseInt(qtyRaw, 10);
    if (isNaN(qty) || qty < 0) {
      alert("到货数量必须 ≥ 0");
      return;
    }
    const ordered = receiveItem.quantity;

    if (qty === ordered) {
      /* 数量正常 → 看是否有问题反馈 */
      if (receiveProblem === "broken") {
        if (!brokenChoice) {
          alert("请选择破损处理方式");
          return;
        }
        const action = brokenChoice === "exchange" ? "broken_exchange" : "broken_discard";
        await applyAction(receiveOrder, receiveItem, {
          handle_action: action,
          received_qty: qty,
          evidence_photos: brokenEvidence.length > 0 ? brokenEvidence : null,
        });
      } else if (receiveProblem === "wrong") {
        if (!wrongChoice) {
          alert("请选择错发处理方式");
          return;
        }
        const action = wrongChoice === "exchange" ? "wrong_exchange" : "wrong_discard";
        const recvQty = wrongChoice === "exchange" ? qty : 0;
        await applyAction(receiveOrder, receiveItem, {
          handle_action: action,
          received_qty: recvQty,
        });
      } else {
        /* 正常 */
        await applyAction(receiveOrder, receiveItem, {
          handle_action: "normal",
          received_qty: qty,
        });
      }
    } else if (qty > ordered) {
      /* 多发 */
      if (!excessChoice) {
        alert("请选择多发处理方式");
        return;
      }
      if (excessChoice === "keep" && !excessKeepPaid) {
        alert("请选择是否对供应商付款");
        return;
      }
      const action =
        excessChoice === "return" ? "excess_return" :
        excessKeepPaid === "paid" ? "excess_paid" : "excess_free";
      await applyAction(receiveOrder, receiveItem, {
        handle_action: action,
        received_qty: qty,
      });
    } else {
      /* 少发 */
      if (!shortChoice) {
        alert("请选择少发处理方式");
        return;
      }

      if (shortChoice === "repurchase") {
        /* 少发补货: qty=0 全部重新采购; qty>0 按实际入库,差额重新采购 */
        await applyAction(receiveOrder, receiveItem, {
          handle_action: "short_repurchase",
          received_qty: qty,
        });
      } else {
        /* 不需要了 */
        if (shortEvidence.length === 0) {
          if (!confirm("少发弃货建议上传聊天截图作为凭证,确定不上传吗?")) return;
        }
        if (qty === 0) {
          /* 完全没到 → 删除采购明细和工单配件 */
          if (!confirm("确认删除该配件?这会同时清除采购流程和工单中的记录。")) return;
          setSubmitting(`item-${receiveItem.id}`);
          try {
            /* 删除采购单明细 */
            const { error: delPoiErr } = await supabase
              .from("purchase_order_items")
              .delete()
              .eq("id", receiveItem.id);
            if (delPoiErr) throw delPoiErr;

            /* 如果有工单配件关联,删除工单配件 */
            if (receiveItem.work_order_item_part_id) {
              const { error: delWoiErr } = await supabase
                .from("work_order_item_parts")
                .delete()
                .eq("id", receiveItem.work_order_item_part_id);
              if (delWoiErr) console.warn("删除工单配件失败:", delWoiErr);
            }

            /* 检查采购单剩余明细 */
            const { data: remainingItems } = await supabase
              .from("purchase_order_items")
              .select("id, handle_action")
              .eq("order_id", receiveOrder.id);
            if (!remainingItems || remainingItems.length === 0) {
              /* 没有明细了,删除采购单 */
              await supabase.from("purchase_orders").delete().eq("id", receiveOrder.id);
            } else {
              /* 还有明细,重新判断状态 */
              const anyUnhandled = remainingItems.some((it: any) => !it.handle_action);
              const anyHandled = remainingItems.some((it: any) => !!it.handle_action);
              const newStatus = anyHandled && anyUnhandled ? "partial_received" : anyHandled ? "pending_storage" : "submitted";
              await supabase.from("purchase_orders").update({ status: newStatus }).eq("id", receiveOrder.id);
            }
            loadData();
          } catch (err: any) {
            alert("删除失败: " + (err.message || String(err)));
          } finally {
            setSubmitting(null);
          }
          closeReceiveModal();
          return;
        } else {
          /* 到了一部分 → 按实际数量入库 */
          await applyAction(receiveOrder, receiveItem, {
            handle_action: "short_discard",
            received_qty: qty,
            evidence_photos: shortEvidence,
          });
        }
      }
    }

    closeReceiveModal();
  }

  /* ------------------ 写入逻辑 ------------------ */

  async function applyAction(
    order: PurchaseOrder,
    item: PurchaseOrderItem,
    payload: {
      handle_action: string;
      received_qty: number;
      evidence_photos?: string[] | null;
    }
  ) {
    setSubmitting(`item-${item.id}`);
    try {
      const updates: Record<string, any> = {
        handle_action: payload.handle_action,
        received_qty: payload.received_qty,
      };
      if (payload.evidence_photos !== undefined) updates.evidence_photos = payload.evidence_photos;

      const { error: updErr } = await supabase
        .from("purchase_order_items")
        .update(updates)
        .eq("id", item.id);
      if (updErr) throw updErr;

      /* 需要生成新待采购的 action → 复制 work_order_item_parts 行 */
      const purchaseReason = ACTION_TO_PURCHASE_REASON[payload.handle_action];
      if (purchaseReason && item.work_order_item_part_id) {
        await createPurchaseReasonBranch(item, purchaseReason, payload.handle_action, payload.received_qty);
      }

      /* 检查整单是否所有明细都已处理 */
      const { data: freshItems, error: freshErr } = await supabase
        .from("purchase_order_items")
        .select("id, handle_action")
        .eq("order_id", order.id);
      if (freshErr) throw freshErr;
      const allHandled = (freshItems || []).every((it: any) => !!it.handle_action);

      if (allHandled) {
        const { error: statusErr } = await supabase
          .from("purchase_orders")
          .update({ status: "pending_storage" })
          .eq("id", order.id);
        if (statusErr) throw statusErr;
        /* 运单标记为已签收 */
        if (order.waybill_id) {
          const { error: wbErr } = await supabase
            .from("logistics_waybills")
            .update({ status: "received", received_at: new Date().toISOString() })
            .eq("id", order.waybill_id);
          if (wbErr) console.warn("运单状态更新失败:", wbErr);
        }
      } else {
        /* 部分处理状态 */
        const { error: partialErr } = await supabase
          .from("purchase_orders")
          .update({ status: "partial_received" })
          .eq("id", order.id);
        if (partialErr) throw partialErr;
      }

      loadData();
    } catch (err: any) {
      alert("收货失败: " + (err.message || String(err)));
    } finally {
      setSubmitting(null);
    }
  }

  /* ------------------ 撤销收货 ------------------ */

  async function handleRevokeItem(order: PurchaseOrder, item: PurchaseOrderItem) {
    if (!confirm("确认撤销该配件的收货处理?")) return;
    setSubmitting(`revoke-${item.id}`);
    try {
      /* 1. 清空明细处理结果 */
      const { error: clrErr } = await supabase
        .from("purchase_order_items")
        .update({
          handle_action: null,
          received_qty: null,
          discount_amount: null,
          evidence_photos: null,
        })
        .eq("id", item.id);
      if (clrErr) throw clrErr;

      /* 2. 如果之前有生成待采购分支,删除它 */
      if (item.handle_action && item.work_order_item_part_id) {
        const purchaseReason = ACTION_TO_PURCHASE_REASON[item.handle_action];
        if (purchaseReason) {
          const { data: original } = await supabase
            .from("work_order_item_parts")
            .select("work_order_item_id")
            .eq("id", item.work_order_item_part_id)
            .single();
          if (original) {
            const { error: delErr } = await supabase
              .from("work_order_item_parts")
              .delete()
              .eq("work_order_item_id", original.work_order_item_id)
              .eq("purchase_reason", purchaseReason)
              .eq("is_purchased", false)
              .eq("is_arrived", false);
            if (delErr) console.warn("删除待采购分支失败:", delErr);
          }
        }
      }

      /* 3. 重算订单状态 */
      const { data: freshItems } = await supabase
        .from("purchase_order_items")
        .select("handle_action")
        .eq("order_id", order.id);
      const anyHandled = (freshItems || []).some((it: any) => !!it.handle_action);
      const newStatus = anyHandled ? "partial_received" : "submitted";

      const { error: stErr } = await supabase
        .from("purchase_orders")
        .update({ status: newStatus })
        .eq("id", order.id);
      if (stErr) throw stErr;

      /* 4. 如果订单从 pending_storage 回退,且运单下没有其它 pending_storage 订单,回退运单 */
      if (order.status === "pending_storage" && order.waybill_id) {
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
      alert("撤销失败: " + (err.message || String(err)));
    } finally {
      setSubmitting(null);
    }
  }

  /* ------------------ 编辑配件信息 ------------------ */

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
      /* 1. 从 parts 表读取最新数据 */
      const { data: part } = await supabase
        .from("parts")
        .select("part_number, name, unit, category_id, part_categories(name), brand_id, part_brands(name), specification_text, purchase_price, notes, document_name")
        .eq("id", partId)
        .single();

      /* 2. 更新采购单明细 */
      const poiUpdates: Record<string, any> = {
        part_id: partId,
      };
      if (part) {
        if (part.part_number != null) poiUpdates.part_number = part.part_number;
        if (part.name != null) poiUpdates.name = part.name;
        if (part.unit != null) poiUpdates.unit = part.unit;
        if (part.part_categories?.name != null) poiUpdates.category = part.part_categories.name;
        if (part.brand_id != null) poiUpdates.brand = part.part_brands?.name || null;
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

      /* 3. 同步更新工单配件表（不更新售价） */
      if (editItem.work_order_item_part_id) {
        const woiUpdates: Record<string, any> = {};
        if (part) {
          if (part.part_number != null) woiUpdates.part_number = part.part_number;
          if (part.name != null) woiUpdates.name = part.name;
          if (part.unit != null) woiUpdates.unit = part.unit;
          if (part.brand_id != null) woiUpdates.brand = part.part_brands?.name || null;
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

  /* 行内搜索选中配件（待收货阶段不更新售价） */
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
        /* 先查当前值，保留已有内容 */
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

  /* 创建一条新的 work_order_item_parts 行(复制原行,带 purchase_reason 标签) */
  async function createPurchaseReasonBranch(
    item: PurchaseOrderItem,
    purchaseReason: string,
    handleAction: string,
    receivedQty: number
  ) {
    if (!item.work_order_item_part_id) return;
    /* 查原 work_order_item_parts 行,克隆字段 */
    const { data: original } = await supabase
      .from("work_order_item_parts")
      .select("*")
      .eq("id", item.work_order_item_part_id)
      .single();
    if (!original) return;

    /* 少发补货数量 = 订购数 - 实际到货数,其他场景沿用原数量 */
    let qty = original.quantity;
    if (handleAction === "short_repurchase") {
      qty = item.quantity - receivedQty;
      if (qty <= 0) return;
    }

    const newRow: Record<string, any> = {
      work_order_item_id: original.work_order_item_id,
      part_name_id: original.part_name_id,
      part_id: original.part_id,
      part_number: original.part_number,
      name: original.name,
      alias_name: original.alias_name,
      unit: original.unit,
      brand: original.brand,
      specification: original.specification,
      unit_cost: original.unit_cost,
      unit_price: original.unit_price,
      quantity: qty,
      customer_opinion: "agree",
      is_purchased: false,
      is_arrived: false,
      supplier_name: original.supplier_name,
      logistics_agreement: original.logistics_agreement,
      notes: original.notes,
      purchase_reason: purchaseReason,
    };
    await supabase.from("work_order_item_parts").insert(newRow);
  }

  /* ------------------ 供应商过滤 ------------------ */

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
      const qty = (o.purchase_order_items || [])
        .filter((it) => !it.handle_action)
        .reduce((sum, it) => sum + it.quantity, 0);
      map.set(name, (map.get(name) || 0) + qty);
    }
    return map;
  }, [orders]);

  const filteredOrders = useMemo(() => {
    if (!supplierFilter) return orders;
    return orders.filter((o) => (o.suppliers?.name || "未指定供应商") === supplierFilter);
  }, [orders, supplierFilter]);

  /* ------------------ 分组 ------------------ */

  const displayGroups = useMemo(() => {
    const map = new Map<string, PurchaseOrder[]>();
    for (const o of filteredOrders) {
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
  }, [filteredOrders, groupBy]);

  /* ------------------ 运单弹窗 ------------------ */

  async function openWaybillModal(orderId: string) {
    setWaybillModalFor(orderId);
    setWaybillLoading(true);
    const { data } = await supabase
      .from("logistics_waybills")
      .select("id, tracking_no, logistics_company_name, supplier_name, freight_amount, cod_amount, status, logistics_companies(name)")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    const waybills = ((data || []) as unknown) as Waybill[];
    /* 把与当前采购单供应商匹配的运单排在前面 */
    const order = orders.find((o) => o.id === orderId);
    const targetSupplier = order?.suppliers?.name;
    if (targetSupplier) {
      waybills.sort((a, b) => {
        const aMatch = a.supplier_name === targetSupplier ? 1 : 0;
        const bMatch = b.supplier_name === targetSupplier ? 1 : 0;
        return bMatch - aMatch;
      });
    }
    setPendingWaybills(waybills);
    setWaybillLoading(false);
  }

  function closeWaybillModal() {
    setWaybillModalFor(null);
    setPendingWaybills([]);
    if (batchWaybillMode) setBatchWaybillMode(false);
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
    setWbPackageCount("");
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
    setWbSupplierName("");
    setWbPackageCount("");
    setWbFreight("");
    setWbCod("");
    setWbPhotos([]);
    if (batchWaybillMode) setBatchWaybillMode(false);
  }

  async function handleCreateWaybill() {
    if (!wbTrackingNo.trim()) {
      alert("请填写运单号");
      return;
    }
    /* 模式识别: 批量 / 独立(不关联采购单) / 单张 */
    const isBatch = batchWaybillMode && selectedOrderIds.size > 0;
    const isStandalone = !batchWaybillMode && !createWaybillOrder;
    if (!isBatch && !isStandalone && !createWaybillOrder) return;

    if (!wbPackageCount.trim() || isNaN(parseInt(wbPackageCount)) || parseInt(wbPackageCount) <= 0) {
      alert("请填写件数");
      return;
    }
    if (wbFreight.trim() === "" || isNaN(parseFloat(wbFreight))) {
      alert("请填写运费金额");
      return;
    }
    if (wbCod.trim() === "" || isNaN(parseFloat(wbCod))) {
      alert("请填写代收金额");
      return;
    }

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

      if (isBatch) {
        /* 批量创建运单后自动关联到选中的采购单 */
        const { error: assocErr } = await supabase
          .from("purchase_orders")
          .update({ waybill_id: waybill.id })
          .in("id", Array.from(selectedOrderIds));
        if (assocErr) throw assocErr;
        alert(`运单创建成功，已自动关联 ${selectedOrderIds.size} 张采购单`);
        setSelectedOrderIds(new Set());
        setBatchWaybillMode(false);
      } else if (isStandalone) {
        alert("运单创建成功,请用「批量关联运单」或各单「选择已有运单」进行关联");
      } else {
        await supabase
          .from("purchase_orders")
          .update({ waybill_id: waybill.id })
          .eq("id", createWaybillOrder!.id);
        alert("运单创建成功");
      }

      closeCreateWaybillModal();
      loadData();
    } catch (err: any) {
      alert("创建运单失败: " + (err.message || String(err)));
    } finally {
      setSubmitting(null);
    }
  }

  async function handleAssignWaybill(waybillId: string) {
    if (batchWaybillMode && selectedOrderIds.size > 0) {
      /* 批量关联 */
      const { error } = await supabase
        .from("purchase_orders")
        .update({ waybill_id: waybillId })
        .in("id", Array.from(selectedOrderIds));
      if (error) {
        alert("批量关联运单失败: " + error.message);
        return;
      }
      setSelectedOrderIds(new Set());
      setBatchWaybillMode(false);
      closeWaybillModal();
      loadData();
      return;
    }
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

  /* 批量运单弹窗 */
  async function openBatchWaybillModal() {
    if (selectedOrderIds.size === 0) {
      alert("请先勾选需要关联运单的采购单");
      return;
    }
    setBatchWaybillMode(true);
    setWaybillModalFor("batch");
    setWaybillLoading(true);
    const { data } = await supabase
      .from("logistics_waybills")
      .select("id, tracking_no, logistics_company_name, supplier_name, freight_amount, cod_amount, status, logistics_companies(name)")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    const waybills = ((data || []) as unknown) as Waybill[];
    /* 把与已选采购单供应商匹配的运单排在前面 */
    const targetSuppliers = new Set<string>();
    for (const o of orders) {
      if (selectedOrderIds.has(o.id) && o.suppliers?.name) {
        targetSuppliers.add(o.suppliers.name);
      }
    }
    if (targetSuppliers.size > 0) {
      waybills.sort((a, b) => {
        const aMatch = targetSuppliers.has(a.supplier_name || "") ? 1 : 0;
        const bMatch = targetSuppliers.has(b.supplier_name || "") ? 1 : 0;
        return bMatch - aMatch;
      });
    }
    setPendingWaybills(waybills);
    setWaybillLoading(false);
  }

  function openBatchCreateWaybillModal() {
    setBatchModalOpen(true);
    setBatchTrackingNos("");
    setBatchCount("");
    setBatchCompanyId("");
    if (wbCompanies.length === 0) {
      supabase
        .from("logistics_companies")
        .select("id, name, scopes")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true })
        .then(({ data }) => setWbCompanies(data || []));
    }
  }

  async function handleBatchCreate() {
    if (!batchCompanyId) {
      alert("请选择物流公司");
      return;
    }

    const lines = batchTrackingNos
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    let trackingNos: string[] = [];

    if (lines.length > 0) {
      trackingNos = lines;
    } else {
      const count = parseInt(batchCount, 10);
      if (isNaN(count) || count <= 0) {
        alert("请至少输入一个物流单号，或填写创建数量");
        return;
      }
      for (let i = 0; i < count; i++) {
        trackingNos.push(generateTrackingNo() + `-${i + 1}`);
      }
    }

    setBatchSaving(true);
    const company = wbCompanies.find((c) => c.id === batchCompanyId);
    const records = trackingNos.map((trackingNo) => ({
      tracking_no: trackingNo,
      logistics_company_id: batchCompanyId || null,
      logistics_company_name: company?.name || null,
      status: "pending" as const,
    }));

    const { error } = await supabase.from("logistics_waybills").insert(records);
    setBatchSaving(false);
    if (error) {
      alert("批量创建失败: " + error.message);
      return;
    }
    setBatchModalOpen(false);
    setBatchTrackingNos("");
    setBatchCount("");
    setBatchCompanyId("");
    setBatchCreatedList(trackingNos);
    setBatchResultOpen(true);
  }

  /*  standalone 创建运单(不关联任何采购单,创建后手动关联) */
  function openStandaloneCreateWaybillModal() {
    setBatchWaybillMode(false);
    setCreateWaybillOrder(null);
    setWbTrackingNo(generateTrackingNo());
    setWbCompanyId("");
    setWbPhone("");
    setWbPackageCount("");
    setWbFreight("");
    setWbCod("");
    setWbPhotos([]);
    setShowCreateWaybillModal(true);
    supabase
      .from("logistics_companies")
      .select("id, name, scopes")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .then(({ data }) => setWbCompanies(data || []));
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
      <div className="flex items-center gap-2 flex-wrap">
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
        {supplierOptions.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap ml-3">
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
        <div className="flex-1" />
        {selectedOrderIds.size > 0 && (
          <span className="text-xs text-blue-600">已选 {selectedOrderIds.size} 张</span>
        )}
        <button
          type="button"
          onClick={openBatchWaybillModal}
          disabled={selectedOrderIds.size === 0}
          className="px-3 py-1 text-xs rounded border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          批量关联运单
        </button>
        <button
          type="button"
          onClick={openBatchCreateWaybillModal}
          className="px-3 py-1 text-xs rounded border border-green-300 text-green-700 bg-green-50 hover:bg-green-100"
        >
          批量创建运单
        </button>
        <button
          type="button"
          onClick={openStandaloneCreateWaybillModal}
          className="px-3 py-1 text-xs rounded border border-gray-300 text-gray-700 bg-white hover:bg-gray-50"
        >
          创建运单
        </button>
        {selectedOrderIds.size > 0 && (
          <button
            type="button"
            onClick={() => setSelectedOrderIds(new Set())}
            className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
          >
            取消全选
          </button>
        )}
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
                    {needsWaybill && (
                      <input
                        type="checkbox"
                        checked={selectedOrderIds.has(order.id)}
                        onChange={() => {
                          setSelectedOrderIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(order.id)) next.delete(order.id);
                            else next.add(order.id);
                            return next;
                          });
                        }}
                        className="rounded"
                      />
                    )}
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
                          onClick={() => openWaybillModal(order.id)}
                          className="px-2 py-0.5 text-xs rounded border border-gray-200 text-gray-600 bg-white hover:bg-gray-50"
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
                          <th className="px-2 py-2 text-left font-medium text-gray-500 w-10 whitespace-nowrap">序号</th>
                          <th className="px-2 py-2 text-left font-medium text-gray-500 w-24 whitespace-nowrap">零件编码</th>
                          <th className="px-2 py-2 text-left font-medium text-gray-500 min-w-[140px] whitespace-nowrap">商品名称</th>
                          <th className="px-2 py-2 text-left font-medium text-gray-500 w-24 whitespace-nowrap">单据名称</th>
                          <th className="px-2 py-2 text-right font-medium text-gray-500 w-14 whitespace-nowrap">订购数</th>
                          <th className="px-2 py-2 text-left font-medium text-gray-500 w-10 whitespace-nowrap">单位</th>
                          <th className="px-2 py-2 text-left font-medium text-gray-500 w-16 whitespace-nowrap">分类</th>
                          <th className="px-2 py-2 text-left font-medium text-gray-500 w-28 whitespace-nowrap">备注</th>
                          <th className="px-2 py-2 text-left font-medium text-gray-500 w-14 whitespace-nowrap">图片</th>
                          <th className="px-2 py-2 text-left font-medium text-gray-500 w-24 whitespace-nowrap">车牌</th>
                          <th className="px-2 py-2 text-center font-medium text-gray-500 w-24 whitespace-nowrap">处理结果</th>
                          <th className="px-2 py-2 text-center font-medium text-gray-500 w-24 whitespace-nowrap">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {order.purchase_order_items.map((item, idx) => {
                          const actionInfo = item.handle_action ? ACTION_LABELS[item.handle_action] : null;
                          return (
                            <tr key={item.id} className="hover:bg-gray-50">
                              <td className="px-2 py-2 text-gray-500">{idx + 1}</td>
                              <td className="px-2 py-2">
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
                              <td className="px-2 py-2">
                                <div className="text-gray-900 font-medium truncate" title={item.name}>{item.name}</div>
                                {item.brand || item.specification ? (
                                  <div className="text-xs text-gray-400 truncate">
                                    {item.brand || ""} {item.specification || ""}
                                  </div>
                                ) : null}
                              </td>
                              <td className="px-2 py-2 text-gray-700 truncate max-w-[96px]" title={item.supplier_part_name || ""}>{item.supplier_part_name || "-"}</td>
                              <td className="px-2 py-2 text-right text-gray-700">{item.quantity}</td>
                              <td className="px-2 py-2 text-gray-700">{item.unit || "-"}</td>
                              <td className="px-2 py-2 text-gray-700 truncate max-w-[64px]" title={item.category || ""}>{item.category || "-"}</td>
                              <td
                                className="px-2 py-2 text-gray-700 truncate max-w-[112px]"
                                title={item.notes || ""}
                              >
                                {item.notes || "-"}
                              </td>
                              <td className="px-2 py-2">
                                {item.photos && item.photos.length > 0 ? (
                                  <div className="flex gap-1">
                                    {item.photos.slice(0, 2).map((p, i) => (
                                      <img
                                        key={i}
                                        src={resolveImageUrl(p)}
                                        alt=""
                                        className="w-7 h-7 object-cover rounded border border-gray-100"
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
                              <td className="px-2 py-2 text-gray-700 truncate max-w-[96px]" title={item.license_plate || ""}>{item.license_plate || "-"}</td>
                              <td className="px-2 py-2 text-center">
                                {actionInfo ? (
                                  <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${actionInfo.color}`}>
                                    {actionInfo.text}
                                  </span>
                                ) : (
                                  <span className="text-xs text-gray-400">待处理</span>
                                )}
                              </td>
                              <td className="px-2 py-2 text-center">
                                <div className="flex items-center gap-1">
                                  {actionInfo ? (
                                    <button
                                      type="button"
                                      onClick={() => handleRevokeItem(order, item)}
                                      disabled={submitting === `revoke-${item.id}`}
                                      className="px-2 py-1 text-xs rounded border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-50 whitespace-nowrap"
                                    >
                                      {submitting === `revoke-${item.id}` ? "撤销中..." : "撤销"}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => openReceiveModal(order, item)}
                                      disabled={!canConfirm || submitting === `item-${item.id}`}
                                      title={!canConfirm ? "外阜供货商需先关联运单" : undefined}
                                      className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
                                    >
                                      收货
                                    </button>
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
              <h3 className="text-base font-semibold text-gray-900">{batchWaybillMode ? "批量关联运单" : "选择运单"}</h3>
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
                      <th className="px-4 py-2 text-left font-medium text-gray-500">供货商</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-500">运费</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-500">代收款</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-500">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(() => {
                      const targetSupplier =
                        !batchWaybillMode && waybillModalFor && waybillModalFor !== "batch"
                          ? orders.find((o) => o.id === waybillModalFor)?.suppliers?.name
                          : null;
                      const targetSuppliers = batchWaybillMode
                        ? new Set(
                            orders
                              .filter((o) => selectedOrderIds.has(o.id))
                              .map((o) => o.suppliers?.name)
                              .filter(Boolean) as string[]
                          )
                        : null;
                      return pendingWaybills.map((w) => {
                        const isMatch = batchWaybillMode
                          ? targetSuppliers?.has(w.supplier_name || "")
                          : w.supplier_name === targetSupplier;
                        return (
                          <tr
                            key={w.id}
                            className={`hover:bg-gray-50 ${isMatch ? "bg-blue-50" : ""}`}
                          >
                            <td className="px-4 py-2 text-gray-900 font-medium">{w.tracking_no}</td>
                            <td className="px-4 py-2 text-gray-600">
                              {w.logistics_companies?.name || w.logistics_company_name || "-"}
                            </td>
                            <td className="px-4 py-2">
                              {w.supplier_name ? (
                                <span className={isMatch ? "text-blue-700 font-medium" : "text-gray-600"}>
                                  {w.supplier_name}
                                </span>
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
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
                        );
                      });
                    })()}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 创建运单弹窗 */}
      {showCreateWaybillModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">{batchWaybillMode ? "批量创建运单" : "创建运单"}</h3>
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
                    placeholder="输入电话自动检索供应商"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">供应商</label>
                  <input
                    type="text"
                    value={wbSupplierName}
                    onChange={(e) => setWbSupplierName(e.target.value)}
                    placeholder={wbPhone.trim() ? "输入电话自动检索或手动填写" : "输入电话后自动显示"}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
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

      {/* 批量创建运单弹窗 */}
      {batchModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">批量创建运单</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  物流公司 <span className="text-red-500">*</span>
                </label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={batchCompanyId}
                  onChange={(e) => setBatchCompanyId(e.target.value)}
                >
                  <option value="">请选择</option>
                  {wbCompanies.filter((c) => !c.scopes || c.scopes.length === 0 || c.scopes.includes("harbin")).length > 0 && (
                    <optgroup label="哈市物流（哈市供应商）">
                      {wbCompanies.filter((c) => !c.scopes || c.scopes.length === 0 || c.scopes.includes("harbin")).map((c) => (
                        <option key={`harbin-${c.id}`} value={c.id}>{c.name}</option>
                      ))}
                    </optgroup>
                  )}
                  {wbCompanies.filter((c) => c.scopes?.includes("outside")).length > 0 && (
                    <optgroup label="外阜快递（外阜供应商）">
                      {wbCompanies.filter((c) => c.scopes?.includes("outside")).map((c) => (
                        <option key={`outside-${c.id}`} value={c.id}>{c.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  创建数量
                  <span className="ml-2 text-xs text-gray-400">（不知道单号时填写，自动生成）</span>
                </label>
                <input
                  type="number"
                  min={1}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={batchCount}
                  onChange={(e) => setBatchCount(e.target.value)}
                  placeholder="例如：5"
                />
              </div>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-2 bg-white text-gray-400">或者填写具体单号</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  物流单号
                  <span className="ml-2 text-xs text-gray-400">（每行一个，优先使用）</span>
                </label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={6}
                  value={batchTrackingNos}
                  onChange={(e) => setBatchTrackingNos(e.target.value)}
                  placeholder={`请输入物流单号，每行一个，例如：\nSF1234567890\nSF1234567891\nSF1234567892`}
                />
                {batchTrackingNos && (
                  <div className="mt-1 text-xs text-gray-500">
                    共 {batchTrackingNos.split("\n").filter((l) => l.trim().length > 0).length} 个单号
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={() => {
                  setBatchModalOpen(false);
                  setBatchTrackingNos("");
                  setBatchCount("");
                  setBatchCompanyId("");
                }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleBatchCreate}
                disabled={batchSaving}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {batchSaving ? "创建中..." : "确定创建"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 批量创建结果弹窗 */}
      {batchResultOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">批量创建成功</h3>
              <button
                type="button"
                onClick={() => setBatchResultOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <p className="text-sm text-gray-600 mb-3">共创建 {batchCreatedList.length} 个运单，请去物流页面补充电话、供货商等信息：</p>
              <div className="space-y-2">
                {batchCreatedList.map((no) => (
                  <div
                    key={no}
                    className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg text-sm"
                  >
                    <span className="font-medium text-gray-900">{no}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setBatchResultOpen(false)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                关闭
              </button>
              <Link
                href="/logistics"
                onClick={() => setBatchResultOpen(false)}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                去物流页面完善
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* 收货主弹窗 */}
      {receiveItem && receiveOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">收货</h3>
              <button
                type="button"
                onClick={closeReceiveModal}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="text-sm text-gray-700">
                配件:<span className="font-medium ml-1">{receiveItem.name}</span>
                <span className="text-xs text-gray-500 ml-2">订购 {receiveItem.quantity} {receiveItem.unit || ""}</span>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">实际到货数量</label>
                <input
                  type="number"
                  min={0}
                  value={receiveQty}
                  onChange={(e) => setReceiveQty(e.target.value)}
                  placeholder="没到货请填 0"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                {(() => {
                  const qty = receiveQty.trim() === "" ? null : parseInt(receiveQty.trim(), 10);
                  if (qty === null || isNaN(qty)) return null;
                  const ordered = receiveItem.quantity;
                  if (qty === ordered) {
                    return <p className="text-xs text-green-600 mt-1">数量正常,可直接确认收货</p>;
                  }
                  if (qty > ordered) {
                    return <p className="text-xs text-blue-600 mt-1">多发 {qty - ordered} 件,请在下方选择处理方式</p>;
                  }
                  return <p className="text-xs text-red-600 mt-1">少发 {ordered - qty} 件,请在下方选择处理方式</p>;
                })()}
              </div>

              {(() => {
                const qty = receiveQty.trim() === "" ? null : parseInt(receiveQty.trim(), 10);
                const ordered = receiveItem.quantity;
                if (qty === null || isNaN(qty)) return null;

                /* 数量正常 → 显示破损/错发 */
                if (qty === ordered) {
                  return (
                    <div className="border-t border-gray-100 pt-3">
                      <div className="text-xs text-gray-500 mb-2">反馈问题(可选,二选一)</div>
                      <div className="flex gap-3">
                        <label className="flex items-center gap-2 cursor-pointer flex-1 px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">
                          <input
                            type="radio"
                            name="receiveProblem"
                            checked={receiveProblem === "broken"}
                            onChange={() => setReceiveProblem(receiveProblem === "broken" ? "" : "broken")}
                          />
                          <span className="text-sm text-gray-900">配件破损</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer flex-1 px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">
                          <input
                            type="radio"
                            name="receiveProblem"
                            checked={receiveProblem === "wrong"}
                            onChange={() => setReceiveProblem(receiveProblem === "wrong" ? "" : "wrong")}
                          />
                          <span className="text-sm text-gray-900">配件错发</span>
                        </label>
                      </div>
                      {receiveProblem && (
                        <button
                          type="button"
                          onClick={() => {
                            setReceiveProblem("");
                            setBrokenChoice("");
                            setBrokenEvidence([]);
                            setWrongChoice("");
                          }}
                          className="mt-2 text-xs text-gray-500 hover:text-blue-600"
                        >
                          取消选择
                        </button>
                      )}

                      {/* 破损展开选项 */}
                      {receiveProblem === "broken" && (
                        <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                          <div className="text-xs text-gray-500 mb-1">请选择破损处理方式</div>
                          <label className="flex items-start gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                            <input
                              type="radio"
                              name="brokenChoice"
                              value="exchange"
                              checked={brokenChoice === "exchange"}
                              onChange={() => setBrokenChoice("exchange")}
                              className="mt-0.5"
                            />
                            <div className="text-sm">
                              <div className="font-medium text-gray-900">换货(破损补发)</div>
                              <div className="text-gray-500 text-xs mt-0.5">正常入库 + 生成「破损退货」 + 自动加一条「破损补发」待采购</div>
                            </div>
                          </label>
                          <label className="flex items-start gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                            <input
                              type="radio"
                              name="brokenChoice"
                              value="discard"
                              checked={brokenChoice === "discard"}
                              onChange={() => setBrokenChoice("discard")}
                              className="mt-0.5"
                            />
                            <div className="text-sm">
                              <div className="font-medium text-gray-900">不需要了</div>
                              <div className="text-gray-500 text-xs mt-0.5">先入库 + 生成「破损退货」(不补货)</div>
                            </div>
                          </label>
                        </div>
                      )}

                      {/* 错发展开选项 */}
                      {receiveProblem === "wrong" && (
                        <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                          <div className="text-xs text-gray-500 mb-1">请选择错发处理方式</div>
                          <label className="flex items-start gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                            <input
                              type="radio"
                              name="wrongChoice"
                              value="exchange"
                              checked={wrongChoice === "exchange"}
                              onChange={() => setWrongChoice("exchange")}
                              className="mt-0.5"
                            />
                            <div className="text-sm">
                              <div className="font-medium text-gray-900">换货</div>
                              <div className="text-gray-500 text-xs mt-0.5">先入库 + 生成「错发退货」 + 自动加一条「错发换货」待采购</div>
                            </div>
                          </label>
                          <label className="flex items-start gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                            <input
                              type="radio"
                              name="wrongChoice"
                              value="discard"
                              checked={wrongChoice === "discard"}
                              onChange={() => setWrongChoice("discard")}
                              className="mt-0.5"
                            />
                            <div className="text-sm">
                              <div className="font-medium text-gray-900">不需要了</div>
                              <div className="text-gray-500 text-xs mt-0.5">直接生成「错发退货」,不入库</div>
                            </div>
                          </label>
                        </div>
                      )}
                    </div>
                  );
                }

                /* 多发 */
                if (qty > ordered) {
                  return (
                    <div className="border-t border-gray-100 pt-3">
                      <div className="text-xs text-blue-600 font-medium mb-2">多发处理 — 订购 {ordered},实际到货 {qty}</div>
                      <div className="space-y-2">
                        <label className="flex items-start gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                          <input
                            type="radio"
                            name="excessChoice"
                            value="return"
                            checked={excessChoice === "return"}
                            onChange={() => setExcessChoice("return")}
                            className="mt-0.5"
                          />
                          <div className="text-sm">
                            <div className="font-medium text-gray-900">多出退货</div>
                            <div className="text-gray-500 text-xs mt-0.5">按订购数入库,多出部分生成「多发退货」</div>
                          </div>
                        </label>
                        <label className="flex items-start gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                          <input
                            type="radio"
                            name="excessChoice"
                            value="keep"
                            checked={excessChoice === "keep"}
                            onChange={() => setExcessChoice("keep")}
                            className="mt-0.5"
                          />
                          <div className="text-sm flex-1">
                            <div className="font-medium text-gray-900">入库留作备用</div>
                            <div className="text-gray-500 text-xs mt-0.5">订购数正常入库,多出部分按「多发备用」入库</div>
                            {excessChoice === "keep" && (
                              <div className="mt-2 space-y-2">
                                <label className="flex items-center gap-2 text-xs">
                                  <input
                                    type="radio"
                                    name="excessKeepPaid"
                                    value="paid"
                                    checked={excessKeepPaid === "paid"}
                                    onChange={() => setExcessKeepPaid("paid")}
                                  />
                                  对供应商付款(按原单价计入应付款)
                                </label>
                                <label className="flex items-center gap-2 text-xs">
                                  <input
                                    type="radio"
                                    name="excessKeepPaid"
                                    value="free"
                                    checked={excessKeepPaid === "free"}
                                    onChange={() => setExcessKeepPaid("free")}
                                  />
                                  不付款(零价入库,作赠品)
                                </label>
                              </div>
                            )}
                          </div>
                        </label>
                      </div>
                    </div>
                  );
                }

                /* 少发 */
                return (
                  <div className="border-t border-gray-100 pt-3">
                    <div className="text-xs text-red-600 font-medium mb-2">少发处理 — 订购 {ordered},实际到货 {qty}</div>
                    <div className="space-y-2">
                      <label className="flex items-start gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                        <input
                          type="radio"
                          name="shortChoice"
                          value="repurchase"
                          checked={shortChoice === "repurchase"}
                          onChange={() => setShortChoice("repurchase")}
                          className="mt-0.5"
                        />
                        <div className="text-sm">
                          <div className="font-medium text-gray-900">{qty === 0 ? "重新采购" : "少发补货"}</div>
                          <div className="text-gray-500 text-xs mt-0.5">
                            {qty === 0
                              ? "未入库,按原订购数自动生成「少发补货」待采购"
                              : "按实际到货数入库,差额自动生成「少发补货」待采购"}
                          </div>
                        </div>
                      </label>
                      <label className="flex items-start gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                        <input
                          type="radio"
                          name="shortChoice"
                          value="discard"
                          checked={shortChoice === "discard"}
                          onChange={() => setShortChoice("discard")}
                          className="mt-0.5"
                        />
                        <div className="text-sm flex-1">
                          <div className="font-medium text-gray-900">不需要了</div>
                          <div className="text-gray-500 text-xs mt-0.5">
                            {qty === 0
                              ? "清除该配件的采购记录和工单记录"
                              : "按实际数量入库,建议附上聊天记录截图作为凭证"}
                          </div>
                          {shortChoice === "discard" && (
                            <div className="mt-2">
                              <label className="block text-xs text-gray-600 mb-1">聊天记录截图</label>
                              <ImageUploader
                                onUpload={(paths) => setShortEvidence(paths)}
                                existingImages={shortEvidence}
                                maxImages={5}
                                bucket="work-order-media"
                                folder="purchase-evidence"
                              />
                            </div>
                          )}
                        </div>
                      </label>
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeReceiveModal}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleReceiveSubmit}
                disabled={submitting === `item-${receiveItem.id}`}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting === `item-${receiveItem.id}` ? "处理中..." : "确认收货"}
              </button>
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

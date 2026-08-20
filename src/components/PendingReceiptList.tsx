"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PriceValue, usePriceVisibility } from "@/components/PriceVisibilityContext";
import { PartSearchDropdown } from "@/components/PartSearchDropdown";
import { ImageUploader } from "@/components/ImageUploader";
import { useConfirm } from "./ConfirmDialog";
import PartForm from "@/app/parts/new/PartForm";
import { ACTION_LABELS } from "@/lib/purchaseFlowLabels";
import { usePartLinking } from "./usePartLinking";
import { 提交收货处理, 撤销收货处理, 删除采购明细, 撤销作废采购单 } from "@/app/procurement/actions";
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

/* 处理动作标签已抽到 @/lib/purchaseFlowLabels（唯一来源）;
   补货动作映射已下沉到数据库函数 receive_purchase_item:
   broken_exchange→broken_resupply / wrong_exchange→wrong_exchange / short_repurchase→short_resupply */

function resolveImageUrl(path: string): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return path;
  return `${base}/storage/v1/object/public/work-order-media/${path}`;
}

export function PendingReceiptList() {
  const supabase = createClient();
  const { 请求确认, 确认弹窗 } = useConfirm();
  /* 价格显示开关：仅 admin/boss/warehouse 可见可用（其余角色 Context 层面已强制隐藏价格） */
  const { showPrices, canTogglePrices, togglePrices } = usePriceVisibility();
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
          if (!(await 请求确认("少发弃货建议上传聊天截图作为凭证,确定不上传吗?"))) return;
        }
        if (qty === 0) {
          /* 完全没到 → 删除采购明细和工单配件 */
          if (!(await 请求确认("确认删除该配件?这会同时清除采购流程和工单中的记录。"))) return;
          setSubmitting(`item-${receiveItem.id}`);
          try {
            /* 删明细+删工单配件行+整单状态处理已收编进数据库事务函数 delete_purchase_item */
            const res = await 删除采购明细(receiveOrder.id, receiveItem.id);
            if (!res.success) throw new Error(res.error || "删除失败");
            loadData();
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            alert("删除失败: " + msg);
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
      /* 明细更新+补货分支克隆+状态重算+运单联动已收编进数据库事务函数 receive_purchase_item */
      const res = await 提交收货处理(
        order.id,
        item.id,
        payload.handle_action,
        payload.received_qty,
        payload.evidence_photos ?? null,
        payload.evidence_photos !== undefined
      );
      if (!res.success) throw new Error(res.error || "收货失败");
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("收货失败: " + msg);
    } finally {
      setSubmitting(null);
    }
  }

  /* ------------------ 一键待退货（2026-08-20 一期⑤） ------------------
     货不对时不用进收货弹窗点三步，一键打「错发退货」标签：
     不入库、直接生成待退货记录（同收货弹窗里"错发→不需要了"分支） */

  async function handleQuickReturn(order: PurchaseOrder, item: PurchaseOrderItem) {
    if (!(await 请求确认(`确认把「${item.name}」标记为错发待退货？不会入库，直接生成待退货记录。`))) return;
    await applyAction(order, item, {
      handle_action: "wrong_discard",
      received_qty: 0,
    });
  }

  /* ------------------ 撤销收货 ------------------ */

  async function handleRevokeItem(order: PurchaseOrder, item: PurchaseOrderItem) {
    if (!(await 请求确认("确认撤销该配件的收货处理?"))) return;
    setSubmitting(`revoke-${item.id}`);
    try {
      /* 清空处理结果+删补货分支+状态回退+运单回退已收编进数据库事务函数 revoke_purchase_receipt */
      const res = await 撤销收货处理(order.id, item.id);
      if (!res.success) throw new Error(res.error || "撤销失败");
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("撤销失败: " + msg);
    } finally {
      setSubmitting(null);
    }
  }

  /* ------------------ 撤销/作废整单（2026-08-17） ------------------
     仅未收货(submitted)的单显示按钮；配件去留由模式决定，
     单据统一标 cancelled 留档（采购单只废不删） */

  async function handleCancelOrder(orderId: string, mode: "revoke" | "void") {
    const 文案 = mode === "revoke"
      ? "撤销整单：该采购单将作废留档，明细配件【退回】待采购列表，是否继续？"
      : "作废整单：该采购单将作废留档，明细配件【不】退回待采购，是否继续？";
    if (!(await 请求确认(文案))) return;
    setSubmitting(`cancel-${orderId}`);
    try {
      const res = await 撤销作废采购单(orderId, mode);
      if (!res.success) throw new Error(res.error || "操作失败");
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert((mode === "revoke" ? "撤销失败: " : "作废失败: ") + msg);
    } finally {
      setSubmitting(null);
    }
  }

  /* ------------------ 编辑配件信息 ------------------ */

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


  /* 补货分支克隆已下沉到数据库函数 receive_purchase_item(收货时同事务完成),
     映射关系: broken_exchange→broken_resupply / wrong_exchange→wrong_exchange / short_repurchase→short_resupply */

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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("创建运单失败: " + msg);
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
        {canTogglePrices && (
          <button
            type="button"
            onClick={togglePrices}
            title={showPrices ? "点击隐藏价格" : "点击显示价格"}
            className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-600 bg-white hover:bg-gray-50 flex items-center gap-1"
          >
            {showPrices ? (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              </svg>
            )}
            {showPrices ? "隐藏价格" : "显示价格"}
          </button>
        )}
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
        /* 分组卡片：与待采购页统一风格（2026-08-15）——左侧蓝竖条+蓝色标签+加粗组名 */
        <div key={g.key} className="bg-white rounded-xl border border-gray-200 border-l-4 border-l-blue-500 overflow-hidden">
          <div className="px-6 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 flex items-center">
                <span className="inline-block px-2 py-0.5 rounded bg-blue-600 text-white mr-2 text-[10px] font-bold">
                  {groupBy === "supplier" ? "供应商" : "物流"}
                </span>
                <span className="font-bold text-gray-900">{g.key}</span>
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

                    {/* 整单撤销/作废（2026-08-17）：仅未收货(submitted)的单可操作；
                        撤销=配件回待采购，作废=配件不回，单据都留档(cancelled)。
                        命名避开行级"撤销"收货按钮和待采购页批量"撤销"配件 */}
                    {order.status === "submitted" && (
                      <>
                        <button
                          type="button"
                          disabled={submitting === `cancel-${order.id}`}
                          onClick={() => handleCancelOrder(order.id, "revoke")}
                          className="text-xs text-amber-600 hover:text-amber-700 hover:underline disabled:opacity-50"
                        >
                          撤销整单
                        </button>
                        <button
                          type="button"
                          disabled={submitting === `cancel-${order.id}`}
                          onClick={() => handleCancelOrder(order.id, "void")}
                          className="text-xs text-red-400 hover:text-red-600 hover:underline disabled:opacity-50"
                        >
                          作废整单
                        </button>
                      </>
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
                                  onCreateNew={(query) => openCreateNewModal(item, query)}
                                  onClear={() => handleInlineClear(item)}
                                  disabled={submitting === `inline-${item.id}`}
                                  placeholder="编码"
                                  inputClassName="w-20 border-gray-200 text-xs"
                                />
                              </td>
                              <td className="px-2 py-2 whitespace-nowrap">
                                <div className="text-gray-900 font-medium truncate" title={item.name}>{item.name}</div>
                                {item.brand || item.specification ? (
                                  <div className="text-xs text-gray-400 truncate">
                                    {item.brand || ""} {item.specification || ""}
                                  </div>
                                ) : null}
                              </td>
                              <td className="px-2 py-2 whitespace-nowrap">
                                <DocumentNameInput 采购明细id={item.id} 初始值={item.supplier_part_name || ""} 保存后={loadData} 样式类名="w-24 px-2 py-1 text-xs rounded border border-gray-200 bg-white placeholder:text-gray-400 hover:border-blue-400 focus:border-blue-500 focus:outline-none disabled:opacity-50" />
                              </td>
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
                                        loading="lazy"
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
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => openReceiveModal(order, item)}
                                        disabled={!canConfirm || submitting === `item-${item.id}`}
                                        title={!canConfirm ? "外阜供货商需先关联运单" : undefined}
                                        className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
                                      >
                                        收货
                                      </button>
                                      {/* 一键待退货：货不对时直接打错发退货标签，不用进弹窗点三步 */}
                                      <button
                                        type="button"
                                        onClick={() => handleQuickReturn(order, item)}
                                        disabled={!canConfirm || submitting === `item-${item.id}`}
                                        title="货不对，直接标记错发退货（不入库）"
                                        className="px-2 py-1 text-xs rounded border border-orange-300 text-orange-600 bg-orange-50 hover:bg-orange-100 disabled:opacity-50 whitespace-nowrap"
                                      >
                                        待退货
                                      </button>
                                    </>
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

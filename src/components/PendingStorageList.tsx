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
import { 确认采购入库, 退回待收货, 确认批次入库 } from "@/app/procurement/actions";
import { 确认到货入库 } from "@/app/arrivals/actions";
import { useToast } from "@/components/Toast";
import { ImageUploader } from "@/components/ImageUploader";
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
  arrival_item_id: string | null;
  /* 收货批次关联（2026-09-04）：非空表示该行走批次入库，不进按单入库列表 */
  receiving_batch_id: string | null;
}

/* 已确认到货的到货确认单（2026-08-20 二期：待入库的新来源）；
   导出给采购看板 page.tsx 服务端首屏查询用（待办清单第9项） */
export interface 到货单 {
  id: string;
  receipt_no: string;
  /* 供应商销售单（2026-08-21）：建单/验货时已录的带过来 */
  supplier_order_no: string | null;
  supplier_order_amount: number | null;
  suppliers: { name: string } | null;
  logistics_waybills: { tracking_no: string; freight_amount: number | null } | null;
  arrival_receipt_items: { count: number }[];
}

/* 订单类型导出给采购看板 page.tsx：服务端首屏查询结果作为 props 传入用（待办清单第9项） */
export interface PurchaseOrder {
  id: string;
  order_no: string | null;
  supplier_id: string | null;
  status: string;
  total_amount: number | null;
  notes: string | null;
  created_at: string;
  waybill_id: string | null;
  /* 供应商销售单（2026-08-21） */
  supplier_order_no: string | null;
  supplier_order_amount: number | null;
  supplier_slip_photos: string[] | null;
  suppliers: { id: string; name: string } | null;
  purchase_order_items: PurchaseOrderItem[];
}

/* 收货批次（2026-09-04 跨单收货）：一次手动提交=一个批次，按批次一张清单入库 */
interface 收货批次 {
  id: string;
  batch_no: string;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_order_no: string | null;
  status: string;
  created_at: string;
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
  /* 入库价（2026-08-21 销售单口径）：字符串存储提交时转 number，默认采购价可对销售单改 */
  unitCost: string;
  /* 手动指定该行运费（大件低值商品）；空字符串=参与按金额占比自动分摊 */
  freightManual: string;
}

/* 首屏数据 props（服务端查询注入，待办清单第9项）：
   有 initialOrders 时首屏直接渲染、跳过 useEffect 里的 loadData，
   避免 SPA 软导航时 session 未就绪导致整页空白；后续操作照常走 loadData 刷新 */
interface PendingStorageListProps {
  initialOrders?: PurchaseOrder[];
  initialArrivalReceipts?: 到货单[];
}

export function PendingStorageList(props: PendingStorageListProps) {
  const supabase = createClient();
  const { 请求确认, 确认弹窗 } = useConfirm();
  const { showToast } = useToast();
  const [orders, setOrders] = useState<PurchaseOrder[]>(props.initialOrders ?? []);
  const [loading, setLoading] = useState(!props.initialOrders);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null);

  /* 入库单确认弹窗 */
  const [inboundModalOpen, setInboundModalOpen] = useState(false);
  const [inboundModalOrder, setInboundModalOrder] = useState<PurchaseOrder | null>(null);
  const [inboundItems, setInboundItems] = useState<InboundItemForm[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [freightAmount, setFreightAmount] = useState("");
  const [waybillInfo, setWaybillInfo] = useState<{ logistics_company_name: string | null; tracking_no: string | null; freight_amount: number | null } | null>(null);

  /* 供应商销售单（2026-08-21）：入库时对单——单号/总金额/照片/优惠抹零 */
  const [slipNo, setSlipNo] = useState("");
  const [slipAmount, setSlipAmount] = useState("");
  const [slipPhotos, setSlipPhotos] = useState<string[]>([]);
  const [discountAmount, setDiscountAmount] = useState("");

  /* 到货确认单（二期新流程）：已确认到货、待账务入库 */
  const [到货单列表, set到货单列表] = useState<到货单[]>(props.initialArrivalReceipts ?? []);
  const [到货入库弹窗, set到货入库弹窗] = useState<到货单 | null>(null);
  const [到货运费, set到货运费] = useState("");
  /* 到货入库抹零（2026-08-21 销售单口径） */
  const [到货抹零, set到货抹零] = useState("");

  /* 收货批次（2026-09-04）：待入库批次 + 批次入库弹窗 */
  const [批次列表, set批次列表] = useState<收货批次[]>([]);
  const [batchModal, setBatchModal] = useState<收货批次 | null>(null);

  async function loadData() {
    setLoading(true);
    const { data, error } = await supabase
      .from("purchase_orders")
      .select(
        `
        id, order_no, supplier_id, status, total_amount, notes, created_at,
        supplier_order_no, supplier_order_amount, supplier_slip_photos,
        suppliers(id, name),
        purchase_order_items(
          id, name, brand, specification, quantity, unit_cost, received_qty,
          part_id, work_order_item_part_id, part_number, supplier_part_name,
          unit, category, license_plate, photos, notes,
          handle_action, discount_amount, evidence_photos, return_reason, arrival_item_id, receiving_batch_id
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

    /* 走过到货确认单或收货批次的采购单不进老按单入库列表（它们从各自的流程入库，防双入库） */
    const 老流程单 = ((data || []) as unknown as PurchaseOrder[]).filter(
      (o) => !(o.purchase_order_items || []).some((it) => it.arrival_item_id || it.receiving_batch_id)
    );
    setOrders(老流程单);

    /* 新流程：已确认到货、待账务入库的到货单 */
    const { data: 到货单 } = await supabase
      .from("arrival_receipts")
      .select("id, receipt_no, supplier_order_no, supplier_order_amount, suppliers(name), logistics_waybills(tracking_no, freight_amount), arrival_receipt_items(count)")
      .eq("status", "confirmed")
      .order("confirmed_at", { ascending: false });
    set到货单列表(((到货单 || []) as unknown) as 到货单[]);

    /* 收货批次（2026-09-04 跨单收货）：手动提交后待入库 */
    const { data: 批次们 } = await supabase
      .from("receiving_batches")
      .select("id, batch_no, supplier_id, supplier_name, supplier_order_no, status, created_at")
      .eq("status", "pending_storage")
      .order("created_at", { ascending: false });
    set批次列表(((批次们 || []) as unknown) as 收货批次[]);
    setLoading(false);
  }

  /* 到货单确认入库：纯账务收尾（库存已在确认到货时上好） */
  async function 提交到货入库() {
    if (!到货入库弹窗) return;
    const 运费 = 到货运费.trim() === "" ? 0 : parseFloat(到货运费);
    if (isNaN(运费) || 运费 < 0) {
      showToast("运费金额无效", "warning");
      return;
    }
    const 抹零 = 到货抹零.trim() === "" ? null : parseFloat(到货抹零);
    if (抹零 !== null && (isNaN(抹零) || 抹零 < 0)) {
      showToast("优惠抹零必须是非负数字", "warning");
      return;
    }
    setSubmitting(`arrival-${到货入库弹窗.id}`);
    try {
      const res = await 确认到货入库(到货入库弹窗.id, 运费, 抹零);
      if (!res.success) throw new Error(res.error || "确认入库失败");
      showToast(`入库完成，入库单号 ${res.inbound_no}`);
      set到货入库弹窗(null);
      set到货运费("");
      set到货抹零("");
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast("确认入库失败: " + msg, "error");
    } finally {
      setSubmitting(null);
    }
  }

  /* 打开批次入库弹窗（2026-09-04 跨单收货）：批次行查库组装，复用按单弹窗的整套表单状态 */
  async function openBatchInboundModal(批: 收货批次) {
    const { data: 行们, error } = await supabase
      .from("purchase_order_items")
      .select(`
        id, name, brand, specification, quantity, unit_cost, received_qty,
        part_id, work_order_item_part_id, part_number, supplier_part_name,
        unit, category, license_plate, photos, notes, handle_action,
        discount_amount, evidence_photos, return_reason, arrival_item_id
      `)
      .eq("receiving_batch_id", 批.id)
      .order("created_at", { ascending: true });
    if (error) {
      showToast("加载批次明细失败: " + error.message, "error");
      return;
    }

    let formIdCounter = 0;
    const forms: InboundItemForm[] = (((行们 || []) as unknown) as PurchaseOrderItem[])
      .filter((it) => it.handle_action !== "wrong_discard" && getStorageQty(it) > 0)
      .flatMap((it) => {
        if (it.handle_action === "excess_return") {
          return [
            {
              id: `form-${formIdCounter++}`, item: it, quantity: String(it.quantity),
              batchNo: "", notes: it.notes || "", warehouseId: "", location: "",
              isExcess: false,
              unitCost: it.unit_cost != null ? String(it.unit_cost) : "", freightManual: "",
            },
            {
              id: `form-${formIdCounter++}`, item: it,
              quantity: String(Math.max(0, (it.received_qty ?? 0) - it.quantity)),
              batchNo: "", notes: "多发退货", warehouseId: "", location: "",
              isExcess: true,
              unitCost: it.unit_cost != null ? String(it.unit_cost) : "", freightManual: "",
            },
          ];
        }
        return [
          {
            id: `form-${formIdCounter++}`, item: it,
            quantity: String(getStorageQty(it)),
            batchNo: "", notes: it.notes || "", warehouseId: "", location: "",
            isExcess: false,
            unitCost: it.unit_cost != null ? String(it.unit_cost) : "", freightManual: "",
          },
        ];
      });

    /* 加载仓库列表（与按单弹窗共用） */
    const { data: whData } = await supabase.from("warehouses").select("id, name").order("name");
    setWarehouses(whData || []);

    /* 销售单信息从批次带出（单号只读显示，金额可在弹窗改） */
    setSlipNo(批.supplier_order_no || "");
    setSlipAmount("");
    setSlipPhotos([]);
    setDiscountAmount("");
    setWaybillInfo(null);
    setFreightAmount("");
    setBatchModal(批);
    setInboundModalOrder(null);
    setInboundItems(forms);
    setInboundModalOpen(true);
  }

  /* 批次入库提交：调 complete_batch_inbound（跨采购单一次入库，应付款按批次合并） */
  async function handleConfirmBatchInbound() {
    if (!batchModal) return;
    const 批次id = batchModal.id;

    const 销售单金额 = slipAmount.trim() === "" ? null : parseFloat(slipAmount);
    const 抹零 = discountAmount.trim() === "" ? 0 : parseFloat(discountAmount);
    if (销售单金额 !== null && (isNaN(销售单金额) || 销售单金额 < 0)) {
      alert("销售单总金额无效");
      return;
    }
    if (discountAmount.trim() !== "" && (isNaN(抹零) || 抹零 < 0)) {
      alert("优惠抹零必须是非负数字");
      return;
    }
    const 货款合计 = inboundItems
      .filter((f) => !f.isExcess)
      .reduce((sum, f) => sum + (parseInt(f.quantity, 10) || 0) * (parseFloat(f.unitCost) || 0), 0);
    if (销售单金额 !== null && Math.abs(货款合计 - 抹零 - 销售单金额) > 0.01) {
      alert(
        `入库货款合计 ¥${货款合计.toFixed(2)} − 抹零 ¥${抹零.toFixed(2)} ≠ 销售单总金额 ¥${销售单金额.toFixed(2)}，` +
        `差 ¥${(货款合计 - 抹零 - 销售单金额).toFixed(2)}。\n请逐行核对入库单价，或在「优惠抹零」填入差额。`
      );
      return;
    }

    setSubmitting(`batch-${批次id}`);
    try {
      const 明细 = inboundItems.map((f) => ({
        purchase_order_item_id: f.item.id,
        quantity: parseInt(f.quantity, 10) || 0,
        batch_no: f.batchNo,
        warehouse_id: f.warehouseId,
        location: f.location,
        notes: f.notes,
        is_excess: f.isExcess,
        unit_cost: f.unitCost.trim() === "" ? null : parseFloat(f.unitCost),
        freight_alloc: f.freightManual.trim() === "" ? null : parseFloat(f.freightManual),
      }));
      const res = await 确认批次入库(批次id, 明细, parseFloat(freightAmount) || 0, 抹零 || null, 销售单金额);
      if (!res.success) throw new Error(res.error || "入库失败");
      showToast(`批次入库完成，入库单号 ${res.inbound_no}`);
      closeInboundModal();
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("批次入库失败: " + msg);
    } finally {
      setSubmitting(null);
    }
  }

  useEffect(() => {
    /* 服务端已给首屏数据则跳过首次查询，避免重复拉取 */
    if (props.initialOrders) return;
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
              unitCost: it.unit_cost != null ? String(it.unit_cost) : "",
              freightManual: "",
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
              unitCost: it.unit_cost != null ? String(it.unit_cost) : "",
              freightManual: "",
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
            unitCost: it.unit_cost != null ? String(it.unit_cost) : "",
            freightManual: "",
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
    /* 销售单信息从采购单带出（收货时已录的显示，可补可改） */
    setSlipNo(order.supplier_order_no || "");
    setSlipAmount(order.supplier_order_amount != null ? String(order.supplier_order_amount) : "");
    setSlipPhotos(order.supplier_slip_photos || []);
    setDiscountAmount("");
    setInboundItems(forms);
    setInboundModalOpen(true);
  }

  function closeInboundModal() {
    setInboundModalOpen(false);
    setInboundModalOrder(null);
    setBatchModal(null);
    setInboundItems([]);
    setWaybillInfo(null);
    setFreightAmount("");
    setSlipNo("");
    setSlipAmount("");
    setSlipPhotos([]);
    setDiscountAmount("");
  }

  /* 计算分摊后的成本（2026-08-21 新口径）：
     手动行（freightManual 非空）用指定金额锁定；
     剩余运费 = 总运费 − 手动合计，由其余非赠品行按 行金额(数量×入库价) 占比分摊 */
  const allocatedCosts = useMemo(() => {
    const totalFreight = parseFloat(freightAmount) || 0;
    const 有效行 = inboundItems.filter((f) => !f.isExcess);
    const 手动合计 = 有效行.reduce(
      (sum, f) => sum + (f.freightManual.trim() === "" ? 0 : parseFloat(f.freightManual) || 0),
      0
    );
    const 剩余 = Math.max(0, totalFreight - 手动合计);
    const 自动行金额合计 = 有效行
      .filter((f) => f.freightManual.trim() === "")
      .reduce((sum, f) => sum + (parseInt(f.quantity, 10) || 0) * (parseFloat(f.unitCost) || 0), 0);

    return inboundItems.map((f) => {
      if (f.isExcess) return 0;
      if (f.freightManual.trim() !== "") return parseFloat(f.freightManual) || 0;
      if (自动行金额合计 <= 0) return 0;
      const 行金额 = (parseInt(f.quantity, 10) || 0) * (parseFloat(f.unitCost) || 0);
      return Math.round((剩余 * 行金额 / 自动行金额合计) * 100) / 100;
    });
  }, [inboundItems, freightAmount]);

  async function handleConfirmInbound() {
    if (!inboundModalOrder) return;
    const orderId = inboundModalOrder.id;

    /* 销售单口径（2026-08-21）：填了总金额时前端先自检，不平给出明确提示（服务端还会再拦一次） */
    const 销售单金额 = slipAmount.trim() === "" ? null : parseFloat(slipAmount);
    const 抹零 = discountAmount.trim() === "" ? 0 : parseFloat(discountAmount);
    if (销售单金额 !== null && (isNaN(销售单金额) || 销售单金额 < 0)) {
      alert("销售单总金额无效");
      return;
    }
    if (discountAmount.trim() !== "" && (isNaN(抹零) || 抹零 < 0)) {
      alert("优惠抹零必须是非负数字");
      return;
    }
    const 货款合计 = inboundItems
      .filter((f) => !f.isExcess)
      .reduce((sum, f) => sum + (parseInt(f.quantity, 10) || 0) * (parseFloat(f.unitCost) || 0), 0);
    if (销售单金额 !== null && Math.abs(货款合计 - 抹零 - 销售单金额) > 0.01) {
      alert(
        `入库货款合计 ¥${货款合计.toFixed(2)} − 抹零 ¥${抹零.toFixed(2)} ≠ 销售单总金额 ¥${销售单金额.toFixed(2)}，` +
        `差 ¥${(货款合计 - 抹零 - 销售单金额).toFixed(2)}。\n请逐行核对入库单价，或在「优惠抹零」填入差额。`
      );
      return;
    }

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
        /* 销售单口径：入库价 + 手动运费（空=自动分摊） */
        unit_cost: f.unitCost.trim() === "" ? null : parseFloat(f.unitCost),
        freight_alloc: f.freightManual.trim() === "" ? null : parseFloat(f.freightManual),
      }));
      const res = await 确认采购入库(
        orderId,
        明细,
        parseFloat(freightAmount) || 0,
        抹零 || null,
        slipNo.trim() || null,
        销售单金额
      );
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

  if (orders.length === 0 && 到货单列表.length === 0 && 批次列表.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
        暂无待入库的采购单
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 到货确认单（二期新流程）：已确认到货，库存已上架，这里只做账务入库 */}
      {到货单列表.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 border-l-4 border-l-green-500 overflow-hidden">
          <div className="px-6 py-3 border-b border-gray-100 bg-gray-50">
            <h3 className="text-sm font-semibold text-gray-900 flex items-center">
              <span className="inline-block px-2 py-0.5 rounded bg-green-600 text-white mr-2 text-[10px] font-bold">
                到货单
              </span>
              <span className="font-bold text-gray-900">已确认到货 · 待账务入库</span>
            </h3>
            <span className="text-xs text-gray-500">库存已在确认到货时上架，这里只做入库单/应付款账务收尾</span>
          </div>
          <div className="divide-y divide-gray-100">
            {到货单列表.map((单) => (
              <div key={单.id} className="px-6 py-3 flex items-center gap-3 flex-wrap">
                <Link href={`/procurement/arrivals/${单.id}`} className="text-sm text-blue-600 hover:underline font-medium">
                  {单.receipt_no}
                </Link>
                <span className="text-sm text-gray-600">{单.suppliers?.name || "-"}</span>
                <span className="text-xs text-gray-500">
                  {单.arrival_receipt_items?.[0]?.count ?? 0} 件
                  {单.logistics_waybills?.tracking_no ? ` · 运单 ${单.logistics_waybills.tracking_no}` : ""}
                </span>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => {
                    set到货入库弹窗(单);
                    set到货运费(单.logistics_waybills?.freight_amount?.toString() || "");
                  }}
                  className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
                >
                  确认入库
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 收货批次（2026-09-04 跨单收货）：手动提交后的待入库批次，一张清单一次入库 */}
      {批次列表.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 border-l-4 border-l-yellow-500 overflow-hidden">
          <div className="px-6 py-3 border-b border-gray-100 bg-gray-50">
            <h3 className="text-sm font-semibold text-gray-900 flex items-center">
              <span className="inline-block px-2 py-0.5 rounded bg-yellow-500 text-white mr-2 text-[10px] font-bold">
                收货批次
              </span>
              <span className="font-bold text-gray-900">跨单收货 · 待入库</span>
            </h3>
            <span className="text-xs text-gray-500">一次手动提交的跨采购单收货，按批次一张清单一次入库</span>
          </div>
          <div className="divide-y divide-gray-100">
            {批次列表.map((批) => (
              <div key={批.id} className="px-6 py-3 flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium text-gray-900">{批.batch_no}</span>
                <span className="text-sm text-gray-600">{批.supplier_name || "-"}</span>
                <span className="text-xs text-gray-500">
                  {new Date(批.created_at).toLocaleString("zh-CN")}
                  {批.supplier_order_no ? ` · 销售单 ${批.supplier_order_no}` : ""}
                </span>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => openBatchInboundModal(批)}
                  className="px-3 py-1 bg-yellow-500 text-white text-xs rounded hover:bg-yellow-600"
                >
                  生成入库单
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

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
      {inboundModalOpen && (inboundModalOrder || batchModal) && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-5xl my-8 relative">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div>
                <h3 className="text-base font-semibold text-gray-900">入库单确认</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {batchModal
                    ? `收货批次: ${batchModal.batch_no} · 供应商: ${batchModal.supplier_name || "-"}${batchModal.supplier_order_no ? ` · 销售单: ${batchModal.supplier_order_no}` : ""}`
                    : `采购单: ${inboundModalOrder!.order_no || inboundModalOrder!.id.slice(0, 8)} · 供应商: ${inboundModalOrder!.suppliers?.name || "-"}`}
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
              {/* 供应商销售单对照区（2026-08-21 按销售单执行入库）：
                  填了总金额后，货款合计−抹零≠总金额 会被前后端双重拦截 */}
              <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-3 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium text-blue-800">供应商销售单</span>
                  <input
                    type="text"
                    value={slipNo}
                    onChange={(e) => setSlipNo(e.target.value)}
                    placeholder="销售单号"
                    className="w-36 px-2 py-1 text-xs rounded border border-blue-200 bg-white focus:outline-none focus:border-blue-400"
                  />
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-600">总金额(¥):</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={slipAmount}
                      onChange={(e) => setSlipAmount(e.target.value)}
                      placeholder="不填不校验"
                      className="w-24 px-2 py-1 text-xs text-right rounded border border-blue-200 bg-white focus:outline-none focus:border-blue-400"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-600">优惠抹零(¥):</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={discountAmount}
                      onChange={(e) => setDiscountAmount(e.target.value)}
                      placeholder="0.00"
                      title="供应商少收的钱（减项）：明细合计−抹零=销售单总金额"
                      className="w-20 px-2 py-1 text-xs text-right rounded border border-blue-200 bg-white focus:outline-none focus:border-blue-400"
                    />
                  </div>
                </div>
                <ImageUploader
                  onUpload={setSlipPhotos}
                  existingImages={slipPhotos}
                  maxImages={3}
                  bucket="work-order-media"
                  folder="supplier-slips"
                />
                {/* 金额校验条：实时显示 货款合计−抹零 与 销售单总金额 是否对平 */}
                {slipAmount.trim() !== "" && (
                  (() => {
                    const 货款 = inboundItems
                      .filter((f) => !f.isExcess)
                      .reduce((sum, f) => sum + (parseInt(f.quantity, 10) || 0) * (parseFloat(f.unitCost) || 0), 0);
                    const 抹零数 = parseFloat(discountAmount) || 0;
                    const 单额 = parseFloat(slipAmount) || 0;
                    const 差 = Math.round((货款 - 抹零数 - 单额) * 100) / 100;
                    return Math.abs(差) <= 0.01 ? (
                      <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">
                        ✓ 对平：货款 ¥{货款.toFixed(2)} − 抹零 ¥{抹零数.toFixed(2)} = 销售单 ¥{单额.toFixed(2)}
                      </p>
                    ) : (
                      <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                        ✗ 不平：货款 ¥{货款.toFixed(2)} − 抹零 ¥{抹零数.toFixed(2)} = ¥{(货款 - 抹零数).toFixed(2)}，
                        与销售单 ¥{单额.toFixed(2)} 差 ¥{差.toFixed(2)}（{差 > 0 ? "货款多" : "货款少"}）——请改入库单价或填抹零
                      </p>
                    );
                  })()
                )}
              </div>

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
                      <th className="px-3 py-2 text-right font-medium text-gray-500 w-20">入库价</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500 w-24">分摊运费</th>
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
                      /* 销售单口径（2026-08-21）：入库价可改；成本价=数量×入库价+分摊运费 */
                      const 入库单价 = parseFloat(f.unitCost) || 0;
                      const baseCost = qty * 入库单价;
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
                          {/* 入库价（可对着销售单改）；默认采购价 */}
                          <td className="px-3 py-2">
                            {f.isExcess ? (
                              <span className="block text-right text-gray-500 text-sm">-</span>
                            ) : (
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={f.unitCost}
                                onChange={(e) => {
                                  setInboundItems((prev) =>
                                    prev.map((p) =>
                                      p.id === f.id ? { ...p, unitCost: e.target.value } : p
                                    )
                                  );
                                }}
                                title="默认采购价；供应商销售单价格不同时改这里"
                                className={`w-full px-2 py-1 text-xs text-right rounded border focus:outline-none focus:border-blue-400 ${
                                  f.unitCost !== (f.item.unit_cost != null ? String(f.item.unit_cost) : "")
                                    ? "border-amber-400 bg-amber-50"
                                    : "border-gray-200"
                                }`}
                              />
                            )}
                          </td>
                          {/* 分摊运费：默认按金额占比自动分摊（灰字）；手动输入则锁定该行（大件低值商品） */}
                          <td className="px-3 py-2">
                            {f.isExcess ? (
                              <span className="block text-right text-gray-400 text-xs">-</span>
                            ) : (
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={f.freightManual}
                                onChange={(e) => {
                                  setInboundItems((prev) =>
                                    prev.map((p) =>
                                      p.id === f.id ? { ...p, freightManual: e.target.value } : p
                                    )
                                  );
                                }}
                                placeholder={alloc > 0 ? alloc.toFixed(2) : "0"}
                                title="默认按金额占比自动分摊；手动输入金额可锁定该行运费，其余行分摊剩余"
                                className={`w-full px-2 py-1 text-xs text-right rounded border focus:outline-none focus:border-blue-400 ${
                                  f.freightManual.trim() !== ""
                                    ? "border-amber-400 bg-amber-50 text-gray-900"
                                    : "border-gray-200 text-gray-500"
                                }`}
                              />
                            )}
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
                              sum + (parseInt(f.quantity, 10) || 0) * (parseFloat(f.unitCost) || 0),
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
                                sum + (parseInt(f.quantity, 10) || 0) * (parseFloat(f.unitCost) || 0),
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
                  onClick={batchModal ? handleConfirmBatchInbound : handleConfirmInbound}
                  disabled={submitting === `complete-${inboundModalOrder?.id}` || submitting === `batch-${batchModal?.id}`}
                  className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  {(batchModal ? submitting === `batch-${batchModal.id}` : submitting === `complete-${inboundModalOrder?.id}`) ? "处理中..." : "确认入库"}
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

      {/* 到货单确认入库弹窗（纯账务：运费+应付款，库存已上架） */}
      {到货入库弹窗 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-sm">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">确认入库 — {到货入库弹窗.receipt_no}</h3>
              <button
                type="button"
                onClick={() => set到货入库弹窗(null)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-3">
              <p className="text-xs text-gray-500">
                库存已在确认到货时上架，本步只生成入库单、记应付款和运费分摊。
              </p>
              {/* 销售单信息（2026-08-21）：验货时已录的显示出来；填了总金额则货款−抹零须对平 */}
              {到货入库弹窗.supplier_order_no && (
                <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded px-2 py-1.5">
                  供应商销售单：{到货入库弹窗.supplier_order_no}
                  {到货入库弹窗.supplier_order_amount != null && ` · 总金额 ¥${到货入库弹窗.supplier_order_amount}`}
                </p>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">运费金额(¥)</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={到货运费}
                  onChange={(e) => set到货运费(e.target.value)}
                  placeholder="0"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">优惠抹零(¥，可选)</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={到货抹零}
                  onChange={(e) => set到货抹零(e.target.value)}
                  placeholder="供应商少收的零头"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                {到货入库弹窗.supplier_order_amount != null && (
                  <p className="text-xs text-gray-400 mt-1">
                    已录销售单总金额 ¥{到货入库弹窗.supplier_order_amount}：货款合计 − 抹零 须等于它，否则入库会被拦截
                  </p>
                )}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => set到货入库弹窗(null)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={提交到货入库}
                disabled={submitting === `arrival-${到货入库弹窗.id}`}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting === `arrival-${到货入库弹窗.id}` ? "处理中..." : "确认入库"}
              </button>
            </div>
          </div>
        </div>
      )}

      {确认弹窗}
    </div>
  );
}

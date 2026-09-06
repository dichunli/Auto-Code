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
import { 撤销收货处理, 删除采购明细, 撤销作废采购单, 撤销采购明细退回待采购, 暂存收货, 撤销暂存收货, 提交暂存收货 } from "@/app/procurement/actions";
import { 关联运单到供应商待收货单, 关联运单到采购单或配件, 设置运单豁免, 创建运单, 关联运单到采购单 } from "@/app/logistics/actions";
import { WaybillBatchForm } from "@/components/WaybillBatchForm";
import { SupplierPhoneInput } from "@/components/SupplierPhoneInput";
import { useDebounce } from "@/lib/useDebounce";
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
  /* 配件级运单关联/豁免（2026-08-21） */
  waybill_id: string | null;
  waybill_exempt: boolean | null;
  /* 收货暂存（2026-09-04）：确认收货先暂存不入账，手动提交统一入账 */
  staged_qty: number | null;
  staged_action: string | null;
  staged_at: string | null;
  /* 暂存操作人（2026-09-05 提交核对弹窗显示收货人） */
  staged_by: string | null;
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

/* 订单类型导出给采购看板 page.tsx：服务端首屏查询结果作为 props 传入用（待办清单第9项） */
export interface PurchaseOrder {
  id: string;
  order_no: string | null;
  supplier_id: string | null;
  status: string;
  total_amount: number | null;
  notes: string | null;
  waybill_id: string | null;
  /* 整单运单豁免（2026-08-21） */
  waybill_exempt: boolean | null;
  /* 供应商销售单（2026-08-21） */
  supplier_order_no: string | null;
  supplier_order_amount: number | null;
  supplier_slip_photos: string[] | null;
  logistics_company_id: string | null;
  created_at: string;
  suppliers: { id: string; name: string; region?: string | null; phone?: string | null } | null;
  logistics_companies: { name: string } | null;
  purchase_order_items: PurchaseOrderItem[];
  logistics_waybills: Waybill | null;
}

type GroupBy = "supplier" | "logistics";

/* 提交核对弹窗的行（2026-09-05） */
interface 核对行 {
  item: PurchaseOrderItem;
  订单号: string;
  收货人: string;
}
/* 提交核对弹窗的运单 */
interface 核对运单 {
  tracking_no: string;
  物流公司: string;
  freight_amount: number | null;
  cod_amount: number | null;
}

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

/* 首屏数据 props（服务端查询注入，待办清单第9项）：
   有 initialOrders 时首屏直接渲染、跳过 useEffect 里的 loadData，
   避免 SPA 软导航时 session 未就绪导致整页空白；后续操作照常走 loadData 刷新 */
interface PendingReceiptListProps {
  initialOrders?: PurchaseOrder[];
}

export function PendingReceiptList(props: PendingReceiptListProps) {
  const supabase = createClient();
  const { 请求确认, 确认弹窗 } = useConfirm();
  /* 价格显示开关：仅 admin/boss/warehouse 可见可用（其余角色 Context 层面已强制隐藏价格） */
  const { showPrices, canTogglePrices, togglePrices } = usePriceVisibility();
  /* 运单管理权限（待办清单第8项）：仅 admin/boss/warehouse 可关联/创建运单，
   * 其余角色（接待岗等）隐藏入口——表级 RLS 收紧后他们点了也会被拦，提前藏起来体验更好 */
  const [可管理运单, set可管理运单] = useState(true);
  useEffect(() => {
    let 已卸载 = false;
    async function 加载角色() {
      const { data: sessionData } = await supabase.auth.getSession();
      const data = { user: sessionData.session?.user ?? null }; /* getSession本地读不联网 */
      if (!data.user) return;
      const { data: prs } = await supabase
        .from("profile_roles")
        .select("roles(name)")
        .eq("profile_id", data.user.id);
      const 角色列表 = (prs || [])
        .map((r) => (r.roles as unknown as { name: string } | null)?.name || "")
        .filter(Boolean);
      if (!已卸载) {
        set可管理运单(角色列表.some((r) => r === "admin" || r === "boss" || r === "warehouse"));
      }
    }
    加载角色();
    return () => { 已卸载 = true; };
  }, [supabase]);
  const [orders, setOrders] = useState<PurchaseOrder[]>(props.initialOrders ?? []);
  const [loading, setLoading] = useState(!props.initialOrders);
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

  /* 批量创建运单弹窗（分步流程组件 WaybillBatchForm，2026-08-20 起与手机端共用） */
  const [batchModalOpen, setBatchModalOpen] = useState(false);

  /* 运单电话完全匹配才带入供应商名（2026-08-21 用户口径）：
     输入过程由 SupplierPhoneInput 联想下拉供选择；未点选时完全匹配才带出，不匹配清空防残留 */
  const debouncedWbPhone = useDebounce(wbPhone, 300);
  useEffect(() => {
    async function lookup() {
      if (!debouncedWbPhone.trim()) {
        setWbSupplierName("");
        return;
      }
      const { data } = await supabase
        .from("suppliers")
        .select("name")
        .eq("phone", debouncedWbPhone.trim())
        .limit(1);
      setWbSupplierName(data && data.length > 0 ? data[0].name : "");
    }
    lookup();
  }, [debouncedWbPhone, supabase]);

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
  /* 错发拍照取证（2026-08-20 需求2） */
  const [wrongEvidence, setWrongEvidence] = useState<string[]>([]);

  /* 多发处理选项 */
  const [excessChoice, setExcessChoice] = useState<"" | "return" | "keep">("");
  const [excessKeepPaid, setExcessKeepPaid] = useState<"" | "paid" | "free">("");

  /* 少发处理选项 */
  const [shortChoice, setShortChoice] = useState<"" | "repurchase" | "discard">("");
  const [shortEvidence, setShortEvidence] = useState<string[]>([]);

  useEffect(() => {
    /* 服务端已给首屏数据则跳过首次查询，避免重复拉取 */
    if (props.initialOrders) return;
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const { data, error } = await supabase
      .from("purchase_orders")
      .select(`
        id, order_no, supplier_id, status, total_amount, notes, waybill_id, waybill_exempt, created_at, logistics_company_id,
        supplier_order_no, supplier_order_amount, supplier_slip_photos,
        suppliers(id, name, region, phone),
        logistics_companies:logistics_company_id(name),
        purchase_order_items(
          id, name, brand, specification, quantity, unit_cost, received_qty,
          part_id, work_order_item_part_id, part_number, supplier_part_name,
          unit, category, license_plate, photos, notes, handle_action,
          discount_amount, evidence_photos, return_reason, waybill_id, waybill_exempt,
          staged_qty, staged_action, staged_at, staged_by
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

  /* 行级可收货口径（2026-08-21）：本地供应商直接可收；外阜单需 单头已关联运单/已豁免，
     或该配件行自己已关联运单/已豁免（配件级处理：一单多件只到了其中一件的运单场景） */
  function 行可收货(order: PurchaseOrder, item: PurchaseOrderItem): boolean {
    if (!orderNeedsWaybill(order)) return true;
    return !!(order.waybill_id || order.waybill_exempt || item.waybill_id || item.waybill_exempt);
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
    /* 兜底门禁：未处理运单的外阜行，转"运单处理"弹窗（正常由按钮点击拦截，不会走到这） */
    if (!行可收货(order, item)) {
      openGateModal(order, item);
      return;
    }
    setReceiveOrder(order);
    setReceiveItem(item);
    /* 数量不预填（2026-08-20 需求）：收货必须按实际点数手动填写，防止图省事直接确认 */
    setReceiveQty("");
    setReceiveProblem("");
    setBrokenChoice("");
    setBrokenEvidence([]);
    setWrongChoice("");
    setWrongEvidence([]);
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
    setWrongEvidence([]);
    setExcessChoice("");
    setExcessKeepPaid("");
    setShortChoice("");
    setShortEvidence([]);
  }

  /* 清空问题选择（2026-08-20 需求3）：误点破损/错发后再次点击取消，
     同时清掉子选项和证据照片，恢复可正常收货 */
  function 清空问题选择() {
    setReceiveProblem("");
    setBrokenChoice("");
    setBrokenEvidence([]);
    setWrongChoice("");
    setWrongEvidence([]);
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
          evidence_photos: wrongEvidence.length > 0 ? wrongEvidence : null,
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
      /* 2026-09-04 口径：确认收货先写暂存（stage_receiving_item），不入账；
         明细更新/补货克隆/状态重算/运单联动延后到「提交收货」时由 receive_staged_batch
         逐行调 receive_purchase_item 统一完成（一次事务） */
      const res = await 暂存收货(
        item.id,
        payload.received_qty,
        payload.handle_action,
        payload.evidence_photos ?? null
      );
      if (!res.success) throw new Error(res.error || "暂存失败");
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("收货暂存失败: " + msg);
    } finally {
      setSubmitting(null);
    }
  }

  /* 供应商销售单号（2026-09-04）：按供应商存，提交暂存收货时写到涉及的所有采购单 */
  const [slipNoBySupplier, setSlipNoBySupplier] = useState<Record<string, string>>({});

  /* 提交核对弹窗（2026-09-05）：提交前显示运单/供应商/明细/收货人清单核对，确认后才入账 */
  const [stagedConfirm, setStagedConfirm] = useState<{
    供应商id: string;
    供应商名: string;
    行列表: 核对行[];
    运单们: 核对运单[];
    加载中: boolean;
  } | null>(null);

  /* 打开提交核对弹窗：收集该供应商暂存行 + 收货人 + 运单信息 */
  async function openStagedConfirm(供应商id: string, 供应商名: string) {
    setStagedConfirm({ 供应商id, 供应商名, 行列表: [], 运单们: [], 加载中: true });
    const 行列表: 核对行[] = [];
    const 收货人ids = new Set<string>();
    const 运单ids = new Set<string>();
    for (const order of orders) {
      if (order.supplier_id !== 供应商id) continue;
      for (const item of order.purchase_order_items || []) {
        if (item.staged_at && !item.handle_action) {
          行列表.push({ item, 订单号: order.order_no || order.id.slice(0, 8), 收货人: "" });
          if (item.staged_by) 收货人ids.add(item.staged_by);
          if (order.waybill_id) 运单ids.add(order.waybill_id);
          if (item.waybill_id) 运单ids.add(item.waybill_id);
        }
      }
    }

    /* 收货人名（staged_by → profiles.full_name） */
    const 收货人Map = new Map<string, string>();
    if (收货人ids.size > 0) {
      const { data: 员工们 } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", Array.from(收货人ids));
      for (const e of (员工们 || []) as { id: string; full_name: string | null }[]) {
        收货人Map.set(e.id, e.full_name || "-");
      }
    }
    for (const r of 行列表) {
      r.收货人 = r.item.staged_by ? 收货人Map.get(r.item.staged_by) || "-" : "-";
    }

    /* 运单详情（单头关联 + 配件级关联，可能多张） */
    let 运单们: 核对运单[] = [];
    if (运单ids.size > 0) {
      const { data: 运单数据 } = await supabase
        .from("logistics_waybills")
        .select("tracking_no, logistics_company_name, freight_amount, cod_amount, logistics_companies(name)")
        .in("id", Array.from(运单ids));
      运单们 = ((运单数据 || []) as unknown as {
        tracking_no: string; logistics_company_name: string | null;
        freight_amount: number | null; cod_amount: number | null;
        logistics_companies: { name: string } | null;
      }[]).map((w) => ({
        tracking_no: w.tracking_no,
        物流公司: w.logistics_companies?.name || w.logistics_company_name || "-",
        freight_amount: w.freight_amount,
        cod_amount: w.cod_amount,
      }));
    }
    setStagedConfirm({ 供应商id, 供应商名, 行列表, 运单们, 加载中: false });
  }

  /* 撤销暂存（收错了重收） */
  async function handleUnstage(item: PurchaseOrderItem) {
    if (!(await 请求确认("确认撤销该配件的收货暂存？撤销后可重新收货。"))) return;
    setSubmitting(`unstage-${item.id}`);
    try {
      const res = await 撤销暂存收货(item.id);
      if (!res.success) throw new Error(res.error || "撤销失败");
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("撤销失败: " + msg);
    } finally {
      setSubmitting(null);
    }
  }

  /* 提交暂存收货（按供应商统一入账，一次事务；由核对弹窗确认后调用，不再二次确认） */
  async function handleSubmitStaged(供应商id: string, 供应商名: string) {
    const 销售单号 = slipNoBySupplier[供应商名]?.trim() || null;
    setSubmitting(`submit-${供应商id}`);
    try {
      const res = await 提交暂存收货(供应商id, 销售单号);
      if (!res.success) throw new Error(res.error || "提交失败");
      alert(`提交成功，已入账 ${res.count} 件`);
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("提交失败: " + msg);
    } finally {
      setSubmitting(null);
    }
  }

  /* 核对弹窗点「确认提交」→ 关弹窗并提交入账 */
  async function confirmStagedSubmit() {
    if (!stagedConfirm) return;
    const { 供应商id, 供应商名 } = stagedConfirm;
    setStagedConfirm(null);
    await handleSubmitStaged(供应商id, 供应商名);
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

  /* ------------------ 单个配件 撤销/作废（2026-08-20 需求5） ------------------
     撤销：配件退回待采购列表，下次可重新组单采购（revoke_purchase_item_to_pending 事务）
     作废：彻底删除该配件（采购明细+工单配件行都清除，delete_purchase_item 事务） */

  async function handleRevokeItemToPending(order: PurchaseOrder, item: PurchaseOrderItem) {
    if (!(await 请求确认(`确认把「${item.name}」退回待采购？该配件将从本采购单移除，回到待采购列表。`))) return;
    setSubmitting(`item-${item.id}`);
    try {
      const res = await 撤销采购明细退回待采购(order.id, item.id);
      if (!res.success) throw new Error(res.error || "撤销失败");
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("撤销失败: " + msg);
    } finally {
      setSubmitting(null);
    }
  }

  async function handleDiscardItem(order: PurchaseOrder, item: PurchaseOrderItem) {
    if (!(await 请求确认(`确认作废「${item.name}」？该配件的采购记录和工单记录都会彻底删除，不可恢复！`))) return;
    setSubmitting(`item-${item.id}`);
    try {
      const res = await 删除采购明细(order.id, item.id);
      if (!res.success) throw new Error(res.error || "作废失败");
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("作废失败: " + msg);
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

  /* ------------------ 运单处理弹窗（2026-08-21） ------------------
     外阜单未关联运单时点灰色收货按钮弹出：关联运单（整单/仅当前配件）
     或勾选"不关联运单"豁免（记录运费+说明，如自行采购/其它方式带回） */

  const [gateOrder, setGateOrder] = useState<PurchaseOrder | null>(null);
  const [gateItem, setGateItem] = useState<PurchaseOrderItem | null>(null);
  const [gateTab, setGateTab] = useState<"link" | "exempt">("link");
  const [gateScope, setGateScope] = useState<"order" | "item">("order");
  const [gateWaybills, setGateWaybills] = useState<Waybill[]>([]);
  const [gateWaybillId, setGateWaybillId] = useState("");
  const [gateFreight, setGateFreight] = useState("");
  const [gateNote, setGateNote] = useState("");
  const [gateLoading, setGateLoading] = useState(false);

  async function openGateModal(order: PurchaseOrder, item: PurchaseOrderItem) {
    setGateOrder(order);
    setGateItem(item);
    /* 无运单管理权限的角色直接落到豁免通道 */
    setGateTab(可管理运单 ? "link" : "exempt");
    setGateScope("order");
    setGateWaybillId("");
    setGateFreight("");
    setGateNote("");
    setGateLoading(true);
    const { data } = await supabase
      .from("logistics_waybills")
      .select("id, tracking_no, logistics_company_name, supplier_name, freight_amount, cod_amount, status, logistics_companies(name)")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    const 列表 = (data || []) as unknown as Waybill[];
    /* 与当前单供应商同名的运单排在前面，方便直接选 */
    const 目标 = order.suppliers?.name;
    if (目标) {
      列表.sort((a, b) => (b.supplier_name === 目标 ? 1 : 0) - (a.supplier_name === 目标 ? 1 : 0));
    }
    setGateWaybills(列表);
    setGateLoading(false);
  }

  function closeGateModal() {
    setGateOrder(null);
    setGateItem(null);
    setGateWaybills([]);
    setGateWaybillId("");
  }

  async function handleGateConfirm() {
    if (!gateOrder || !gateItem) return;
    const 明细id = gateScope === "item" ? gateItem.id : null;
    if (gateTab === "link" && !gateWaybillId) {
      alert("请选择运单");
      return;
    }
    setSubmitting("gate");
    try {
      /* 先在本地对象上打补丁，确认后收货弹窗立即放行，不必等 loadData 往返 */
      const 单 = { ...gateOrder };
      const 件 = { ...gateItem };
      if (gateTab === "link") {
        const res = await 关联运单到采购单或配件(gateOrder.id, 明细id, gateWaybillId);
        if (!res.success) throw new Error(res.error || "关联失败");
        if (gateScope === "order") 单.waybill_id = gateWaybillId;
        else 件.waybill_id = gateWaybillId;
      } else {
        const 运费 = gateFreight.trim() === "" ? null : parseFloat(gateFreight);
        if (运费 !== null && (isNaN(运费) || 运费 < 0)) {
          alert("运费必须是非负数字");
          return;
        }
        const res = await 设置运单豁免(gateOrder.id, 明细id, 运费, gateNote);
        if (!res.success) throw new Error(res.error || "保存失败");
        if (gateScope === "order") 单.waybill_exempt = true;
        else 件.waybill_exempt = true;
      }
      closeGateModal();
      loadData();
      /* 处理完直接进收货弹窗，动线连贯 */
      openReceiveModal(单, 件);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("操作失败: " + msg);
    } finally {
      setSubmitting(null);
    }
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

  /* 待收组（2026-09-06 分栏）：只显示还有"未处理且未暂存"行的单——
     收一件（暂存）走一件，待收货区只剩没收的，一目了然 */
  const displayGroups = useMemo(() => {
    const 有待收行 = filteredOrders.filter((o) =>
      (o.purchase_order_items || []).some((it) => !it.handle_action && !it.staged_at)
    );
    const map = new Map<string, PurchaseOrder[]>();
    for (const o of 有待收行) {
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

  /* 已暂存组（分栏右侧）：按供应商分组的暂存行清单 */
  const stagedGroups = useMemo(() => {
    const map = new Map<string, { order: PurchaseOrder; item: PurchaseOrderItem }[]>();
    for (const o of filteredOrders) {
      for (const it of o.purchase_order_items || []) {
        if (it.staged_at && !it.handle_action) {
          const key = o.suppliers?.name || "未指定供应商";
          if (!map.has(key)) map.set(key, []);
          map.get(key)!.push({ order: o, item: it });
        }
      }
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, "zh"))
      .map(([key, list]) => ({ key, list }));
  }, [filteredOrders]);

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
      /* 创建运单走 Server Action（含电话命中供应商检测） */
      const 创建结果 = await 创建运单({
        trackingNo: wbTrackingNo,
        logisticsCompanyId: wbCompanyId,
        logisticsCompanyName: company?.name || "",
        phone: wbPhone,
        supplierName: wbSupplierName,
        packageCount: parseInt(wbPackageCount) || 1,
        freightAmount: parseFloat(wbFreight) || 0,
        codAmount: parseFloat(wbCod) || 0,
        photos: wbPhotos,
      });
      if (!创建结果.success || !创建结果.waybillId) {
        throw new Error(创建结果.error || "创建运单失败");
      }
      const waybillId = 创建结果.waybillId;

      if (isBatch) {
        /* 批量创建运单后自动关联到选中的采购单（走 Server Action） */
        const res = await 关联运单到采购单(waybillId, Array.from(selectedOrderIds));
        if (!res.success) throw new Error(res.error || "关联采购单失败");
        alert(`运单创建成功，已自动关联 ${selectedOrderIds.size} 张采购单`);
        setSelectedOrderIds(new Set());
        setBatchWaybillMode(false);
      } else if (isStandalone) {
        /* 需求2（2026-08-20）：运单电话命中供应商时，弹问是否关联其待收货采购单；
           2026-08-21 改完全匹配：防止电话片段误关联到别家供应商 */
        if (创建结果.命中供应商id && (创建结果.待关联单数 || 0) > 0) {
          const 同意 = await 请求确认(
            `运单电话命中供应商「${创建结果.命中供应商名}」，该供应商有 ${创建结果.待关联单数} 张待收货采购单，是否关联到这张运单？`
          );
          if (同意) {
            const res = await 关联运单到供应商待收货单(waybillId, 创建结果.命中供应商id);
            if (!res.success) throw new Error(res.error || "关联采购单失败");
            alert(`运单创建成功，已关联 ${res.count} 张待收货采购单`);
          } else {
            alert("运单创建成功");
          }
        } else {
          alert("运单创建成功,请用「批量关联运单」或各单「选择已有运单」进行关联");
        }
      } else {
        /* 单张关联（走 Server Action） */
        const res = await 关联运单到采购单(waybillId, [createWaybillOrder!.id]);
        if (!res.success) throw new Error(res.error || "关联采购单失败");
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
      /* 批量关联（走 Server Action） */
      const res = await 关联运单到采购单(waybillId, Array.from(selectedOrderIds));
      if (!res.success) {
        alert("批量关联运单失败: " + (res.error || "未知错误"));
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
    /* 单张关联（走 Server Action） */
    const res = await 关联运单到采购单(waybillId, [orderId]);
    if (!res.success) {
      alert("关联运单失败: " + (res.error || "未知错误"));
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
    if (wbCompanies.length === 0) {
      supabase
        .from("logistics_companies")
        .select("id, name, scopes")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true })
        .then(({ data }) => setWbCompanies(data || []));
    }
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
      {/* 分组/筛选/操作按钮区：手机端隐藏（2026-08-20 需求8），手机只做收货，列表直接展示 */}
      <div className="hidden md:flex items-center gap-2 flex-wrap">
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
        <Link
          href="/procurement/arrivals"
          className="px-3 py-1 text-xs rounded border border-green-300 text-green-700 bg-green-50 hover:bg-green-100"
        >
          到货确认单（新流程）
        </Link>
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
        {可管理运单 && (
          <>
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
          </>
        )}
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

      {/* 分栏布局（2026-09-06 用户拍板）：左=待收货（未收的），右=已暂存（待提交）。
          收一件走一件，待收区只剩没收的，一目了然 */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* 左列：待收货 */}
        <div className="flex-1 min-w-0 w-full space-y-4">
          {displayGroups.length === 0 && (
            <div className="bg-white rounded-xl border border-dashed border-gray-200 p-8 text-center text-gray-400 text-sm">
              待收货的都收完了，去右侧核对提交
            </div>
          )}
          {displayGroups.map((g) => {
        return (
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
                        {可管理运单 && (
                          <button
                            type="button"
                            onClick={() => openWaybillModal(order.id)}
                            className="text-blue-600 hover:underline text-xs"
                          >
                            更换
                          </button>
                        )}
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
                        {可管理运单 && (
                          <button
                            type="button"
                            onClick={() => openWaybillModal(order.id)}
                            className="px-2 py-0.5 text-xs rounded border border-gray-200 text-gray-600 bg-white hover:bg-gray-50"
                          >
                            选择已有运单
                          </button>
                        )}
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
                        {/* 分栏口径（2026-09-06）：待收区只显示「未收且未暂存」的行，
                            暂存的行自动移到右侧已暂存区，收一件走一件一目了然 */}
                        {order.purchase_order_items.filter((it) => !it.handle_action && !it.staged_at).map((item, idx) => {
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
                                ) : item.staged_at ? (
                                  /* 已暂存（2026-09-04）：确认收货未提交入账的状态，黄色标记 */
                                  <span className="text-xs px-2 py-0.5 rounded whitespace-nowrap bg-yellow-100 text-yellow-700">
                                    已暂存{item.staged_action && ACTION_LABELS[item.staged_action] ? "·" + ACTION_LABELS[item.staged_action].text : ""}
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
                                  ) : item.staged_at ? (
                                    /* 已暂存（2026-09-04）：可撤销重收 */
                                    <button
                                      type="button"
                                      onClick={() => handleUnstage(item)}
                                      disabled={submitting === `unstage-${item.id}`}
                                      title="撤销这次暂存的收货，重新收货"
                                      className="px-2 py-1 text-xs rounded border border-yellow-300 text-yellow-700 bg-yellow-50 hover:bg-yellow-100 disabled:opacity-50 whitespace-nowrap"
                                    >
                                      {submitting === `unstage-${item.id}` ? "撤销中..." : "撤销暂存"}
                                    </button>
                                  ) : (
                                    <>
                                      {/* 行级运单门禁（2026-08-21）：未关联也未豁免时按钮半透明但可点，
                                          点击弹出"运单处理"窗（关联运单/不关联运单豁免） */}
                                      {(() => {
                                        const 可收 = 行可收货(order, item);
                                        return (
                                          <button
                                            type="button"
                                            onClick={() => (可收 ? openReceiveModal(order, item) : openGateModal(order, item))}
                                            disabled={submitting === `item-${item.id}`}
                                            title={可收 ? undefined : "外阜供货商需先处理运单（点击关联或豁免）"}
                                            className={`px-3 py-1 text-xs rounded whitespace-nowrap disabled:opacity-50 ${
                                              可收
                                                ? "bg-blue-600 text-white hover:bg-blue-700"
                                                : "bg-blue-600/40 text-white hover:bg-blue-600/60"
                                            }`}
                                          >
                                            收货
                                          </button>
                                        );
                                      })()}
                                      {/* 配件级撤销/作废（2026-08-20 需求5）：撤销=退回待采购可重新组单；作废=彻底删除 */}
                                      <button
                                        type="button"
                                        onClick={() => handleRevokeItemToPending(order, item)}
                                        disabled={submitting === `item-${item.id}`}
                                        title="退回待采购列表，下次可重新组单采购"
                                        className="text-xs text-amber-600 hover:text-amber-700 hover:underline disabled:opacity-50 whitespace-nowrap"
                                      >
                                        撤销
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDiscardItem(order, item)}
                                        disabled={submitting === `item-${item.id}`}
                                        title="彻底删除该配件（采购记录和工单记录都会清除）"
                                        className="text-xs text-red-400 hover:text-red-600 hover:underline disabled:opacity-50 whitespace-nowrap"
                                      >
                                        作废
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
        );
      })}
        </div>

        {/* 右列：已暂存待提交（2026-09-06 分栏）：收一件自动移到这里，核对清单+提交 */}
        {stagedGroups.length > 0 && (
          <div className="w-full lg:w-[400px] lg:shrink-0 lg:sticky lg:top-4 space-y-3">
            <div className="bg-yellow-50 rounded-xl border border-yellow-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-yellow-200 bg-yellow-100/60">
                <h3 className="text-sm font-bold text-yellow-800">已暂存 · 待提交</h3>
                <p className="text-xs text-yellow-700 mt-0.5">收完的货自动归到这里，核对销售单后统一提交入账</p>
              </div>
              <div className="divide-y divide-yellow-100">
                {stagedGroups.map((g) => {
                  const 组供应商id = g.list[0]?.order.supplier_id || null;
                  return (
                    <div key={g.key} className="px-4 py-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-gray-900">{g.key}</span>
                        <span className="text-xs text-yellow-700 font-medium">{g.list.length} 件</span>
                      </div>
                      <div className="space-y-1.5 mb-3">
                        {g.list.map(({ order: o, item: it }) => {
                          const 动作标签 = it.staged_action ? ACTION_LABELS[it.staged_action] : null;
                          const 不符 = it.staged_qty != null && it.staged_qty !== it.quantity;
                          return (
                            <div key={it.id} className={`flex items-center gap-2 text-xs rounded-lg px-2 py-1.5 ${不符 ? "bg-red-50 border border-red-200" : "bg-white border border-yellow-100"}`}>
                              <button
                                type="button"
                                onClick={() => handleUnstage(it)}
                                disabled={submitting === `unstage-${it.id}`}
                                title="撤销暂存，重新收货"
                                className="text-yellow-600 hover:text-yellow-800 shrink-0 disabled:opacity-50"
                              >
                                ↩
                              </button>
                              <div className="min-w-0 flex-1">
                                <div className="font-medium text-gray-900 truncate">{it.name}</div>
                                <div className="text-gray-400 text-[10px]">{o.order_no || o.id.slice(0, 8)}</div>
                              </div>
                              <div className={`text-right shrink-0 ${不符 ? "text-red-600 font-medium" : "text-gray-600"}`}>
                                订{it.quantity} 实{it.staged_qty ?? "-"}
                              </div>
                              {动作标签 && (
                                <span className={`text-[10px] px-1 py-0.5 rounded shrink-0 ${动作标签.color}`}>{动作标签.text}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {/* 提交区：销售单号+提交按钮 */}
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={slipNoBySupplier[g.key] || ""}
                          onChange={(e) => setSlipNoBySupplier((prev) => ({ ...prev, [g.key]: e.target.value }))}
                          placeholder="供应商销售单号（提交时记入）"
                          className="w-full px-2.5 py-1.5 text-xs rounded border border-yellow-300 bg-white focus:outline-none focus:border-yellow-500"
                        />
                        {组供应商id && (
                          <button
                            type="button"
                            onClick={() => openStagedConfirm(组供应商id, g.key)}
                            disabled={submitting === `submit-${组供应商id}`}
                            className="w-full py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
                          >
                            {submitting === `submit-${组供应商id}` ? "提交中..." : `提交收货（${g.list.length} 件）`}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 运单处理弹窗（2026-08-21）：外阜单未关联运单时点收货弹出，关联运单或豁免 */}
      {gateOrder && gateItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-md max-h-[85vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">需要先处理运单</h3>
              <button
                type="button"
                onClick={closeGateModal}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto">
              <p className="text-sm text-gray-600">
                <span className="font-medium text-gray-900">{gateOrder.suppliers?.name}</span>{" "}
                是外阜供应商，货一般走物流。请关联运单；没有运单的（自行采购/捎带等）选「不关联运单」并写明情况。
              </p>

              {/* 模式选择（无运单管理权限的角色只显示豁免通道） */}
              {可管理运单 ? (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setGateTab("link")}
                    className={`py-2 text-sm rounded-lg border transition-colors ${
                      gateTab === "link"
                      ? "border-blue-500 bg-blue-50 text-blue-700 font-medium"
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    关联运单
                  </button>
                  <button
                    type="button"
                    onClick={() => setGateTab("exempt")}
                    className={`py-2 text-sm rounded-lg border transition-colors ${
                      gateTab === "exempt"
                      ? "border-amber-500 bg-amber-50 text-amber-700 font-medium"
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    不关联运单
                  </button>
                </div>
              ) : (
                <p className="text-xs text-gray-500">无运单管理权限，请选「不关联运单」并写明情况，或联系仓管处理。</p>
              )}

              {/* 作用范围：整单 / 仅当前配件（一单多件只到了其中一件的运单场景） */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">作用于:</span>
                <button
                  type="button"
                  onClick={() => setGateScope("order")}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                    gateScope === "order"
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  整张采购单
                </button>
                <button
                  type="button"
                  onClick={() => setGateScope("item")}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                    gateScope === "item"
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  仅当前配件
                </button>
              </div>

              {gateTab === "link" ? (
                gateLoading ? (
                  <div className="text-center text-gray-400 py-6 text-sm">加载运单...</div>
                ) : gateWaybills.length === 0 ? (
                  <div className="text-center text-gray-400 py-6 text-sm">
                    暂无待签收运单，可先到页面顶部「创建运单」
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-56 overflow-y-auto">
                    {gateWaybills.map((w) => (
                      <label
                        key={w.id}
                        className={`flex items-center gap-2 p-2.5 border rounded-lg cursor-pointer transition-colors ${
                          gateWaybillId === w.id ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:bg-gray-50"
                        }`}
                      >
                        <input
                          type="radio"
                          name="gateWaybill"
                          checked={gateWaybillId === w.id}
                          onChange={() => setGateWaybillId(w.id)}
                        />
                        <div className="text-sm">
                          <span className="font-medium text-gray-900">{w.tracking_no}</span>
                          <span className="text-xs text-gray-500 ml-2">
                            {w.logistics_companies?.name || w.logistics_company_name || "-"}
                            {w.supplier_name ? ` · ${w.supplier_name}` : ""}
                            {/* 同供应商醒目标记（2026-09-05）：运单可跨供应商关联 */}
                            {gateOrder?.suppliers?.name && w.supplier_name === gateOrder.suppliers.name && (
                              <span className="ml-1.5 px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-[10px] font-bold">同供应商</span>
                            )}
                          </span>
                        </div>
                      </label>
                    ))}
                  </div>
                )
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">运费（可选，元）</label>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={gateFreight}
                      onChange={(e) => setGateFreight(e.target.value)}
                      placeholder="没产生运费可不填"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">说明 *</label>
                    <input
                      type="text"
                      value={gateNote}
                      onChange={(e) => setGateNote(e.target.value)}
                      placeholder="如：自行采购、其它方式带回"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                    <div className="flex gap-1.5 mt-2 flex-wrap">
                      {["自行采购", "司机捎带", "其它方式带回"].map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setGateNote(t)}
                          className="px-2.5 py-1 text-xs rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50"
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeGateModal}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleGateConfirm}
                disabled={submitting === "gate"}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting === "gate" ? "处理中..." : "确认并收货"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 提交收货核对弹窗（2026-09-05）：运单/供应商/收货明细/收货人，核对后确认才入账 */}
      {stagedConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">
                提交收货核对 — {stagedConfirm.供应商名}
              </h3>
              <button
                type="button"
                onClick={() => setStagedConfirm(null)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto">
              {stagedConfirm.加载中 ? (
                <div className="text-center text-gray-400 py-8 text-sm">加载清单...</div>
              ) : (
                <>
                  {/* 运单信息 */}
                  {stagedConfirm.运单们.length > 0 && (
                    <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-3 space-y-1">
                      <div className="text-xs font-medium text-blue-800 mb-1">关联运单</div>
                      {stagedConfirm.运单们.map((w, i) => (
                        <div key={i} className="text-sm text-gray-700">
                          <span className="font-medium">{w.tracking_no}</span>
                          <span className="text-gray-500 ml-2">
                            {w.物流公司} · 运费 ¥{Number(w.freight_amount || 0).toFixed(2)} · 代收 ¥{Number(w.cod_amount || 0).toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 供应商销售单号 */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 shrink-0">供应商销售单号:</span>
                    <input
                      type="text"
                      value={slipNoBySupplier[stagedConfirm.供应商名] || ""}
                      onChange={(e) =>
                        setSlipNoBySupplier((prev) => ({ ...prev, [stagedConfirm.供应商名]: e.target.value }))
                      }
                      placeholder="提交时记入，对账用"
                      className="flex-1 px-2.5 py-1.5 text-xs rounded border border-gray-300 focus:outline-none focus:border-blue-400"
                    />
                  </div>

                  {/* 收货明细（对照销售单核对） */}
                  <div>
                    <div className="text-xs font-medium text-gray-700 mb-1.5">
                      收货明细（{stagedConfirm.行列表.length} 件）— 请对照供应商销售单核对
                    </div>
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">配件</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">采购单</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">订购</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">实收</th>
                            <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">处理</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">收货人</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {stagedConfirm.行列表.map((r, i) => {
                            const 动作标签 = r.item.staged_action ? ACTION_LABELS[r.item.staged_action] : null;
                            const 不符 = r.item.staged_qty != null && r.item.staged_qty !== r.item.quantity;
                            return (
                              <tr key={i} className={不符 ? "bg-red-50/50" : ""}>
                                <td className="px-3 py-2 text-gray-900 font-medium">{r.item.name}</td>
                                <td className="px-3 py-2 text-gray-500 text-xs">{r.订单号}</td>
                                <td className="px-3 py-2 text-right text-gray-700">{r.item.quantity}</td>
                                <td className={`px-3 py-2 text-right font-medium ${不符 ? "text-red-600" : "text-gray-900"}`}>
                                  {r.item.staged_qty ?? "-"}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  {动作标签 ? (
                                    <span className={`text-xs px-1.5 py-0.5 rounded ${动作标签.color}`}>{动作标签.text}</span>
                                  ) : (
                                    <span className="text-xs text-gray-400">-</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-gray-600 text-xs">{r.收货人}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-red-500 mt-1.5">
                      红色行为实收数与订购数不一致，请重点核对是否与销售单一致
                    </p>
                  </div>
                </>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setStagedConfirm(null)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmStagedSubmit}
                disabled={stagedConfirm.加载中 || submitting === `submit-${stagedConfirm.供应商id}`}
                className="px-4 py-2 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {submitting === `submit-${stagedConfirm.供应商id}`
                  ? "提交中..."
                  : `确认提交（${stagedConfirm.行列表.length} 件）`}
              </button>
            </div>
          </div>
        </div>
      )}

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
                                  {/* 同供应商醒目标记（2026-09-05）：运单可跨供应商关联，同供应商的排前并标记 */}
                                  {isMatch && (
                                    <span className="ml-1.5 px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-[10px] font-bold">同供应商</span>
                                  )}
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
                  {/* 逐字联想（2026-08-20 需求6/7）：点选候选后电话+供应商名一起回填 */}
                  <SupplierPhoneInput
                    value={wbPhone}
                    onChange={setWbPhone}
                    onSelect={(供应商) => {
                      setWbPhone(供应商.phone || "");
                      setWbSupplierName(供应商.name);
                    }}
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

      {/* 批量创建运单弹窗（2026-08-20 改分步流程：选公司→数量→逐卡片填写，与手机端共用组件） */}
      {batchModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
              <h2 className="text-base font-semibold text-gray-900">批量创建运单</h2>
              <button
                type="button"
                onClick={() => setBatchModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-4 bg-gray-50">
              <WaybillBatchForm
                公司列表={wbCompanies}
                提交完成后={() => {
                  setBatchModalOpen(false);
                  loadData();
                }}
              />
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
                  autoFocus
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
                      <div className="text-xs text-gray-500 mb-2">反馈问题(可选,二选一,再次点击可取消)</div>
                      <div className="flex gap-3">
                        <label className="flex items-center gap-2 cursor-pointer flex-1 px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">
                          <input
                            type="radio"
                            name="receiveProblem"
                            checked={receiveProblem === "broken"}
                            onChange={() => {
                              setReceiveProblem("broken");
                              /* 切换问题时清掉另一边的子选项，避免脏数据 */
                              setWrongChoice("");
                              setWrongEvidence([]);
                            }}
                            onClick={() => {
                              /* radio 已选中时再点不会触发 onChange，用 onClick 实现再点取消 */
                              if (receiveProblem === "broken") 清空问题选择();
                            }}
                          />
                          <span className="text-sm text-gray-900">配件破损</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer flex-1 px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">
                          <input
                            type="radio"
                            name="receiveProblem"
                            checked={receiveProblem === "wrong"}
                            onChange={() => {
                              setReceiveProblem("wrong");
                              setBrokenChoice("");
                              setBrokenEvidence([]);
                            }}
                            onClick={() => {
                              if (receiveProblem === "wrong") 清空问题选择();
                            }}
                          />
                          <span className="text-sm text-gray-900">配件错发</span>
                        </label>
                      </div>
                      {receiveProblem && (
                        <button
                          type="button"
                          onClick={清空问题选择}
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
                          {/* 破损拍照取证（2026-08-20 需求2）：作为与供应商交涉的凭证 */}
                          <div className="pt-1">
                            <label className="block text-xs text-gray-600 mb-1">破损照片（拍照取证）</label>
                            <ImageUploader
                              onUpload={(paths) => setBrokenEvidence(paths)}
                              existingImages={brokenEvidence}
                              maxImages={5}
                              bucket="work-order-media"
                              folder="purchase-evidence"
                            />
                          </div>
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
                          {/* 错发拍照取证（2026-08-20 需求2）：作为与供应商交涉的凭证 */}
                          <div className="pt-1">
                            <label className="block text-xs text-gray-600 mb-1">错发照片（拍照取证）</label>
                            <ImageUploader
                              onUpload={(paths) => setWrongEvidence(paths)}
                              existingImages={wrongEvidence}
                              maxImages={5}
                              bucket="work-order-media"
                              folder="purchase-evidence"
                            />
                          </div>
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

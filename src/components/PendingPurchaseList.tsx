"use client";

import { useEffect, useMemo, useState, Fragment } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { filterLogisticsByRegion, REGION_LABELS } from "@/lib/logisticsFilter";
import { PriceValue } from "@/components/PriceVisibilityContext";
import { PartSearchDropdown } from "@/components/PartSearchDropdown";
import { useConfirm } from "./ConfirmDialog";
import { 移除采购暂存行 } from "@/app/procurement/actions";
import PartForm from "@/app/parts/new/PartForm";
import { PURCHASE_REASON_LABELS } from "@/lib/purchaseFlowLabels";
import { usePartLinking } from "./usePartLinking";
import { 创建采购单, 更新工单配件客户意见, 添加采购暂存 } from "@/app/procurement/actions";
import type { 采购明细输入 } from "@/app/procurement/actions";
import { DocumentNameInput } from "./DocumentNameInput";
import CustomPurchaseModal from "./CustomPurchaseModal";
import PurchaseOrderNotifyModal, { type 采购通知数据, type 采购通知明细 } from "./PurchaseOrderNotifyModal";

interface PartBranchRow {
  id: string;
  name: string;
  brand: string | null;
  specification: string | null;
  unit: string | null;
  quantity: number;
  unit_cost: number | null;
  unit_price: number | null;
  customer_opinion: string | null;
  supplier_name: string | null;
  part_id: string | null;
  part_number: string | null;
  part_name_id: string | null;
  alias_name: string | null;
  document_name: string | null;
  notes: string | null;
  purchase_reason: string | null;
  work_order_item_id: string;
  work_order_items: {
    name: string;
    work_orders: {
      id: string;
      order_no: string;
      settled_at: string | null;
      order_type: string | null;
      customers: { name: string; phone: string | null } | null;
      vehicles: { plate_number: string | null; vin: string | null } | null;
    } | null;
  } | null;
  parts: { quantity: number | null } | null;
  /* 自定义采购暂存行（2026-08-15）：非空表示这行来自 custom_purchase_staging（无工单），
     id 即暂存表 id，发起采购成功后删除 */
  staging?: { id: string; supplier_id: string | null } | null;
}

interface Supplier {
  id: string;
  name: string;
  region?: string | null;
}

interface LogisticsCompany {
  id: string;
  name: string;
  scopes?: string[] | null;
}

interface LowStockPart {
  id: string;
  part_number: string | null;
  name: string;
  brand: string | null;
  specification: string | null;
  unit: string | null;
  quantity: number;
  min_stock: number;
  unit_cost: number | null;
  supplier_id: string | null;
  supplier_name: string | null;
  document_name: string | null;
}

type GroupBy = "plate" | "category" | "name" | "supplier";

const GROUP_OPTIONS: { key: GroupBy; label: string }[] = [
  { key: "plate", label: "按车牌" },
  { key: "category", label: "按分类" },
  { key: "name", label: "按名称" },
  { key: "supplier", label: "按供货商" },
];

const BRANCH_BG_COLORS = [
  "bg-blue-50/40",
  "bg-green-50/40",
  "bg-purple-50/40",
  "bg-pink-50/40",
  "bg-indigo-50/40",
  "bg-orange-50/40",
  "bg-cyan-50/40",
];

/* 配件需求来源标签 — 由「待收货」流程中的换货/补货动作生成 */
/* purchase_reason 徽标已抽到 @/lib/purchaseFlowLabels（唯一来源） */

function getGroupKey(r: PartBranchRow, groupBy: GroupBy): string {
  switch (groupBy) {
    case "plate":
      return r.work_order_items?.work_orders?.vehicles?.plate_number || "(无车牌)";
    case "category":
      return r.work_order_items?.name || "(无项目)";
    case "name":
      return r.name || "(无名)";
    case "supplier":
      return r.supplier_name || "(未指定供应商)";
    default:
      return "";
  }
}

export function PendingPurchaseList() {
  const supabase = createClient();
  const { 请求确认, 确认弹窗 } = useConfirm();
  const [rows, setRows] = useState<PartBranchRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [logisticsCompanies, setLogisticsCompanies] = useState<LogisticsCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /* 供应商列已改只读（2026-08-14）：supplierMap/setRowSupplier 已删除，
     供应商一律取行上的 supplier_name（询价阶段确定） */
  const [logisticsMap, setLogisticsMap] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>("supplier");
  /* 供应商筛选标签（2026-08-15 用户要求）：null=全部 */
  const [供应商筛选, set供应商筛选] = useState<string | null>(null);
  const [notArrivedMarks, setNotArrivedMarks] = useState<Record<string, string>>({});

  /* 物流选择弹窗 */
  const [showLogisticsModal, setShowLogisticsModal] = useState(false);
  const [selectedLogisticsId, setSelectedLogisticsId] = useState("");
  const [filteredLogistics, setFilteredLogistics] = useState<LogisticsCompany[]>([]);
  const [modalRegion, setModalRegion] = useState<string | null>(null);

  /* 安全库存配件弹窗 */
  const [showStockModal, setShowStockModal] = useState(false);
  const [lowStockParts, setLowStockParts] = useState<LowStockPart[]>([]);
  const [stockSelected, setStockSelected] = useState<Set<string>>(new Set());
  const [stockQtyMap, setStockQtyMap] = useState<Record<string, string>>({});
  /* 弹窗内供应商可改选（2026-08-14 用户要求）：partId → 供应商id，未改选的取配件自带供应商 */
  const [stockSupplierMap, setStockSupplierMap] = useState<Record<string, string>>({});
  /* 弹窗内搜索过滤（2026-08-14）：按名称/编码/品牌/规格/单据名称过滤后再批量操作 */
  const [库存搜索词, set库存搜索词] = useState("");
  const [stockLoading, setStockLoading] = useState(false);

  /* 自定义采购弹窗（2026-08-14）：采购与工单无关的配件 */
  const [showCustomModal, setShowCustomModal] = useState(false);

  /* 操作结果内联提示条（替代系统 alert 弹窗，2026-08-14 用户要求） */
  const [结果提示, set结果提示] = useState<{ 类型: "成功" | "失败"; 文字: string } | null>(null);

  /* 发起采购成功后的「通知供应商」弹窗（2026-08-20）：采购单文本一键复制发微信 */
  const [notifyData, setNotifyData] = useState<采购通知数据 | null>(null);

  /* 数量行内编辑草稿（2026-08-15 用户要求：本页可再次修改采购数量） */
  const [数量草稿, set数量草稿] = useState<Record<string, string>>({});

  /* 撤销弹窗 */
  const [showRevokeModal, setShowRevokeModal] = useState(false);
  const [revokeOpinion, setRevokeOpinion] = useState<"reject" | "pending">("pending");
  const [revokeReason, setRevokeReason] = useState("");
  const [revokeCustomReason, setRevokeCustomReason] = useState("");

  /* 编辑配件弹窗：行内编辑逻辑由 usePartLinking 接管，仅保留忙态 id */
  const [editingId, setEditingId] = useState<string | null>(null);

  const REVOKE_REASONS = [
    "客户取消",
    "配件缺货",
    "价格过高",
    "客户自备配件",
    "其他",
  ];

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [{ data: parts }, { data: sups }, { data: logistics }, { data: stagingData }] = await Promise.all([
      supabase
        .from("work_order_item_parts")
        .select(`
          id, name, brand, specification, unit, quantity, unit_cost, unit_price,
          customer_opinion, supplier_name, part_id, part_number, part_name_id,
          alias_name, notes, purchase_reason, work_order_item_id, document_name,
          work_order_items(
            name,
            work_orders(
              id, order_no, settled_at, order_type,
              customers(name, phone),
              vehicles(plate_number, vin)
            )
          ),
          parts(quantity)
        `)
        .eq("customer_opinion", "agree")
        .eq("is_purchased", false)
        .order("created_at", { ascending: true })
        .limit(1000),
      supabase.from("suppliers").select("id, name, region").order("name"),
      supabase.from("logistics_companies").select("id, name, scopes").order("name"),
      /* 自定义采购暂存行（安全库存补货/自定义采购弹窗添加的，无工单） */
      supabase
        .from("custom_purchase_staging")
        .select("id, part_id, part_number, name, brand, specification, document_name, unit, unit_cost, quantity, supplier_id, supplier_name, parts(quantity)")
        .order("created_at", { ascending: true }),
    ]);

    const filtered = ((parts || []) as unknown as PartBranchRow[]).filter((r) => {
      const wo = r.work_order_items?.work_orders;
      if (!wo) return false;
      if (wo.settled_at) return false;
      if (wo.order_type === "cancelled") return false;
      /* 保养单不走采购流程 */
      if (wo.order_type === "maintenance") return false;
      const cost = Number(r.unit_cost || 0);
      const price = Number(r.unit_price || 0);
      if (cost <= 0 || price <= 0) return false;
      const inventoryQty = Number(r.parts?.quantity || 0);
      if (r.part_id && inventoryQty > 0) return false;
      return true;
    });

    /* 查询未到货标记 */
    const { data: markData } = await supabase
      .from("purchase_order_items")
      .select("work_order_item_part_id, not_arrived_reason")
      .in("not_arrived_reason", ["欠发货已入库", "漏发，重新补发"]);

    const marks: Record<string, string> = {};
    for (const m of markData || []) {
      if (m.work_order_item_part_id) {
        marks[m.work_order_item_part_id] = m.not_arrived_reason;
      }
    }
    setNotArrivedMarks(marks);

    /* 暂存行转成统一的行结构（无工单字段） */
    interface 暂存行 {
      id: string;
      part_id: string | null;
      part_number: string | null;
      name: string;
      brand: string | null;
      specification: string | null;
      document_name: string | null;
      unit: string | null;
      unit_cost: number | null;
      quantity: number;
      supplier_id: string | null;
      supplier_name: string | null;
      parts: { quantity: number | null } | { quantity: number | null }[] | null;
    }
    const 暂存行列表: PartBranchRow[] = ((stagingData || []) as unknown as 暂存行[]).map((s): PartBranchRow => {
      const p = Array.isArray(s.parts) ? s.parts[0] : s.parts;
      return {
        id: s.id,
        name: s.name,
        brand: s.brand,
        specification: s.specification,
        unit: s.unit,
        quantity: s.quantity,
        unit_cost: s.unit_cost,
        unit_price: null,
        customer_opinion: null,
        supplier_name: s.supplier_name,
        part_id: s.part_id,
        part_number: s.part_number,
        part_name_id: null,
        alias_name: null,
        document_name: s.document_name,
        notes: null,
        purchase_reason: null,
        work_order_item_id: "",
        work_order_items: null,
        parts: p ? { quantity: p.quantity } : null,
        staging: { id: s.id, supplier_id: s.supplier_id },
      };
    });

    setRows([...filtered, ...暂存行列表]);
    setSuppliers(sups || []);
    setLogisticsCompanies(logistics || []);
    setLoading(false);
  }

  /* ========== 配件编辑弹窗 ========== */
  /* 行内配件编辑逻辑已抽到 usePartLinking（对照表驱动的共享实现）；
     忙态用适配器映射到本组件的 editingId（其他三组件是 submitting 前缀模式） */
  const 配件联动 = usePartLinking<PartBranchRow>({
    supabase,
    主表: "work_order_item_parts",
    双写WOI: false,
    getRowId: (r) => r.id,
    getWoiId: () => null,
    getWoi当前值: (r) => r,
    写WoiPartId: true,
    行内unitCost来源: "unit_cost",
    行内写售价: true,
    弹窗写supplierPartName: false,
    弹窗写WoiDocumentName: true,
    弹窗规格来源: "join",
    取弹前行: (r) => r,
    setSubmitting: (key) => setEditingId(key ? key.replace(/^(edit|inline)-/, "") : null),
    reload: loadData,
  });
  const {
    editRow,
    editId,
    prefillData: 配件预填,
    openEditModal,
    closeEditModal,
    handlePartSaved,
    handleInlinePartSelect,
    handleInlineClear,
  } = 配件联动;


  function getRowSupplierId(row: PartBranchRow): string | null {
    /* 暂存行直接带 supplier_id */
    if (row.staging) return row.staging.supplier_id;
    if (row.supplier_name) {
      const s = suppliers.find((sp) => sp.name === row.supplier_name);
      if (s) return s.id;
    }
    return null;
  }

  function getRowSupplierRegion(row: PartBranchRow): string | null {
    const sid = getRowSupplierId(row);
    if (sid) {
      const s = suppliers.find((sp) => sp.id === sid);
      return s?.region || null;
    }
    return null;
  }

  /* 当前列表里出现的供应商及数量（筛选标签用） */
  const 出现的供应商 = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const k = r.supplier_name || "(未指定供应商)";
      map.set(k, (map.get(k) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], "zh-CN"));
  }, [rows]);

  /* 按供应商筛选后的行 */
  const 筛选后行 = useMemo(
    () => (供应商筛选 ? rows.filter((r) => (r.supplier_name || "(未指定供应商)") === 供应商筛选) : rows),
    [rows, 供应商筛选]
  );

  /* 按 groupBy 分组 */
  const groups = useMemo(() => {
    const map = new Map<string, PartBranchRow[]>();
    for (const r of 筛选后行) {
      const k = getGroupKey(r, groupBy);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, "zh"))
      .map(([key, rs]) => ({ key, rows: rs }));
  }, [筛选后行, groupBy]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        const row = rows.find((r) => r.id === id);
        if (!row) return prev;
        const targetSupplier = getRowSupplierId(row);
        const selectedRows = rows.filter((r) => next.has(r.id));
        const existingSupplier = selectedRows.length > 0 ? getRowSupplierId(selectedRows[0]) : "";
        if (existingSupplier && existingSupplier !== targetSupplier) {
          alert("每次只能发起同一供应商的采购清单");
          return prev;
        }
        next.add(id);
      }
      return next;
    });
  }

  /* 供应商分组标题行的全选/取消全选（2026-08-15 用户要求）：组内天然同供应商，不冲突 */
  function 切换整组选择(组行: PartBranchRow[]) {
    const 全选 = !组行.every((r) => selected.has(r.id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (全选) 组行.forEach((r) => next.add(r.id));
      else 组行.forEach((r) => next.delete(r.id));
      return next;
    });
  }

  function setRowLogistics(rowId: string, logisticsId: string) {
    setLogisticsMap((prev) => ({ ...prev, [rowId]: logisticsId }));
  }

  function openLogisticsModal() {
    const selectedRows = rows.filter((r) => selected.has(r.id));
    if (selectedRows.length === 0) {
      alert("请先勾选要采购的配件");
      return;
    }
    const missingSupplier = selectedRows.find((r) => !getRowSupplierId(r));
    if (missingSupplier) {
      alert(`请为每一条选中行选择供应商(配件: ${missingSupplier.name})`);
      return;
    }

    const region = getRowSupplierRegion(selectedRows[0]);

    /* 本地供应商直接生成采购单,无需物流 */
    if (region === "local") {
      handleCreatePurchases(null);
      return;
    }

    const available = filterLogisticsByRegion(logisticsCompanies, region as import("@/lib/logisticsFilter").SupplierRegion);
    setFilteredLogistics(available);
    setModalRegion(region);
    setSelectedLogisticsId("");
    setShowLogisticsModal(true);
  }

  /* 采购数量行内保存（2026-08-15 用户要求）：失焦/回车生效。
     工单配件行允许留空=NULL（数量留空红底提醒是故意设计）；
     暂存行（自定义采购）数量必填正整数（暂存表 NOT NULL，发起采购必须有数量） */
  async function 保存数量(row: PartBranchRow) {
    const raw = 数量草稿[row.id];
    if (raw === undefined) return;
    const trimmed = raw.trim();
    const 原值 = row.quantity != null ? String(row.quantity) : "";
    if (trimmed === 原值) {
      set数量草稿((prev) => { const n = { ...prev }; delete n[row.id]; return n; });
      return;
    }
    let 新值: number | null = null;
    if (trimmed !== "") {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n <= 0) {
        set结果提示({ 类型: "失败", 文字: `「${row.name}」数量必须是大于 0 的整数（留空表示未填）` });
        return;
      }
      新值 = n;
    }
    if (row.staging && 新值 === null) {
      set结果提示({ 类型: "失败", 文字: `「${row.name}」是自定义采购项，数量必填` });
      return;
    }
    setSubmitting(true);
    try {
      if (row.staging) {
        const { error } = await supabase.from("custom_purchase_staging").update({ quantity: 新值 }).eq("id", row.staging.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("work_order_item_parts").update({ quantity: 新值 }).eq("id", row.id);
        if (error) throw error;
      }
      set数量草稿((prev) => { const n = { ...prev }; delete n[row.id]; return n; });
      loadData();
    } catch (err: unknown) {
      set结果提示({ 类型: "失败", 文字: "数量保存失败: " + (err instanceof Error ? err.message : String(err)) });
    } finally {
      setSubmitting(false);
    }
  }

  /* 移除自定义采购暂存行（不进采购单，从待采购列表删除） */
  async function handleRemoveStaging(row: PartBranchRow) {
    if (!row.staging) return;
    if (!(await 请求确认(`确定把「${row.name}」从待采购列表移除吗？（不会生成采购单）`))) return;
    setSubmitting(true);
    try {
      const result = await 移除采购暂存行(row.staging.id);
      if (!result.success) throw new Error(result.error || "移除失败");
      loadData();
    } catch (err: unknown) {
      set结果提示({ 类型: "失败", 文字: "移除失败: " + (err instanceof Error ? err.message : String(err)) });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreatePurchases(forcedLogisticsId?: string | null) {
    const selectedRows = rows.filter((r) => selected.has(r.id));
    const region = getRowSupplierRegion(selectedRows[0]);

    let finalLogisticsId: string | null = null;
    if (forcedLogisticsId !== undefined) {
      finalLogisticsId = forcedLogisticsId;
    } else {
      finalLogisticsId = selectedLogisticsId || null;
    }

    if (region === "harbin" && !finalLogisticsId) {
      alert("哈市供应商必须选择物流公司");
      return;
    }

    const logisticsName = finalLogisticsId
      ? logisticsCompanies.find((l) => l.id === finalLogisticsId)?.name || ""
      : "";

    if (!(await 请求确认(`将为 ${selectedRows.length} 条配件生成采购单,是否继续?`))) {
      return;
    }

    setSubmitting(true);
    try {
      const sid = getRowSupplierId(selectedRows[0]);
      if (!sid) throw new Error("无法获取供应商ID");

      /* 工单配件行 + 自定义采购暂存行混在一起发起（同供应商规则已在勾选时保证） */
      const 工单行 = selectedRows.filter((r) => !r.staging);
      const 暂存行 = selectedRows.filter((r) => r.staging);

      /* 批量查询图片和分类（只读查询，用于组装工单配件的采购明细快照） */
      const workOrderItemIds = 工单行.map((r) => r.work_order_item_id).filter((x): x is string => !!x);
      const partNameIds = 工单行.map((r) => r.part_name_id).filter((x): x is string => !!x);
      const [{ data: mediaData }, { data: pnData }] = await Promise.all([
        workOrderItemIds.length > 0
          ? supabase.from("work_order_item_media").select("work_order_item_id, storage_path").in("work_order_item_id", workOrderItemIds).eq("media_type", "image")
          : Promise.resolve({ data: [] as { work_order_item_id: string; storage_path: string }[] }),
        partNameIds.length > 0
          ? supabase.from("part_names").select("id, part_categories(name)").in("id", partNameIds)
          : Promise.resolve({ data: [] as { id: string; part_categories?: { name?: string | null } | null }[] }),
      ]);

      const mediaMap: Record<string, string[]> = {};
      for (const m of mediaData || []) {
        if (!mediaMap[m.work_order_item_id]) mediaMap[m.work_order_item_id] = [];
        mediaMap[m.work_order_item_id].push(m.storage_path);
      }
      const categoryMap: Record<string, string> = {};
      for (const p of (pnData || []) as unknown as { id: string; part_categories?: { name?: string | null } | null }[]) {
        categoryMap[p.id] = p.part_categories?.name || "";
      }

      /* 建单头+明细+回写工单配件行+清理暂存行已收编进数据库事务函数 create_purchase_orders,
         单号由服务端序列生成(CG-日期-序号);暂存行 id 一并传入,同一事务内删除 */
      const res = await 创建采购单([
        {
          supplier_id: sid,
          status: "submitted",
          logistics_company_id: finalLogisticsId,
          notes: `由「待采购」批量生成${logisticsName ? ` | 物流: ${logisticsName}` : ""}${暂存行.length > 0 ? ` | 含自定义/备货配件 ${暂存行.length} 条` : ""}`,
          items: [
            ...工单行.map((it) => ({
              part_id: it.part_id,
              part_number: it.part_number,
              name: it.name,
              supplier_part_name: it.alias_name,
              brand: it.brand,
              specification: it.specification,
              quantity: it.quantity,
              unit: it.unit,
              unit_cost: it.unit_cost,
              category: it.part_name_id ? categoryMap[it.part_name_id] || "" : "",
              license_plate: it.work_order_items?.work_orders?.vehicles?.plate_number || "",
              photos: mediaMap[it.work_order_item_id] || [],
              notes: it.notes,
              work_order_item_part_id: it.id,
            })),
            /* 自定义采购暂存行：无工单、无车牌 */
            ...暂存行.map((it): 采购明细输入 => ({
              part_id: it.part_id,
              part_number: it.part_number,
              name: it.name,
              supplier_part_name: it.document_name,
              brand: it.brand,
              specification: it.specification,
              quantity: it.quantity,
              unit: it.unit,
              unit_cost: it.unit_cost,
              category: "",
              license_plate: "",
              notes: null,
            })),
          ],
        },
      ], 暂存行.map((r) => r.staging!.id));
      if (!res.success) throw new Error(res.error || "创建采购单失败");

      /* 发起成功：弹出「通知供应商」弹窗（2026-08-20），采购单文本一键复制发微信 */
      const 首单 = res.orders?.[0];
      if (首单) {
        setNotifyData({
          orderId: 首单.id,
          order_no: 首单.order_no,
          supplierName: suppliers.find((s) => s.id === sid)?.name || "",
          logisticsName: logisticsName || null,
          items: [
            ...工单行.map((it): 采购通知明细 => ({
              name: it.name,
              alias_name: it.alias_name,
              part_number: it.part_number,
              brand: it.brand,
              specification: it.specification,
              quantity: it.quantity,
              unit: it.unit,
              unit_cost: it.unit_cost,
              vin: it.work_order_items?.work_orders?.vehicles?.vin || null,
            })),
            ...暂存行.map((it): 采购通知明细 => ({
              name: it.name,
              alias_name: it.document_name,
              part_number: it.part_number,
              brand: it.brand,
              specification: it.specification,
              quantity: it.quantity,
              unit: it.unit,
              unit_cost: it.unit_cost,
              vin: null,
            })),
          ],
        });
      }

      set结果提示({ 类型: "成功", 文字: "已生成 1 张采购单(已提交),请到「待收货」或「采购订单」中查看。" });
      setShowLogisticsModal(false);
      setSelected(new Set());
      loadData();
    } catch (err: unknown) {
      const e = err as Error;
      set结果提示({ 类型: "失败", 文字: "发起采购失败: " + (e.message || String(err)) });
    } finally {
      setSubmitting(false);
    }
  }

  interface PartRow {
    id: string;
    part_number: string | null;
    name: string;
    part_brands?: { name?: string | null } | null;
    part_specifications?: { name?: string | null } | null;
    unit: string | null;
    quantity: number | null;
    min_stock: number | null;
    unit_cost: number | null;
    supplier_id: string | null;
    suppliers?: { name?: string | null } | null;
    document_name?: string | null;
  }

  async function loadLowStockParts() {
    setStockLoading(true);
    const { data } = await supabase
      .from("parts")
      .select("id, part_number, name, part_brands(name), part_specifications(name), unit, quantity, min_stock, unit_cost, supplier_id, suppliers(name), document_name")
      .order("name");

    const list: LowStockPart[] = ((data || []) as unknown as PartRow[])
      .filter((p) => (p.quantity || 0) < (p.min_stock || 0))
      .map((p) => ({
        id: p.id,
        part_number: p.part_number,
        name: p.name,
        brand: p.part_brands?.name || null,
        specification: p.part_specifications?.name || null,
        unit: p.unit,
        quantity: p.quantity || 0,
        min_stock: p.min_stock || 10,
        unit_cost: p.unit_cost,
        supplier_id: p.supplier_id,
        supplier_name: p.suppliers?.name || null,
        document_name: p.document_name || null,
      }));

    /* 已在采购流程中的配件不再显示（2026-08-15 用户要求）：
       ① 已在自定义采购暂存列表 ② 已在未完成的采购单里 */
    const [{ data: 在途明细 }, { data: 暂存中 }] = await Promise.all([
      supabase.from("purchase_order_items").select("part_id, purchase_orders(status)").not("part_id", "is", null),
      supabase.from("custom_purchase_staging").select("part_id"),
    ]);
    const 排除ids = new Set<string>();
    for (const s of (暂存中 || []) as { part_id: string | null }[]) {
      if (s.part_id) 排除ids.add(s.part_id);
    }
    interface 在途行 { part_id: string | null; purchase_orders: { status: string | null } | { status: string | null }[] | null }
    for (const it of (在途明细 || []) as unknown as 在途行[]) {
      const st = Array.isArray(it.purchase_orders) ? it.purchase_orders[0]?.status : it.purchase_orders?.status;
      if (it.part_id && st && st !== "completed" && st !== "cancelled") 排除ids.add(it.part_id);
    }
    const 过滤后list = list.filter((p) => !排除ids.has(p.id));

    /* 配件档案没登记默认供应商时，取该配件"最近一次采购"的供应商当默认（2026-08-14 用户要求） */
    const 缺供应商ids = 过滤后list.filter((p) => !p.supplier_id).map((p) => p.id);
    if (缺供应商ids.length > 0) {
      const { data: 历史采购 } = await supabase
        .from("purchase_order_items")
        .select("part_id, purchase_orders(supplier_id, created_at)")
        .in("part_id", 缺供应商ids);
      /* 按采购单创建时间倒序，每个配件取最近一次 */
      interface 历史行 { part_id: string | null; purchase_orders: { supplier_id: string | null; created_at: string | null } | null }
      const 最近供应商 = new Map<string, string>();
      const 排序后 = ((历史采购 || []) as unknown as 历史行[])
        .filter((h) => h.part_id && h.purchase_orders?.supplier_id)
        .sort((a, b) => (b.purchase_orders!.created_at || "").localeCompare(a.purchase_orders!.created_at || ""));
      for (const h of 排序后) {
        if (!最近供应商.has(h.part_id!)) 最近供应商.set(h.part_id!, h.purchase_orders!.supplier_id!);
      }
      for (const p of 过滤后list) {
        if (p.supplier_id) continue;
        const sid = 最近供应商.get(p.id);
        if (sid) {
          p.supplier_id = sid;
          p.supplier_name = suppliers.find((s) => s.id === sid)?.name || p.supplier_name;
        }
      }
    }

    setLowStockParts(过滤后list);
    setStockSelected(new Set());
    setStockQtyMap({});
    setStockSupplierMap({});
    set库存搜索词("");
    setStockLoading(false);
  }

  function openStockModal() {
    loadLowStockParts();
    setShowStockModal(true);
  }

  /* 弹窗行的有效供应商：改选过的优先，否则取配件自带（2026-08-14 供应商可改选） */
  function 有效供应商id(p: LowStockPart): string {
    return stockSupplierMap[p.id] || p.supplier_id || "";
  }

  /* 弹窗列表按有效供应商分别排序：有（之前）供应商的在前、按供应商名排，没有的沉底 */
  const 排序后库存配件 = useMemo(() => {
    const 供应商名 = (p: LowStockPart) => {
      const sid = 有效供应商id(p);
      return suppliers.find((s) => s.id === sid)?.name || p.supplier_name || "";
    };
    return [...lowStockParts].sort((a, b) => {
      const 名a = 供应商名(a);
      const 名b = 供应商名(b);
      if (!名a && 名b) return 1;
      if (名a && !名b) return -1;
      return 名a.localeCompare(名b, "zh-CN") || (a.name || "").localeCompare(b.name || "", "zh-CN");
    });

  }, [lowStockParts, stockSupplierMap, suppliers]);

  /* 弹窗内搜索过滤（本地过滤，数据量小不需要防抖） */
  const 过滤后库存配件 = useMemo(() => {
    const kw = 库存搜索词.trim().toUpperCase();
    if (!kw) return 排序后库存配件;
    return 排序后库存配件.filter((p) =>
      [p.name, p.part_number, p.brand, p.specification, p.document_name]
        .filter(Boolean)
        .join(" ")
        .toUpperCase()
        .includes(kw)
    );
  }, [排序后库存配件, 库存搜索词]);

  /* 数量有效性（字符串原样存储：留空=未填，红色提醒） */
  function 库存数量有效(id: string): boolean {
    const q = stockQtyMap[id];
    if (q === undefined || q.trim() === "") return false;
    const n = Number(q);
    return Number.isInteger(n) && n > 0;
  }

  /* 可提交 = 有选中行 + 每行都有供应商和有效数量；不满足按钮置灰，不用系统弹窗拦截 */
  const 库存弹窗可提交 =
    stockSelected.size > 0 &&
    lowStockParts
      .filter((p) => stockSelected.has(p.id))
      .every((p) => 有效供应商id(p) !== "" && 库存数量有效(p.id));

  function toggleStockSelect(id: string) {
    setStockSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setStockQtyMap((q) => { const n = { ...q }; delete n[id]; return n; });
      } else {
        next.add(id);
        const part = lowStockParts.find((p) => p.id === id);
        if (part) {
          const suggestQty = Math.max(part.min_stock - part.quantity, 1);
          setStockQtyMap((q) => ({ ...q, [id]: String(suggestQty) }));
        }
      }
      return next;
    });
  }

  function setStockQty(id: string, qty: string) {
    setStockQtyMap((prev) => ({ ...prev, [id]: qty }));
  }

  async function handleCreateStockPurchases() {
    /* 供应商/数量校验由"添加到待采购"按钮置灰前置拦截（红/黄高亮提示），此处不再弹系统窗 */
    if (!库存弹窗可提交) return;
    const selectedParts = lowStockParts.filter((p) => stockSelected.has(p.id));

    if (!(await 请求确认(`将把 ${selectedParts.length} 条配件添加到「待采购」列表，之后统一发起采购，是否继续？`))) {
      return;
    }

    setSubmitting(true);
    try {
      /* 2026-08-15 改：不再直接生成采购单，先暂存到「待采购」页统一发起 */
      const res = await 添加采购暂存(
        selectedParts.map((p) => ({
          part_id: p.id,
          part_number: p.part_number,
          name: p.name,
          brand: p.brand,
          specification: p.specification,
          document_name: p.document_name,
          unit: p.unit,
          unit_cost: p.unit_cost,
          quantity: Number(stockQtyMap[p.id]),
          supplier_id: 有效供应商id(p),
          source: "safety_stock" as const,
        }))
      );
      if (!res.success) throw new Error(res.error || "添加失败");

      set结果提示({ 类型: "成功", 文字: `已添加 ${res.count ?? selectedParts.length} 条配件到「待采购」列表，勾选后可统一发起采购。` });
      setShowStockModal(false);
      loadData();
    } catch (err: unknown) {
      const e = err as Error;
      set结果提示({ 类型: "失败", 文字: "添加失败: " + (e.message || String(err)) });
    } finally {
      setSubmitting(false);
    }
  }

  /* 客户意见变更(待采购页):未确定→退回待确认;否决→不再显示和推进 */
  async function handleOpinionChange(row: PartBranchRow, 意见: string) {
    if (意见 === row.customer_opinion) return;
    if (意见 === "pending") {
      if (!(await 请求确认(`「${row.name}」改为未确定后将退回「待确认」重新等客户答复,是否继续?`))) return;
    } else if (意见 === "reject") {
      if (!(await 请求确认(`「${row.name}」改为否决后将不再显示和推进,是否继续?`))) return;
    }
    setSubmitting(true);
    try {
      const res = await 更新工单配件客户意见(row.id, 意见);
      if (!res.success) throw new Error(res.error || "更新失败");
      loadData();
    } catch (err: unknown) {
      alert("修改客户意见失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSubmitting(false);
    }
  }

  function openRevokeModal() {
    const selectedRows = rows.filter((r) => selected.has(r.id));
    if (selectedRows.length === 0) {
      alert("请先勾选要撤销的配件");
      return;
    }
    setRevokeOpinion("pending");
    setRevokeReason("");
    setRevokeCustomReason("");
    setShowRevokeModal(true);
  }

  async function handleRevoke() {
    const selectedRows = rows.filter((r) => selected.has(r.id));
    const finalReason = revokeReason === "其他" ? revokeCustomReason.trim() : revokeReason;
    if (!finalReason) {
      alert("请填写撤销原因");
      return;
    }
    if (!(await 请求确认(`确认撤销 ${selectedRows.length} 条配件?\n客户意见将变更为「${revokeOpinion === "reject" ? "否决" : "未确定"}」`))) {
      return;
    }
    setSubmitting(true);
    try {
      const ids = selectedRows.map((r) => r.id);
      const { error } = await supabase
        .from("work_order_item_parts")
        .update({
          customer_opinion: revokeOpinion,
          revoke_reason: finalReason,
        })
        .in("id", ids);
      if (error) throw error;
      alert("已撤销");
      setShowRevokeModal(false);
      setSelected(new Set());
      loadData();
    } catch (err: unknown) {
      const e = err as Error;
      alert("撤销失败: " + (e.message || String(err)));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="text-center text-gray-400 py-12">加载中...</div>;
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* 操作结果内联提示（替代系统 alert） */}
      {结果提示 && (
        <div className={`px-6 py-2 text-xs flex items-center justify-between ${结果提示.类型 === "成功" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
          <span>{结果提示.文字}</span>
          <button type="button" onClick={() => set结果提示(null)} className="text-gray-400 hover:text-gray-600">×</button>
        </div>
      )}
      <div className="px-6 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="text-sm font-semibold text-gray-900">
            待采购
            <span className="ml-2 text-xs font-normal text-gray-500">共 {筛选后行.length} 条</span>
          </h3>
          {/* 供应商筛选标签（2026-08-15 用户要求）：点标签只看该供应商，再点取消 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-gray-400">供应商:</span>
            <button
              type="button"
              onClick={() => set供应商筛选(null)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                供应商筛选 === null
                  ? "bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-200"
                  : "bg-white border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-600 hover:shadow-sm"
              }`}
            >
              全部
            </button>
            {出现的供应商.map(([名, 数]) => (
              <button
                key={名}
                type="button"
                onClick={() => set供应商筛选(供应商筛选 === 名 ? null : 名)}
                className={`inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                  供应商筛选 === 名
                    ? "bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-200"
                    : "bg-white border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-600 hover:shadow-sm"
                }`}
              >
                {名}
                <span className={`ml-1.5 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-[10px] font-bold ${
                  供应商筛选 === 名 ? "bg-white/25 text-white" : "bg-blue-50 text-blue-600"
                }`}>
                  {数}
                </span>
              </button>
            ))}
          </div>
          {selected.size > 0 && (
            <span className="text-xs text-blue-600">已选 {selected.size} 条</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 mr-2">
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
          <button
            type="button"
            onClick={openStockModal}
            className="px-3 py-1.5 bg-orange-50 text-orange-700 border border-orange-200 text-sm font-medium rounded-lg hover:bg-orange-100 transition-colors"
          >
            添加安全库存配件
          </button>
          <button
            type="button"
            onClick={() => setShowCustomModal(true)}
            className="px-3 py-1.5 bg-purple-50 text-purple-700 border border-purple-200 text-sm font-medium rounded-lg hover:bg-purple-100 transition-colors"
          >
            自定义采购
          </button>
          <button
            type="button"
            onClick={openRevokeModal}
            disabled={selected.size === 0 || submitting}
            className="px-3 py-1.5 bg-red-50 text-red-700 border border-red-200 text-sm font-medium rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50"
          >
            撤销
          </button>
          <button
            type="button"
            onClick={openLogisticsModal}
            disabled={selected.size === 0 || submitting}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {submitting ? "生成中..." : "发起采购"}
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {/* 表头全选框已移除（2026-08-15 用户要求）：全选走供应商分组标题行的勾选框 */}
              <th className="px-3 py-3 text-left font-medium text-gray-500 w-10"></th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">工单号</th>
              {/* 客户/车牌、项目两列已隐藏（用户要求 2026-08-14：采购员只关心配件和供应商） */}
              <th className="px-3 py-3 text-left font-medium text-gray-500">配件</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">单据名称</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">编码</th>
              <th className="px-3 py-3 text-right font-medium text-gray-500">数量</th>
              <th className="px-3 py-3 text-right font-medium text-gray-500">库存</th>
              <th className="px-3 py-3 text-right font-medium text-gray-500">采购价</th>
              <th className="px-3 py-3 text-right font-medium text-gray-500">销售价</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">客户意见</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">供应商</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">物流公司</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {groups.map((g, gIdx) => (
              <Fragment key={`grp-${gIdx}`}>
                <tr className="bg-slate-200 border-l-4 border-blue-500">
                  <td colSpan={13} className="px-3 py-2.5 text-xs font-semibold text-gray-700">
                    {/* 按供货商分组时，组标题带全选/取消全选（2026-08-15 用户要求）：白底胶囊突出可点 */}
                    {groupBy === "supplier" && (
                      <label className="inline-flex items-center gap-1.5 mr-3 cursor-pointer select-none bg-white border border-gray-300 rounded-lg px-2.5 py-1 shadow-sm hover:border-blue-400 hover:shadow transition-all">
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          checked={g.rows.length > 0 && g.rows.every((r) => selected.has(r.id))}
                          onChange={() => 切换整组选择(g.rows)}
                        />
                        <span className="text-xs font-medium text-gray-700">全选</span>
                      </label>
                    )}
                    <span className="inline-block px-2 py-0.5 rounded bg-blue-600 text-white mr-2 text-[10px] font-bold align-middle">
                      {GROUP_OPTIONS.find((o) => o.key === groupBy)?.label.replace("按", "")}
                    </span>
                    <span className="text-sm font-bold text-gray-900 align-middle">{g.key}</span>
                    <span className="ml-2 text-gray-400 font-normal align-middle">({g.rows.length} 条)</span>
                  </td>
                </tr>
                {(() => {
                  let branchColorIdx = -1;
                  return g.rows.map((r, rIdx) => {
                    const prevName = rIdx > 0 ? g.rows[rIdx - 1].name : null;
                    const isNewBranch = prevName !== null && prevName !== r.name;
                    if (rIdx === 0 || isNewBranch) {
                      branchColorIdx = (branchColorIdx + 1) % BRANCH_BG_COLORS.length;
                    }
                    const wo = r.work_order_items?.work_orders;
                    const isChecked = selected.has(r.id);
                    const branchBg = BRANCH_BG_COLORS[branchColorIdx % BRANCH_BG_COLORS.length];
                    return (
                      <tr key={r.id} className={`${isChecked ? "bg-blue-50" : branchBg} ${isNewBranch ? "border-t-2 border-gray-200" : ""}`}>
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleSelect(r.id)}
                            className="rounded"
                          />
                        </td>
                        <td className="px-3 py-3">
                          {wo ? (
                            <Link href={`/work-orders/${wo.id}`} className="text-blue-600 hover:text-blue-700 font-medium">
                              {wo.order_no}
                            </Link>
                          ) : (
                            "-"
                          )}
                        </td>
                        {/* 客户/车牌、项目两列已隐藏（2026-08-14 用户要求） */}
                        <td className="px-3 py-3 whitespace-nowrap">
                          <div className="text-base font-medium text-gray-900">{r.name}</div>
                          <div className="text-sm text-gray-400">{r.brand || ""} {r.specification || ""}</div>
                          {r.purchase_reason && PURCHASE_REASON_LABELS[r.purchase_reason] && (
                            <span className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded border ${PURCHASE_REASON_LABELS[r.purchase_reason].color}`}>
                              {PURCHASE_REASON_LABELS[r.purchase_reason].text}
                            </span>
                          )}
                          {notArrivedMarks[r.id] && (
                            <span className={`inline-block mt-1 ml-1 text-[10px] px-1.5 py-0.5 rounded border ${
                              notArrivedMarks[r.id] === "欠发货已入库"
                                ? "bg-blue-50 text-blue-600 border-blue-100"
                                : "bg-orange-50 text-orange-600 border-orange-100"
                            }`}>
                              {notArrivedMarks[r.id] === "欠发货已入库" ? "欠发货已入库" : "漏发"}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-gray-700 whitespace-nowrap">
                          {/* 暂存行（自定义采购）不在工单配件表，单据名称只读展示 */}
                          {r.staging ? (
                            <span>{r.document_name || "-"}</span>
                          ) : (
                            <DocumentNameInput 工单配件行id={r.id} 初始值={r.document_name || ""} 保存后={loadData} />
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {r.staging ? (
                            <span className="text-gray-700">{r.part_number || "-"}</span>
                          ) : (
                          <PartSearchDropdown
                            value={r.part_number || ""}
                            onChange={() => {}}
                            onSelect={(part) => handleInlinePartSelect(r, part)}
                            onCreateNew={(query) => 配件联动.openCreateNewModal(r, query)}
                            onClear={() => handleInlineClear(r)}
                            disabled={editingId === r.id}
                            placeholder="编码/条码"
                            inputClassName="w-28 border-gray-200"
                          />
                          )}
                        </td>
                        {/* 数量行内可改（2026-08-15 用户要求）：失焦/回车保存；留空红框提醒 */}
                        <td className="px-3 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <input
                              type="number"
                              min="1"
                              step="1"
                              disabled={submitting}
                              value={数量草稿[r.id] ?? (r.quantity != null ? String(r.quantity) : "")}
                              onChange={(e) => set数量草稿((prev) => ({ ...prev, [r.id]: e.target.value }))}
                              onBlur={() => 保存数量(r)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  (e.target as HTMLInputElement).blur();
                                }
                              }}
                              className={`w-16 px-2 py-1 text-right text-xs rounded border focus:outline-none disabled:opacity-50 ${
                                (数量草稿[r.id] ?? (r.quantity != null ? String(r.quantity) : "")).trim() === ""
                                  ? "border-red-300 bg-red-50 text-red-600"
                                  : 数量草稿[r.id] !== undefined
                                    ? "border-yellow-400 bg-yellow-50"
                                    : "border-gray-200 hover:border-blue-400 focus:border-blue-500"
                              }`}
                            />
                            <span className="text-xs text-gray-500">{r.unit || "件"}</span>
                          </div>
                        </td>
                        {/* 库存：关联了库存配件才显示数字（<=0 标红），未关联显示 - */}
                        <td className="px-3 py-3 text-right">
                          {r.part_id ? (
                            <span className={Number(r.parts?.quantity || 0) <= 0 ? "text-red-600 font-semibold" : "text-gray-700"}>
                              {r.parts?.quantity ?? 0}
                            </span>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right text-gray-700">
                          <PriceValue value={r.unit_cost} />
                        </td>
                        <td className="px-3 py-3 text-right text-gray-700">
                          <PriceValue value={r.unit_price} />
                        </td>
                        <td className="px-3 py-3">
                          {/* 暂存行（自定义采购）没有客户意见，显示 - */}
                          {r.staging ? (
                            <span className="text-gray-300">-</span>
                          ) : (
                          /* 客户意见:改「未确定」退回待确认;改「否决」不再显示和推进(只改工单状态) */
                          <select
                            value={r.customer_opinion || "agree"}
                            disabled={submitting}
                            onChange={(e) => handleOpinionChange(r, e.target.value)}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                          >
                            <option value="agree">同意</option>
                            <option value="pending">未确定</option>
                            <option value="reject">否决</option>
                          </select>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {/* 供应商只读（2026-08-14 用户要求）：询价阶段已确定，这里不允许改 */}
                          <span className="text-gray-700 text-xs">{r.supplier_name || "-"}</span>
                        </td>
                        <td className="px-3 py-3">
                          {(() => {
                            const region = getRowSupplierRegion(r);
                            if (region === "local") {
                              return <span className="text-gray-400 text-xs">-</span>;
                            }
                            const available = filterLogisticsByRegion(logisticsCompanies, region as import("@/lib/logisticsFilter").SupplierRegion);
                            return (
                              <select
                                value={logisticsMap[r.id] || ""}
                                onChange={(e) => setRowLogistics(r.id, e.target.value)}
                                className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                              >
                                <option value="">{region === "harbin" ? "必选" : "请选择"}</option>
                                {available.map((lc) => (
                                  <option key={lc.id} value={lc.id}>{lc.name}</option>
                                ))}
                              </select>
                            );
                          })()}
                        </td>
                        <td className="px-3 py-3">
                          {r.staging ? (
                            /* 暂存行：移除 = 从待采购列表删除（不进采购单） */
                            <button
                              type="button"
                              onClick={() => handleRemoveStaging(r)}
                              disabled={submitting}
                              className="text-xs text-red-500 hover:text-red-600 disabled:opacity-50"
                            >
                              移除
                            </button>
                          ) : (
                          <button
                            type="button"
                            onClick={() => openEditModal(r)}
                            disabled={editingId === r.id}
                            className="text-xs text-blue-600 hover:text-blue-700 disabled:opacity-50"
                          >
                            编辑
                          </button>
                          )}
                        </td>
                      </tr>
                    );
                  });
                })()}
              </Fragment>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={13} className="px-6 py-12 text-center text-gray-400">
                  暂无待采购的配件
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 物流选择弹窗 */}
      {showLogisticsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md">
            <h3 className="text-base font-semibold text-gray-900 mb-4">
              选择物流
              {modalRegion && (
                <span className="ml-2 text-xs font-normal text-gray-500">
                  ({REGION_LABELS[modalRegion] || modalRegion})
                  {modalRegion === "harbin" && " · 必选"}
                  {modalRegion === "outside" && " · 可选"}
                </span>
              )}
            </h3>
            <div className="space-y-3 mb-6">
              {filteredLogistics.map((lc) => (
                <label key={lc.id} className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="logistics"
                    value={lc.id}
                    checked={selectedLogisticsId === lc.id}
                    onChange={() => setSelectedLogisticsId(lc.id)}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="text-sm text-gray-700">{lc.name}</span>
                </label>
              ))}
              {modalRegion === "outside" && (
                <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="logistics"
                    value=""
                    checked={selectedLogisticsId === ""}
                    onChange={() => setSelectedLogisticsId("")}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="text-sm text-gray-700">暂不选择</span>
                </label>
              )}
              {filteredLogistics.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">暂无符合条件的物流公司，请到「物流运单」页面添加</p>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowLogisticsModal(false)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => handleCreatePurchases()}
                disabled={modalRegion === "harbin" && !selectedLogisticsId || submitting}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? "生成中..." : "确认发起采购"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 安全库存配件弹窗 */}
      {showStockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-6xl max-h-[85vh] flex flex-col">
            <h3 className="text-base font-semibold text-gray-900 mb-4">添加安全库存配件</h3>
            <p className="text-xs text-gray-400 mb-3">以下配件库存低于安全线（已在采购流程中的不显示），勾选后先添加到「待采购」列表，再统一发起采购</p>
            {/* 搜索过滤：先搜出目标配件再批量勾选/改供应商（2026-08-14 用户要求） */}
            <input
              type="text"
              value={库存搜索词}
              onChange={(e) => set库存搜索词(e.target.value)}
              placeholder="搜索配件名称 / 编码 / 品牌 / 规格 / 单据名称..."
              className="w-full px-3 py-2 mb-3 text-sm rounded-lg border border-gray-300 focus:border-blue-500 focus:outline-none"
            />
            {/* 批量设置供应商（2026-08-14 用户要求）：勾多行后一键指定同一供应商 */}
            {stockSelected.size > 0 && (
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs text-blue-600">已选 {stockSelected.size} 条</span>
                <select
                  value=""
                  onChange={(e) => {
                    const sid = e.target.value;
                    if (!sid) return;
                    setStockSupplierMap((prev) => {
                      const next = { ...prev };
                      for (const id of stockSelected) next[id] = sid;
                      return next;
                    });
                  }}
                  className="rounded border border-gray-300 px-2 py-1 text-xs"
                >
                  <option value="">批量设置供应商...</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg mb-4">
              {stockLoading ? (
                <div className="text-center text-gray-400 py-8">加载中...</div>
              ) : 过滤后库存配件.length === 0 ? (
                <div className="text-center text-gray-400 py-8">{库存搜索词.trim() ? "没有匹配的配件" : "暂无库存不足的配件"}</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-500 w-10">
                        <input
                          type="checkbox"
                          checked={过滤后库存配件.length > 0 && 过滤后库存配件.every((p) => stockSelected.has(p.id))}
                          onChange={() => {
                            /* 全选/全不选只作用于当前过滤出的行（配合搜索批量操作） */
                            const 全选 = !过滤后库存配件.every((p) => stockSelected.has(p.id));
                            if (全选) {
                              const map: Record<string, string> = {};
                              const ids: string[] = [];
                              for (const p of 过滤后库存配件) {
                                ids.push(p.id);
                                map[p.id] = String(Math.max(p.min_stock - p.quantity, 1));
                              }
                              setStockSelected((prev) => new Set([...prev, ...ids]));
                              setStockQtyMap((q) => ({ ...q, ...map }));
                            } else {
                              setStockSelected((prev) => {
                                const next = new Set(prev);
                                for (const p of 过滤后库存配件) next.delete(p.id);
                                return next;
                              });
                            }
                          }}
                          className="rounded"
                        />
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">配件</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">单据名称</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">当前库存</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">安全线</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">采购价</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">供应商</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">采购数量</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {过滤后库存配件.map((p) => {
                      const 已选 = stockSelected.has(p.id);
                      const sid = 有效供应商id(p);
                      const 数量有效 = 库存数量有效(p.id);
                      return (
                      <tr key={p.id} className={已选 ? "bg-blue-50" : "hover:bg-gray-50"}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={已选}
                            onChange={() => toggleStockSelect(p.id)}
                            className="rounded"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-base font-medium text-gray-900">{p.name}</div>
                          <div className="text-sm text-gray-400">{p.part_number || ""} {p.brand || ""} {p.specification || ""}</div>
                        </td>
                        <td className="px-3 py-2 text-gray-700">{p.document_name || "-"}</td>
                        <td className="px-3 py-2 text-right text-red-600 font-medium">{p.quantity}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{p.min_stock}</td>
                        <td className="px-3 py-2 text-right text-gray-700"><PriceValue value={p.unit_cost} /></td>
                        {/* 供应商可改选：默认配件自带/最近采购供应商；选中行未选红框、已填黄框 */}
                        <td className="px-3 py-2">
                          <select
                            value={sid}
                            onChange={(e) => setStockSupplierMap((prev) => ({ ...prev, [p.id]: e.target.value }))}
                            className={`rounded border px-1.5 py-1 text-xs max-w-[10rem] ${
                              已选
                                ? sid
                                  ? "border-yellow-400 bg-yellow-50"
                                  : "border-red-300 bg-red-50 text-red-600"
                                : "border-gray-300"
                            }`}
                          >
                            <option value="">{p.supplier_name || "请选择"}</option>
                            {suppliers.map((s) => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {已选 && (
                            <input
                              type="number"
                              min={1}
                              value={stockQtyMap[p.id] ?? ""}
                              onChange={(e) => setStockQty(p.id, e.target.value)}
                              className={`w-16 px-2 py-1 text-xs text-right border rounded ${
                                数量有效 ? "border-yellow-400 bg-yellow-50" : "border-red-300 bg-red-50 text-red-600"
                              }`}
                            />
                          )}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowStockModal(false)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleCreateStockPurchases}
                disabled={!库存弹窗可提交 || submitting}
                title={库存弹窗可提交 ? "" : "选中行都要选供应商、填数量才能生成"}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? "添加中..." : `添加到待采购 (${stockSelected.size})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 撤销弹窗 */}
      {showRevokeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md">
            <h3 className="text-base font-semibold text-gray-900 mb-4">撤销配件</h3>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">变更客户意见为</label>
                <div className="flex gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="revokeOpinion"
                      value="pending"
                      checked={revokeOpinion === "pending"}
                      onChange={() => setRevokeOpinion("pending")}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="text-sm text-gray-700">未确定</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="revokeOpinion"
                      value="reject"
                      checked={revokeOpinion === "reject"}
                      onChange={() => setRevokeOpinion("reject")}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="text-sm text-gray-700">否决</span>
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">撤销原因</label>
                <select
                  value={revokeReason}
                  onChange={(e) => setRevokeReason(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">请选择</option>
                  {REVOKE_REASONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                {revokeReason === "其他" && (
                  <textarea
                    value={revokeCustomReason}
                    onChange={(e) => setRevokeCustomReason(e.target.value)}
                    placeholder="请填写具体原因"
                    className="w-full mt-2 rounded border border-gray-300 px-3 py-2 text-sm"
                    rows={2}
                  />
                )}
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowRevokeModal(false)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleRevoke}
                disabled={submitting}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {submitting ? "处理中..." : "确认撤销"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑配件弹窗 */}
      {editRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-6xl max-h-[90vh] overflow-y-auto m-4">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
              <h3 className="text-lg font-semibold text-gray-900">
                {editRow.part_id ? "编辑配件信息" : "新增配件信息"}
              </h3>
              <button
                type="button"
                onClick={closeEditModal}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                &times;
              </button>
            </div>
            <div className="p-6">
              <PartForm
                editId={editId}
                onSaved={handlePartSaved}
                onCancel={closeEditModal}
                /* 预填在共享 Hook 基础上叠加本页要求（2026-08-14）：
                   行内已填的单据名称、销售价也带进配件表单 */
                prefillData={配件预填 && editRow ? {
                  ...配件预填,
                  document_name: editRow.document_name || "",
                  unit_price: editRow.unit_price != null ? String(editRow.unit_price) : "",
                } : 配件预填}
              />
            </div>
          </div>
        </div>
      )}

      {确认弹窗}

      {/* 自定义采购弹窗：采购与工单无关的配件；关闭时刷新列表（添加的暂存行立即显示） */}
      <CustomPurchaseModal
        open={showCustomModal}
        onClose={() => { setShowCustomModal(false); loadData(); }}
        suppliers={suppliers}
        on成功={(文字) => set结果提示({ 类型: "成功", 文字 })}
      />

      {/* 通知供应商弹窗：发起采购成功后弹出，采购单文本一键复制发微信 */}
      <PurchaseOrderNotifyModal data={notifyData} onClose={() => setNotifyData(null)} />
    </div>
  );
}

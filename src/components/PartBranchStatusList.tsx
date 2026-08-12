"use client";

import { useEffect, useMemo, useState, useRef, Fragment } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { requestNotificationPermission, sendBrowserNotification } from "@/lib/notification";
import { PartBranchImages } from "./PartBranchImages";
import { 压缩图片 } from "@/lib/imageCompress";
import { usePriceVisibility } from "./PriceVisibilityContext";
import { PartSearchDropdown } from "./PartSearchDropdown";
import QuoteSheetModal from "./QuoteSheetModal";
import { resolvePartSellingPrice } from "@/lib/partPriceResolver";
import PartForm from "@/app/parts/new/PartForm";
import { useConfirm } from "./ConfirmDialog";

const STATUS_TITLES: Record<string, string> = {
  pending_inquiry: "待询价",
  pending_quote: "待报价",
  pending_confirm: "待确认",
};

type EditableField = "part_number" | "brand" | "specification" | "cost" | "price" | "supplier" | "notes" | "customer_opinion" | "name" | "unit" | "quantity";
type GroupBy = "plate" | "category" | "name" | "supplier" | "none";

const GROUP_OPTIONS: { key: GroupBy; label: string }[] = [
  { key: "plate", label: "按车牌" },
  { key: "category", label: "按分类" },
  { key: "name", label: "按名称" },
  { key: "supplier", label: "按供货商" },
];

interface PartBranchRow {
  id: string;
  name: string;
  brand: string | null;
  specification: string | null;
  unit: string | null;
  quantity: number | null;
  unit_cost: number | null;
  unit_price: number | null;
  customer_opinion: string | null;
  supplier_name: string | null;
  is_purchased: boolean | null;
  is_arrived: boolean | null;
  work_order_item_id: string;
  part_name_id: string | null;
  branch_group_id: string | null;
  part_id: string | null;
  part_number: string | null;
  notes: string | null;
  part_names: {
    name: string | null;
    category_id: string | null;
    part_categories: { name: string | null } | null;
  } | null;
  parts: {
    id: string;
    part_number: string | null;
    name: string | null;
    quantity: number;
    unit_cost: number | null;
    unit_price: number | null;
    notes?: string | null;
    part_brands: { name: string | null } | null;
    part_specifications: { name: string | null } | null;
    part_images: { storage_path: string }[] | null;
  } | null;
  work_order_items: {
    name: string;
    work_orders: {
      id: string;
      order_no: string;
      settled_at: string | null;
      order_type: string | null;
      customers: { id: string; name: string; phone: string | null; company: string | null } | null;
      vehicles: { id: string; plate_number: string; vin: string | null; vehicle_model_id: string | null } | null;
    } | null;
  } | null;
}

interface Supplier {
  id: string;
  name: string;
  recommendation_level?: number;
}

interface Props {
  status: "pending_inquiry" | "pending_quote" | "pending_confirm";
}

export function PartBranchStatusList({ status }: Props) {
  const supabase = createClient();
  const [rows, setRows] = useState<PartBranchRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, Partial<Record<EditableField, string>>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>("plate");
  const { 请求确认, 确认弹窗 } = useConfirm();

  /* 品牌/规格搜索建议 */
  const [availableBrands, setAvailableBrands] = useState<string[]>([]);
  const [availableSpecs, setAvailableSpecs] = useState<string[]>([]);

  /* 供应商推荐排序数据 */
  const [partBrandsMap, setPartBrandsMap] = useState<Map<string, string>>(new Map());
  const [supplierPartNameIds, setSupplierPartNameIds] = useState<Map<string, Set<string>>>(new Map());
  const [supplierCategoryIds, setSupplierCategoryIds] = useState<Map<string, Set<string>>>(new Map());
  const [supplierBrandIds, setSupplierBrandIds] = useState<Map<string, Set<string>>>(new Map());

  /* 车型匹配数据 */
  const [vehicleModelsMap, setVehicleModelsMap] = useState<Map<string, { 厂商?: string; 品牌?: string; 车系?: string }>>(new Map());
  const [supplierVehicleMap, setSupplierVehicleMap] = useState<Map<string, Set<string>>>(new Map());

  /* 编码替换对应的库存配件ID */
  const [replacePartIds, setReplacePartIds] = useState<Record<string, string>>({});

  /* 标记自己操作的时间戳，避免 Realtime 重复刷新 */
  const lastSelfUpdate = useRef<number>(0);

  /* 桌面通知冷却时间戳，避免连续刷屏 */
  const lastNotifyTime = useRef<number>(0);

  /* 供应商自定义下拉 */
  const [openSupplierRowId, setOpenSupplierRowId] = useState<string | null>(null);
  const supplierDropdownRef = useRef<HTMLDivElement>(null);
  const [supplierDropdownPos, setSupplierDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [partMediaMap, setPartMediaMap] = useState<Record<string, { id: string; storage_path: string }[]>>({});

  /* 配件信息图片编辑（图片列直接增删 part_images；rowId 级状态） */
  const [图片上传中, set图片上传中] = useState<string | null>(null);
  const 图片输入Refs = useRef<Record<string, HTMLInputElement | null>>({});
  /* 图片大图预览 */
  const [预览图, set预览图] = useState<string | null>(null);

  /* 批量选择 */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /* 批量设置供应商：可搜索弹层（替代原来的原生 select 长列表） */
  const [批量供应商弹层开, set批量供应商弹层开] = useState(false);
  const [批量供应商搜索, set批量供应商搜索] = useState("");
  const 批量供应商弹层ref = useRef<HTMLDivElement>(null);
  /* 生成询价链接弹窗 */
  const [询价弹窗开, set询价弹窗开] = useState(false);

  /* 编辑配件弹窗 */
  const [editRow, setEditRow] = useState<PartBranchRow | null>(null);
  const [newPartQuery, setNewPartQuery] = useState<string>("");

  useEffect(() => {
    if (!openSupplierRowId) return;
    function handleClick(e: MouseEvent) {
      if (supplierDropdownRef.current && !supplierDropdownRef.current.contains(e.target as Node)) {
        setOpenSupplierRowId(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openSupplierRowId]);

  /* 批量供应商弹层：点击外部关闭 */
  useEffect(() => {
    if (!批量供应商弹层开) return;
    function handleClick(e: MouseEvent) {
      if (批量供应商弹层ref.current && !批量供应商弹层ref.current.contains(e.target as Node)) {
        set批量供应商弹层开(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [批量供应商弹层开]);

  useEffect(() => {
    loadData();
     
  }, [status]);

  /* Supabase Realtime 订阅 */
  useEffect(() => {
    requestNotificationPermission();

    const channel = supabase
      .channel("work_order_item_parts_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "work_order_item_parts" },
        () => {
          /* 2 秒内自己刚操作过，跳过刷新避免重复 */
          if (Date.now() - lastSelfUpdate.current < 2000) return;
          loadData();
          /* 5 秒内只通知一次，避免刷屏 */
          if (Date.now() - lastNotifyTime.current > 5000) {
            lastNotifyTime.current = Date.now();
            const title = STATUS_TITLES[status] || "采购管理";
            sendBrowserNotification(`${title} 状态更新`, "配件采购状态有变动，请查看最新情况");
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
     
  }, [supabase]);

  async function loadData() {
    setLoading(true);
    const [
      { data: parts },
      { data: sups },
      { data: brandList },
      { data: specList },
      { data: spn },
      { data: spc },
      { data: spb },
    ] = await Promise.all([
      supabase
        .from("work_order_item_parts")
        .select(`
          id, name, brand, specification, unit, quantity, unit_cost, unit_price,
          customer_opinion, supplier_name, is_purchased, is_arrived,
          work_order_item_id, part_name_id, branch_group_id, part_id, part_number, notes,
          part_names(name, category_id, part_categories(name)),
          parts(
            id, part_number, name, quantity, unit_cost, unit_price, notes,
            part_brands(name),
            part_specifications(name),
            part_images(storage_path)
          ),
          work_order_items(
            name,
            work_orders(
              id, order_no, settled_at, order_type,
              customers(id, name, phone, company),
              vehicles(id, plate_number, vin, vehicle_model_id)
            )
          )
        `)
        .order("created_at", { ascending: true })
        .limit(1000),
      supabase.from("suppliers").select("id, name, recommendation_level").order("name"),
      supabase.from("part_brands").select("id, name"),
      supabase.from("part_specifications").select("name"),
      supabase.from("supplier_part_names").select("supplier_id, part_name_id"),
      supabase.from("supplier_part_categories").select("supplier_id, part_category_id"),
      supabase.from("supplier_part_brands").select("supplier_id, part_brand_id"),
    ]);

    const filtered = ((parts || []) as unknown as PartBranchRow[]).filter((r) => {
      const wo = r.work_order_items?.work_orders;
      if (!wo) return false;
      if (wo.settled_at) return false;
      if (wo.order_type === "cancelled") return false;
      /* 保养单不走询价/报价等采购流程（用户定的规则） */
      if (wo.order_type === "maintenance") return false;
      if (r.is_purchased || r.is_arrived) return false;

      const cost = Number(r.unit_cost || 0);
      const price = Number(r.unit_price || 0);
      const opinion = r.customer_opinion || "pending";

      if (status === "pending_inquiry") return cost <= 0;
      if (status === "pending_quote") return cost > 0 && price <= 0;
      if (status === "pending_confirm") return cost > 0 && price > 0 && opinion === "pending";
      return false;
    });

    /* 查询配件分支图片 */
    const partIds = (filtered || []).map((p) => p.id);
    /* 三元空分支 [] 会推导 any[]，给解构模式加注解统一类型 */
    const { data: partMediaData }: { data: { id: string; work_order_item_part_id: string; storage_path: string }[] | null } = partIds.length > 0
      ? await supabase.from("work_order_item_part_media").select("id, work_order_item_part_id, storage_path").in("work_order_item_part_id", partIds)
      : { data: [] };
    const mediaMap: Record<string, { id: string; storage_path: string }[]> = {};
    partMediaData?.forEach((m: { id: string; work_order_item_part_id: string; storage_path: string }) => {
      const pid = m.work_order_item_part_id;
      if (!mediaMap[pid]) mediaMap[pid] = [];
      mediaMap[pid].push({ id: m.id, storage_path: m.storage_path });
    });
    setPartMediaMap(mediaMap);

    /* 查询车型匹配数据 */
    const vehicleModelIds = [...new Set((filtered || []).map((r) => r.work_order_items?.work_orders?.vehicles?.vehicle_model_id).filter(Boolean))];
    const vmMap = new Map<string, { 厂商?: string; 品牌?: string; 车系?: string }>();
    const svmMap = new Map<string, Set<string>>();
    if (vehicleModelIds.length > 0) {
      const [{ data: vmList }, { data: svmList }] = await Promise.all([
        supabase.from("vehicle_models").select("id, 厂商, 品牌, 车系").in("id", vehicleModelIds),
        supabase.from("supplier_vehicle_models").select("supplier_id, vehicle_model_id").in("vehicle_model_id", vehicleModelIds),
      ]);
      ((vmList || []) as unknown as { id: string; 厂商?: string; 品牌?: string; 车系?: string }[]).forEach((v) => {
        vmMap.set(String(v.id), { 厂商: v.厂商, 品牌: v.品牌, 车系: v.车系 });
      });
      (svmList || []).forEach((r: { supplier_id: string; vehicle_model_id: string }) => {
        const set = svmMap.get(r.supplier_id) || new Set();
        set.add(String(r.vehicle_model_id));
        svmMap.set(r.supplier_id, set);
      });
    }
    setVehicleModelsMap(vmMap);
    setSupplierVehicleMap(svmMap);

    setRows(filtered);
    setSuppliers((sups || []) as Supplier[]);
    setEdits({});
    setReplacePartIds({});

    /* 品牌/规格搜索建议 */
    setAvailableBrands((brandList || []).map((b: { name: string }) => b.name).filter(Boolean));
    setAvailableSpecs([...new Set((specList || []).map((s: { name: string }) => s.name).filter(Boolean))]);

    /* 品牌名 -> ID 映射 */
    setPartBrandsMap(new Map((brandList || []).map((b: { name: string; id: string }) => [b.name, String(b.id)])));

    /* 供应商关联数据 */
    const spnMap = new Map<string, Set<string>>();
    (spn || []).forEach((r: { supplier_id: string; part_name_id: string }) => {
      const set = spnMap.get(r.supplier_id) || new Set();
      set.add(String(r.part_name_id));
      spnMap.set(r.supplier_id, set);
    });
    setSupplierPartNameIds(spnMap);

    const spcMap = new Map<string, Set<string>>();
    (spc || []).forEach((r: { supplier_id: string; part_category_id: string }) => {
      const set = spcMap.get(r.supplier_id) || new Set();
      set.add(String(r.part_category_id));
      spcMap.set(r.supplier_id, set);
    });
    setSupplierCategoryIds(spcMap);

    const spbMap = new Map<string, Set<string>>();
    (spb || []).forEach((r: { supplier_id: string; part_brand_id: string }) => {
      const set = spbMap.get(r.supplier_id) || new Set();
      set.add(String(r.part_brand_id));
      spbMap.set(r.supplier_id, set);
    });
    setSupplierBrandIds(spbMap);

    setLoading(false);
  }

  /* 上传配件信息图片：压缩 → /api/upload → part_images 插行 → 重载 */
  async function 上传目录图片(row: PartBranchRow, file: File) {
    if (!row.parts?.id) return;
    if (!file.type.startsWith("image/")) {
      alert("请选择图片文件");
      return;
    }
    set图片上传中(row.id);
    try {
      const compressed = await 压缩图片(file);
      const formData = new FormData();
      formData.append("file", compressed, file.name);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "上传失败");
      const { error } = await supabase.from("part_images").insert({
        part_id: row.parts.id,
        storage_path: result.path,
        sort_order: (row.parts.part_images || []).length,
      });
      if (error) throw new Error(error.message);
      await loadData();
    } catch (err: unknown) {
      alert("图片上传失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      set图片上传中(null);
    }
  }

  /* 删除配件信息图片 */
  async function 删除目录图片(row: PartBranchRow, storagePath: string) {
    if (!row.parts?.id) return;
    const { error } = await supabase
      .from("part_images")
      .delete()
      .eq("part_id", row.parts.id)
      .eq("storage_path", storagePath);
    if (error) {
      alert("删除失败: " + error.message);
      return;
    }
    await loadData();
  }

  /* 上传工单配件图片（未关联库存配件的分支：图片挂到工单配件上） */
  async function 上传分支图片(row: PartBranchRow, file: File) {
    if (!file.type.startsWith("image/")) {
      alert("请选择图片文件");
      return;
    }
    set图片上传中(row.id);
    try {
      const compressed = await 压缩图片(file);
      const formData = new FormData();
      formData.append("file", compressed, file.name);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "上传失败");
      const { error } = await supabase.from("work_order_item_part_media").insert({
        work_order_item_part_id: row.id,
        media_type: "image",
        storage_path: result.path,
      });
      if (error) throw new Error(error.message);
      await loadData();
    } catch (err: unknown) {
      alert("图片上传失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      set图片上传中(null);
    }
  }

  function setEditValue(rowId: string, field: EditableField, value: string) {
    setEdits((prev) => ({
      ...prev,
      [rowId]: { ...prev[rowId], [field]: value },
    }));
  }

  function clearDraft(rowId: string, field: EditableField) {
    setEdits((prev) => {
      const next = { ...prev };
      if (next[rowId]) {
        const merged = { ...next[rowId] };
        delete merged[field];
        if (Object.keys(merged).length === 0) delete next[rowId];
        else next[rowId] = merged;
      }
      return next;
    });
  }

  function getDbUpdate(row: PartBranchRow) {
    const rowEdits = edits[row.id];
    if (!rowEdits) return null;

    const update: Record<string, string | number | null> = {};

    for (const _field of Object.keys(rowEdits) as EditableField[]) {
      const raw = rowEdits[_field];
      if (raw === undefined) continue;
      const trimmed = raw.trim();

      if (_field === "part_number") {
        const val = trimmed === "" ? null : trimmed.toUpperCase();
        if (val !== (row.part_number || null)) update.part_number = val;
      } else if (_field === "brand") {
        const val = trimmed === "" ? null : trimmed;
        if (val !== (row.brand || null)) update.brand = val;
      } else if (_field === "specification") {
        const val = trimmed === "" ? null : trimmed;
        if (val !== (row.specification || null)) update.specification = val;
      } else if (_field === "supplier") {
        const val = trimmed === "" ? null : trimmed;
        if (val !== (row.supplier_name || null)) update.supplier_name = val;
      } else if (_field === "notes") {
        const val = trimmed === "" ? null : trimmed;
        if (val !== (row.notes || null)) update.notes = val;
      } else if (_field === "customer_opinion") {
        const val = trimmed === "" ? null : trimmed;
        if (val !== (row.customer_opinion || null)) update.customer_opinion = val;
      } else if (_field === "name") {
        const val = trimmed === "" ? null : trimmed;
        if (val !== (row.name || null)) update.name = val;
      } else if (_field === "unit") {
        const val = trimmed === "" ? null : trimmed;
        if (val !== (row.unit || null)) update.unit = val;
      } else if (_field === "quantity") {
        /* 数量：留空=未填存 NULL 保持标红提醒（用户要求不兜底）；填了必须是正整数 */
        if (trimmed === "") {
          if (row.quantity !== null) update.quantity = null;
          continue;
        }
        const num = Number(trimmed);
        if (!Number.isInteger(num) || num <= 0) continue;
        if (num !== row.quantity) update.quantity = num;
      } else if (_field === "cost" || _field === "price") {
        const dbField = _field === "cost" ? "unit_cost" : "unit_price";
        if (trimmed === "") {
          const original = _field === "cost" ? row.unit_cost : row.unit_price;
          if (original !== null) update[dbField] = null;
          continue;
        }
        const num = Number(trimmed);
        if (!Number.isFinite(num) || num < 0) continue;
        const original = _field === "cost" ? Number(row.unit_cost || 0) : Number(row.unit_price || 0);
        if (num !== original) update[dbField] = num;
      }
    }

    return Object.keys(update).length > 0 ? update : null;
  }

  /* ========== 配件编辑弹窗 ========== */
  function openEditModal(row: PartBranchRow) {
    setNewPartQuery("");
    setEditRow(row);
  }
  function closeEditModal() {
    setNewPartQuery("");
    setEditRow(null);
  }

  interface PartDetail {
    part_number: string | null;
    name: string | null;
    unit: string | null;
    category_id: string | null;
    brand_id: string | null;
    specification_id: string | null;
    unit_cost: number | null;
    unit_price: number | null;
    purchase_price: number | null;
    notes: string | null;
    document_name: string | null;
    part_brands: { name: string | null } | { name: string | null }[] | null;
    part_specifications: { name: string | null } | { name: string | null }[] | null;
    part_categories: { name: string | null } | { name: string | null }[] | null;
  }

  function extractName(
    val: { name: string | null } | { name: string | null }[] | null | undefined
  ): string | null {
    if (!val) return null;
    if (Array.isArray(val)) return val[0]?.name ?? null;
    return val.name ?? null;
  }

  async function handlePartSaved(partId: string) {
    if (!editRow) return;
    setSavingId(editRow.id);
    try {
      const { data: part } = await supabase
        .from("parts")
        .select(
          "part_number, name, unit, category_id, part_categories(name), brand_id, part_brands(name), specification_id, part_specifications(name), unit_cost, unit_price, purchase_price, notes, document_name"
        )
        .eq("id", partId)
        .single();

      const p = part as unknown as PartDetail | null;
      const updates: Record<string, string | number | null> = { part_id: partId };
      if (p) {
        if (p.part_number != null) updates.part_number = p.part_number;
        if (p.name != null) updates.name = p.name;
        if (p.unit != null) updates.unit = p.unit;
        const brandName = extractName(p.part_brands);
        const specName = extractName(p.part_specifications);
        if (brandName != null) updates.brand = brandName;
        if (specName != null) updates.specification = specName;
        if (p.purchase_price != null) updates.unit_cost = p.purchase_price;
        if (p.notes != null) updates.notes = p.notes;
        if (p.document_name != null) updates.document_name = p.document_name;
      }

      const { error } = await supabase
        .from("work_order_item_parts")
        .update(updates)
        .eq("id", editRow.id);
      if (error) throw error;

      /* 同步更新关联的 purchase_order_items */
      const { error: poiErr } = await supabase
        .from("purchase_order_items")
        .update({
          part_id: partId,
          part_number: p?.part_number || updates.part_number || null,
          name: p?.name || updates.name || null,
          unit: p?.unit || updates.unit || null,
          brand: extractName(p?.part_brands) || updates.brand || null,
          specification: extractName(p?.part_specifications) || updates.specification || null,
          category: extractName(p?.part_categories) || null,
        })
        .eq("work_order_item_part_id", editRow.id);
      if (poiErr) console.warn("同步采购单配件信息失败:", poiErr);

      closeEditModal();
      lastSelfUpdate.current = Date.now();
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("同步配件信息失败: " + msg);
    } finally {
      setSavingId(null);
    }
  }

  interface InlinePart {
    id: string;
    part_number: string | null;
    barcode: string | null;
    name: string | null;
    unit: string | null;
    unit_cost: number | null;
    unit_price: number | null;
    part_names?: { name: string | null; unit: string | null } | null;
    part_brands?: { name: string | null } | null;
    part_specifications?: { name: string | null } | null;
    part_categories?: { name: string | null } | null;
  }

  /* 行内搜索选中配件 */
  async function handleInlinePartSelect(row: PartBranchRow, part: InlinePart) {
    const currentName = edits[row.id]?.name ?? row.name ?? "";
    const currentBrand = edits[row.id]?.brand ?? row.brand ?? "";
    const currentSpec = edits[row.id]?.specification ?? row.specification ?? "";
    const currentUnit = edits[row.id]?.unit ?? row.unit ?? "";

    setEdits((prev) => ({
      ...prev,
      [row.id]: {
        ...prev[row.id],
        part_number: part.part_number || part.barcode || "",
        name: currentName || part.name || part.part_names?.name || "",
        brand: currentBrand || part.part_brands?.name || "",
        specification: currentSpec || part.part_specifications?.name || "",
        unit: currentUnit || part.unit || part.part_names?.unit || "",
      },
    }));
    setReplacePartIds((prev) => ({ ...prev, [row.id]: part.id }));

    /* 待询价/待报价阶段：填充采购价和根据工单匹配销售价 */
    if (status === "pending_inquiry" || status === "pending_quote") {
      const currentCost = edits[row.id]?.cost ?? (row.unit_cost != null ? String(row.unit_cost) : "");
      const costStr = part.unit_cost != null ? String(part.unit_cost) : "";
      setEdits((prev) => ({
        ...prev,
        [row.id]: {
          ...prev[row.id],
          cost: currentCost || costStr,
        },
      }));

      /* 售价：工单中已报则不覆盖，没有才按配件更新 */
      const currentPrice = edits[row.id]?.price ?? (row.unit_price != null ? String(row.unit_price) : "");
      if (!currentPrice) {
        const wo = row.work_order_items?.work_orders;
        const ctx = {
          vehicleId: wo?.vehicles?.id,
          customerId: wo?.customers?.id,
          companyName: wo?.customers?.company || undefined,
          vehicleModelId: wo?.vehicles?.vehicle_model_id || undefined,
        };
        const resolved = await resolvePartSellingPrice(supabase, part.id, ctx);
        const priceStr = resolved.price != null ? String(resolved.price) : (part.unit_price != null ? String(part.unit_price) : "");
        if (priceStr) {
          setEdits((prev) => ({
            ...prev,
            [row.id]: {
              ...prev[row.id],
              price: priceStr,
            },
          }));
        }
      }
    }
  }

  /* 行内搜索清除配件关联 */
  function handleInlineClear(row: PartBranchRow) {
    setEdits((prev) => {
      const next = { ...prev, [row.id]: { ...prev[row.id] } };
      delete next[row.id].part_number;
      return next;
    });
    setReplacePartIds((prev) => {
      const next = { ...prev };
      delete next[row.id];
      return next;
    });
  }

  /* 行内搜索无匹配 -> 新建配件 */
  function handleInlineCreateNew(row: PartBranchRow, query: string) {
    setNewPartQuery(query);
    setEditRow(row);
  }

  /* 根据编码从库存中查找配件并预填充 */
  async function tryReplaceByPartNumber(rowId: string, partNumber: string) {
    const pn = partNumber.trim().toUpperCase();
    if (!pn) return;

    const { data } = await supabase
      .from("parts")
      .select("id, part_number, name, unit_cost, unit_price, part_brands(name), part_specifications(name)")
      .or(`part_number.eq.${pn},barcode.eq.${pn}`)
      .limit(5);

    const matched = (data || []) as unknown as Array<{
      id: string;
      part_number: string | null;
      unit_cost: number | null;
      unit_price: number | null;
      part_brands: { name: string | null } | null;
      part_specifications: { name: string | null } | null;
    }>;
    if (matched.length === 0) return;

    const p = matched[0];
    const newBrand = p.part_brands?.name || "";
    const newSpec = p.part_specifications?.name || "";
    const newCost = p.unit_cost != null ? String(p.unit_cost) : "";
    const newPrice = p.unit_price != null ? String(p.unit_price) : "";

    setReplacePartIds((prev) => ({ ...prev, [rowId]: p.id }));
    setEdits((prev) => ({
      ...prev,
      [rowId]: {
        ...prev[rowId],
        part_number: p.part_number || pn,
        brand: newBrand,
        specification: newSpec,
        cost: newCost,
        price: newPrice,
      },
    }));
  }

  async function revertSelected() {
    if (selectedIds.size === 0) return;
    const prevStatusMap: Record<string, string> = {
      pending_quote: "待询价",
      pending_confirm: "待报价",
    };
    const prevStatus = prevStatusMap[status];
    if (!prevStatus) return;
    if (!(await 请求确认(`确定将选中的 ${selectedIds.size} 条配件撤销到「${prevStatus}」状态吗？`))) return;

    setSubmitting(true);
    let updateData: Record<string, string | number | null> = {};
    if (status === "pending_quote") {
      updateData = { unit_cost: null };
    } else if (status === "pending_confirm") {
      updateData = { unit_price: null };
    }

    const { error } = await supabase
      .from("work_order_item_parts")
      .update(updateData)
      .in("id", Array.from(selectedIds));

    setSubmitting(false);
    if (error) {
      alert("撤销失败: " + error.message);
      return;
    }
    setSelectedIds(new Set());
    lastSelfUpdate.current = Date.now();
    loadData();
  }

  async function submitAll() {
    /* 只保留有真实改动的行(getDbUpdate 判定):填了又清空、改回原样的行不算改动,
       既不参与校验拦截,也不计入提交条数 */
    const rowIds = Object.keys(edits).filter((id) => {
      const row = rows.find((r) => r.id === id);
      return row ? getDbUpdate(row) !== null : false;
    });
    if (rowIds.length === 0) {
      setEdits({});
      setReplacePartIds({});
      return;
    }

    /* 提交校验：
     * 待询价页（用户定的规则）——供应商和采购价必须同时填写：
     * 只填其中一个（含草稿和已保存值的合并结果）就拦截，并指出是哪行缺哪项。
     * 其他阶段页——保持原规则：会导致记录推进到下阶段的编辑，必须填写采购价和供应商 */
    for (const id of rowIds) {
      const row = rows.find((r) => r.id === id);
      if (!row) continue;
      /* 只把"真实改动过的字段"叠到原值上;无效草稿(填了又清空)不覆盖原值 */
      const 改动 = getDbUpdate(row)!;
      const newCost = "unit_cost" in 改动 ? Number(改动.unit_cost || 0) : Number(row.unit_cost || 0);
      const newPrice = "unit_price" in 改动 ? Number(改动.unit_price || 0) : Number(row.unit_price || 0);
      const newOpinion = "customer_opinion" in 改动 ? 改动.customer_opinion : row.customer_opinion;
      const newSupplier = ("supplier_name" in 改动 ? 改动.supplier_name : row.supplier_name) as string | null;

      if (status === "pending_inquiry") {
        const 有采购价 = newCost > 0;
        const 有供应商 = !!(newSupplier && newSupplier.trim() !== "");
        if (有采购价 !== 有供应商) {
          alert(
            `「${row.name || "未命名配件"}」${有采购价 ? "已填采购价，但还没选供应商" : "已选供应商，但还没填采购价"}。\n供应商和采购价必须同时填写。`
          );
          return;
        }
        continue;
      }

      const willAdvance =
        (status === "pending_quote" && newPrice > 0) ||
        (status === "pending_confirm" && newOpinion === "agree");

      if (willAdvance) {
        if (newCost <= 0) {
          alert(`「${row.name || "未命名配件"}」推进到下阶段必须填写采购价`);
          return;
        }
        if (!newSupplier || newSupplier.trim() === "") {
          alert(`「${row.name || "未命名配件"}」推进到下阶段必须填写供应商`);
          return;
        }
      }
    }

    const updates: { id: string; data: Record<string, string | number | null> }[] = [];
    for (const id of rowIds) {
      const row = rows.find((r) => r.id === id);
      if (!row) continue;
      const data = getDbUpdate(row);
      if (!data) continue;

      /* 编码替换：找到匹配库存配件则更新 part_id；编码被改但未找到匹配则解除关联 */
      if (replacePartIds[id]) {
        data.part_id = replacePartIds[id];
      } else if ("part_number" in data) {
        data.part_id = null;
      }

      updates.push({ id, data });
    }

    if (updates.length === 0) {
      setEdits({});
      setReplacePartIds({});
      return;
    }

    setSubmitting(true);
    const results = await Promise.all(
      updates.map(({ id, data }) =>
        supabase.from("work_order_item_parts").update(data).eq("id", id)
      )
    );
    setSubmitting(false);

    const errors = results.filter((r) => r.error);
    if (errors.length > 0) {
      alert("保存失败: " + errors.map((e) => e.error?.message).filter(Boolean).join("; "));
      return;
    }

    setEdits({});
    setReplacePartIds({});
    lastSelfUpdate.current = Date.now();
    loadData();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, row: PartBranchRow, field: EditableField) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (field === "part_number") {
        const val = (e.target as HTMLInputElement).value;
        tryReplaceByPartNumber(row.id, val);
      }
      (e.target as HTMLInputElement).blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      clearDraft(row.id, field);
      (e.target as HTMLInputElement).blur();
    }
  }

  /* 提交条数只计有真实改动的行(填了又清空不计) */
  const changedCount = Object.keys(edits).filter((id) => {
    const row = rows.find((r) => r.id === id);
    return row ? getDbUpdate(row) !== null : false;
  }).length;

  /* 在当前配件上添加同项目分支 */
  async function handleAddSiblingBranch(row: PartBranchRow) {
    if (!(await 请求确认("确定添加该配件的新分支吗？"))) return;
    setSavingId(row.id);
    const { error } = await supabase.from("work_order_item_parts").insert({
      work_order_item_id: row.work_order_item_id,
      part_name_id: row.part_name_id,
      // 归回原配件的同一目录，避免新分支自成一组；不显式设 branch_group_id
      // 会被数据库默认值生成新目录ID(自成一组的病根)
      branch_group_id: row.branch_group_id,
      name: row.name,
      /* 数量留空（NULL）：未填数量的配件红底留白提醒补填，不兜底成 1 */
      quantity: row.quantity ?? null,
      unit: row.unit,
      customer_opinion: "pending",
      // 原行为该目录默认(选中)分支，新增分支默认不选中，维持"每目录仅一个选中"
      is_selected: false,
    });
    setSavingId(null);
    if (error) { alert("添加失败: " + error.message); return; }
    lastSelfUpdate.current = Date.now();
    loadData();
  }

  /* 删除分支 */
  async function handleDeleteBranch(row: PartBranchRow) {
    if (row.is_purchased || row.is_arrived) {
      alert("已采购或已到货的配件不能删除");
      return;
    }
    if (!(await 请求确认("确定删除该配件分支吗？"))) return;
    setSavingId(row.id);
    const { error } = await supabase.from("work_order_item_parts").delete().eq("id", row.id);
    setSavingId(null);
    if (error) { alert("删除失败: " + error.message); return; }
    lastSelfUpdate.current = Date.now();
    loadData();
  }

  /* 按当前行配件信息给供应商排序 */
  function getSortedSuppliers(row: PartBranchRow): Supplier[] {
    const partNameId = row.part_name_id ? String(row.part_name_id) : null;
    const categoryId = row.part_names?.category_id ? String(row.part_names.category_id) : null;
    const currentBrand = edits[row.id]?.brand !== undefined ? edits[row.id]!.brand : row.brand;
    const brandId = currentBrand ? partBrandsMap.get(currentBrand) : null;

    return [...suppliers].sort((a, b) => {
      const score = (s: Supplier) => {
        let sc = 0;
        sc += (s.recommendation_level || 0) * 10;
        if (partNameId && supplierPartNameIds.get(s.id)?.has(partNameId)) sc += 500;
        if (categoryId && supplierCategoryIds.get(s.id)?.has(categoryId)) sc += 200;
        if (brandId && supplierBrandIds.get(s.id)?.has(brandId)) sc += 200;
        return sc;
      };
      const aScore = score(a);
      const bScore = score(b);
      if (bScore !== aScore) return bScore - aScore;
      return (a.name || "").localeCompare(b.name || "", "zh-CN");
    });
  }

  /* 获取供应商匹配原因 */
  function getSupplierMatchReasons(row: PartBranchRow, s: Supplier): string[] {
    const reasons: string[] = [];
    const partNameId = row.part_name_id ? String(row.part_name_id) : null;
    const categoryId = row.part_names?.category_id ? String(row.part_names.category_id) : null;
    const currentBrand = edits[row.id]?.brand !== undefined ? edits[row.id]!.brand : row.brand;
    const brandId = currentBrand ? partBrandsMap.get(currentBrand) : null;

    /* 车型匹配 */
    const vehicleModelId = row.work_order_items?.work_orders?.vehicles?.vehicle_model_id;
    if (vehicleModelId) {
      const vm = vehicleModelsMap.get(String(vehicleModelId));
      const supplierVmIds = supplierVehicleMap.get(s.id);
      if (vm && supplierVmIds?.has(String(vehicleModelId))) {
        const parts: string[] = [];
        if (vm.厂商) parts.push(vm.厂商);
        if (vm.品牌) parts.push(vm.品牌);
        if (vm.车系) parts.push(vm.车系);
        reasons.push(`匹配车型${parts.length > 0 ? ":" + parts.join("-") : ""}`);
      }
    }

    if (partNameId && supplierPartNameIds.get(s.id)?.has(partNameId)) reasons.push("匹配配件");
    if (categoryId && supplierCategoryIds.get(s.id)?.has(categoryId)) reasons.push("匹配分类");
    if (brandId && supplierBrandIds.get(s.id)?.has(brandId)) reasons.push("匹配品牌");
    if (s.recommendation_level && s.recommendation_level > 0) reasons.push("⭐".repeat(s.recommendation_level));

    return reasons;
  }

  function getGroupKey(row: PartBranchRow): string {
    if (groupBy === "plate") return row.work_order_items?.work_orders?.vehicles?.plate_number || "(无车牌)";
    if (groupBy === "category") return row.part_names?.part_categories?.name || "(未分类)";
    if (groupBy === "name") return row.name || "(未命名)";
    if (groupBy === "supplier") return row.supplier_name || "(未指定供应商)";
    return "";
  }

  /* 批量选择 */
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === rows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(rows.map((r) => r.id)));
    }
  }

  /* 批量设置供应商：在弹层里点一个供应商，直接写入所有选中行的草稿 */
  function applyBatchSupplier(供应商名: string) {
    if (!供应商名) return;
    for (const id of selectedIds) {
      setEditValue(id, "supplier", 供应商名);
    }
    set批量供应商弹层开(false);
    set批量供应商搜索("");
  }

  /* 批量供应商列表：按"匹配选中行数 + 推荐星级"排序，支持按名称搜索 */
  const 批量供应商列表 = useMemo(() => {
    const 选中行 = rows.filter((r) => selectedIds.has(r.id));
    const q = 批量供应商搜索.trim().toLowerCase();
    return suppliers
      .map((s) => {
        let 匹配行数 = 0;
        for (const row of 选中行) {
          if (getSupplierMatchReasons(row, s).length > 0) 匹配行数++;
        }
        return { s, 匹配行数 };
      })
      .filter(({ s }) => !q || (s.name || "").toLowerCase().includes(q))
      .sort((a, b) =>
        (b.匹配行数 - a.匹配行数) ||
        ((b.s.recommendation_level || 0) - (a.s.recommendation_level || 0)) ||
        (a.s.name || "").localeCompare(b.s.name || "", "zh-CN")
      );

  }, [suppliers, rows, selectedIds, 批量供应商搜索]);

  /* 待询价页：有行已选供应商但还没采购价时提示（规则：两者必须同时填写） */
  const 缺采购价行数 = useMemo(() => {
    if (status !== "pending_inquiry") return 0;
    let n = 0;
    for (const [id, e] of Object.entries(edits)) {
      const row = rows.find((r) => r.id === id);
      if (!row) continue;
      const supplier = e.supplier !== undefined ? e.supplier : row.supplier_name;
      const cost = e.cost !== undefined ? e.cost : (row.unit_cost != null ? String(row.unit_cost) : "");
      if (supplier && supplier.trim() !== "" && !(Number(cost || 0) > 0)) n++;
    }
    return n;
  }, [edits, rows, status]);

  /* 按 groupBy 把 rows 分组,保持原排序;返回 [key, rows][] */
  const groups = useMemo<Array<{ key: string; rows: PartBranchRow[] }>>(() => {
    if (groupBy === "none") return [{ key: "", rows }];
    const map = new Map<string, PartBranchRow[]>();
    for (const r of rows) {
      const k = getGroupKey(r);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, "zh"))
      .map(([key, rs]) => ({ key, rows: rs.sort((a, b) => (a.name || "").localeCompare(b.name || "", "zh")) }));
     
  }, [rows, groupBy]);

  /* 待询价阶段不显示"销售价/客户意见"两列（用户拍板 2026-08-06：询价阶段只关心采购侧信息） */
  const 隐藏销售价客户意见 = status === "pending_inquiry";
  const totalCols = 隐藏销售价客户意见 ? 13 : 15;

  /* 分支同色背景色表（草稿黄色已占用，此处避开黄色） */
  const BRANCH_BG_COLORS = [
    "bg-blue-50/40",
    "bg-green-50/40",
    "bg-purple-50/40",
    "bg-pink-50/40",
    "bg-indigo-50/40",
    "bg-orange-50/40",
    "bg-cyan-50/40",
  ];

  function renderRow(row: PartBranchRow, isNewBranch = false, branchColorIndex = 0) {
    const wo = row.work_order_items?.work_orders;
    const isSaving = savingId === row.id;
    const partNumberDraft = edits[row.id]?.part_number;
    const nameDraft = edits[row.id]?.name;
    const brandDraft = edits[row.id]?.brand;
    const specDraft = edits[row.id]?.specification;
    const unitDraft = edits[row.id]?.unit;
    const costDraft = edits[row.id]?.cost;
    const priceDraft = edits[row.id]?.price;
    const supplierDraft = edits[row.id]?.supplier;
    const notesDraft = edits[row.id]?.notes;
    const quantityDraft = edits[row.id]?.quantity;

    const partNumberValue = partNumberDraft !== undefined ? partNumberDraft : (row.part_number || "");
    const nameValue = nameDraft !== undefined ? nameDraft : (row.name || "");
    const brandValue = brandDraft !== undefined ? brandDraft : (row.brand || "");
    const specValue = specDraft !== undefined ? specDraft : (row.specification || "");
    const unitValue = unitDraft !== undefined ? unitDraft : (row.unit || "");
    const costValue = costDraft !== undefined ? costDraft : (row.unit_cost != null && row.unit_cost > 0 ? String(row.unit_cost) : "");
    const priceValue = priceDraft !== undefined ? priceDraft : (row.unit_price != null && row.unit_price > 0 ? String(row.unit_price) : "");
    const supplierValue = supplierDraft !== undefined ? supplierDraft : (row.supplier_name || "");
    /* 备注：工单配件自己的备注优先；没填则带入配件信息里的备注（只读带入，编辑后保存到工单配件） */
    const notesValue = notesDraft !== undefined ? notesDraft : (row.notes || row.parts?.notes || "");
    const quantityValue = quantityDraft !== undefined ? quantityDraft : (row.quantity != null ? String(row.quantity) : "");

    const hasDraft = !!edits[row.id] && Object.keys(edits[row.id]!).length > 0;
    /* 真实改动集:getDbUpdate 已做 trim/null 归一 + 与原值逐字段比较。
       填了又清空、改回原样,都不算改动——标黄/行底色/提交计数全部以此为准 */
    const 真实改动 = hasDraft ? getDbUpdate(row) : null;
    const 行有已填草稿 = 真实改动 !== null;
    const 改了 = (列名: string) => 真实改动 !== null && 列名 in 真实改动;
    const branchBg = 行有已填草稿 ? "" : BRANCH_BG_COLORS[branchColorIndex % BRANCH_BG_COLORS.length];

    return (
      <tr key={row.id} className={`hover:bg-gray-50 ${行有已填草稿 ? "bg-yellow-50/40" : branchBg} ${isNewBranch ? "border-t-2 border-gray-200" : ""}`}>
        <td className="px-2 py-2">
          <input
            type="checkbox"
            checked={selectedIds.has(row.id)}
            onChange={() => toggleSelect(row.id)}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
        </td>
        <td className="px-2 py-2">
          {wo ? (
            <Link href={`/work-orders/${wo.id}`} className="text-blue-600 hover:text-blue-700 font-medium">
              {wo.order_no}
            </Link>
          ) : (
            <span className="text-gray-400">-</span>
          )}
        </td>
        {/* 编码 */}
        <td className="px-2 py-2">
          <PartSearchDropdown
            value={partNumberValue}
            /* 输入时不转大写（保存时 getDbUpdate 会统一转）：中文输入法打字过程中
             * 强行改值会打断拼音上屏，导致输入 xy 变成 XXY 这类重复字符 */
            onChange={(val) => setEditValue(row.id, "part_number", val)}
            onSelect={(part) => handleInlinePartSelect(row, part)}
            onCreateNew={(query) => handleInlineCreateNew(row, query)}
            onClear={() => handleInlineClear(row)}
            disabled={isSaving}
            placeholder="编码/条码"
            inputClassName={`w-28 bg-white placeholder:text-gray-400 ${改了("part_number") ? "border-yellow-400 bg-yellow-50" : "border-gray-300"}`}
          />
        </td>
        <td className={`px-2 py-2 text-gray-900 ${改了("name") ? "text-blue-700 font-medium" : ""}`}>{nameValue}</td>
        <td className="px-2 py-2">
          <input
            type="text"
            disabled={isSaving}
            value={brandValue}
            onChange={(e) => setEditValue(row.id, "brand", e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, row, "brand")}
            placeholder="品牌（选填）"
            list="brand-suggestions"
            className={`w-24 px-2 py-1 text-xs rounded border bg-white placeholder:text-gray-400 hover:border-blue-400 focus:border-blue-500 focus:outline-none disabled:opacity-50 ${改了("brand") ? "border-yellow-400 bg-yellow-50" : "border-gray-300"}`}
          />
        </td>
        <td className="px-2 py-2">
          <input
            type="text"
            disabled={isSaving}
            value={specValue}
            onChange={(e) => setEditValue(row.id, "specification", e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, row, "specification")}
            placeholder="规格（选填）"
            list="spec-suggestions"
            className={`w-24 px-2 py-1 text-xs rounded border bg-white placeholder:text-gray-400 hover:border-blue-400 focus:border-blue-500 focus:outline-none disabled:opacity-50 ${改了("specification") ? "border-yellow-400 bg-yellow-50" : "border-gray-300"}`}
          />
        </td>
        {/* 数量：可直接编辑，保存写回工单；留空保持红框提醒（用户要求：红框提醒保留 + 可输入联动工单） */}
        <td className="px-2 py-2 text-right">
          <div className="flex items-center justify-end gap-1">
            <input
              type="number"
              min="1"
              step="1"
              disabled={isSaving}
              value={quantityValue}
              onChange={(e) => setEditValue(row.id, "quantity", e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, row, "quantity")}
              placeholder="未填"
              className={`w-14 px-2 py-1 text-right text-xs rounded border hover:border-blue-400 focus:border-blue-500 focus:outline-none disabled:opacity-50 ${
                quantityValue.trim() === ""
                  ? "border-red-300 bg-red-50 text-red-600 placeholder-red-400"
                  : 改了("quantity")
                    ? "border-yellow-400 bg-yellow-50"
                    : "border-gray-200"
              }`}
            />
            <span className="text-xs text-gray-500">{unitValue || "件"}</span>
          </div>
        </td>
        {/* 库存 */}
        <td className="px-2 py-2 text-right text-gray-700">
          {row.parts ? (
            <span className={row.parts.quantity <= 0 ? "text-red-600 font-semibold" : ""}>{row.parts.quantity}</span>
          ) : (
            <span className="text-gray-300">-</span>
          )}
        </td>
        <td className="px-2 py-2 text-right">
          {showPrices ? (
            <div className="flex items-center justify-end gap-1">
              <span className="text-gray-400">¥</span>
              <input
                type="number"
                min="0"
                step="0.01"
                disabled={isSaving}
                value={costValue}
                onChange={(e) => setEditValue(row.id, "cost", e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, row, "cost")}
                placeholder="必填"
                title="采购价（必填）"
                className={`w-20 px-2 py-1 text-right text-xs rounded border hover:border-blue-400 focus:border-blue-500 focus:outline-none disabled:opacity-50 ${
                  改了("unit_cost")
                    ? "border-yellow-400 bg-yellow-50"
                    : !costValue
                      ? "border-red-400 bg-red-50"
                      : "border-gray-200"
                }`}
              />
            </div>
          ) : (
            <span className="text-gray-700">***</span>
          )}
        </td>
        {!隐藏销售价客户意见 && (
          <>
            <td className="px-2 py-2 text-right">
              {showPrices ? (
                <div className="flex items-center justify-end gap-1">
                  <span className="text-gray-400">¥</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={isSaving}
                    value={priceValue}
                    onChange={(e) => setEditValue(row.id, "price", e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, row, "price")}
                    placeholder="-"
                    className={`w-20 px-2 py-1 text-right text-xs rounded border hover:border-blue-400 focus:border-blue-500 focus:outline-none disabled:opacity-50 ${改了("unit_price") ? "border-yellow-400 bg-yellow-50" : "border-gray-200"}`}
                  />
                </div>
              ) : (
                <span className="text-gray-700">***</span>
              )}
            </td>
            <td className="px-2 py-2">
              <select
                disabled={isSaving}
                value={edits[row.id]?.customer_opinion !== undefined ? edits[row.id]!.customer_opinion! : (row.customer_opinion || "pending")}
                onChange={(e) => setEditValue(row.id, "customer_opinion", e.target.value)}
                className={`px-2 py-1 text-xs rounded border hover:border-blue-400 focus:border-blue-500 focus:outline-none disabled:opacity-50 ${改了("customer_opinion") ? "border-yellow-400 bg-yellow-50" : "border-gray-200"}`}
              >
                <option value="pending">未确定</option>
                <option value="agree">同意</option>
                <option value="reject">否决</option>
              </select>
            </td>
          </>
        )}
        <td className="px-2 py-2">
          <button
            type="button"
            disabled={isSaving}
            title="供应商（必填）"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setSupplierDropdownPos({ top: rect.bottom + 4, left: rect.left });
              setOpenSupplierRowId(openSupplierRowId === row.id ? null : row.id);
            }}
            className={`w-28 px-2 py-1 text-xs rounded border text-left truncate hover:border-blue-400 focus:border-blue-500 focus:outline-none disabled:opacity-50 ${
              改了("supplier_name")
                ? "border-yellow-400 bg-yellow-50"
                : !supplierValue
                  ? "border-red-400 bg-red-50 text-red-600"
                  : "border-gray-200"
            } ${supplierValue ? "text-gray-900" : ""}`}
          >
            {supplierValue || "必选"}
          </button>
          {openSupplierRowId === row.id && (
            <div
              ref={supplierDropdownRef}
              className="fixed z-50 w-56 bg-white border border-gray-200 rounded shadow-lg max-h-48 overflow-y-auto"
              style={{ top: supplierDropdownPos.top, left: supplierDropdownPos.left }}
            >
              <div
                className="px-2 py-1.5 text-xs hover:bg-gray-50 cursor-pointer text-gray-400"
                onClick={() => {
                  setEditValue(row.id, "supplier", "");
                  setOpenSupplierRowId(null);
                }}
              >
                请选择
              </div>
              {getSortedSuppliers(row).map((s) => {
                const reasons = getSupplierMatchReasons(row, s);
                return (
                  <div
                    key={s.id}
                    className={`px-2 py-1.5 text-xs hover:bg-blue-50 cursor-pointer border-t border-gray-50 ${supplierValue === s.name ? "bg-blue-50 text-blue-700" : ""}`}
                    onClick={() => {
                      setEditValue(row.id, "supplier", s.name);
                      setOpenSupplierRowId(null);
                    }}
                  >
                    <div className="font-medium text-gray-900">{s.name}</div>
                    {reasons.length > 0 && (
                      <div className="text-[10px] text-gray-400 mt-0.5">{reasons.join(" · ")}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </td>
        {/* 备注（没填时默认带入配件信息备注；框线加深 + 明确提示文字） */}
        <td className="px-2 py-2">
          <input
            type="text"
            disabled={isSaving}
            value={notesValue}
            onChange={(e) => setEditValue(row.id, "notes", e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, row, "notes")}
            placeholder="备注（选填）"
            className={`w-44 px-2 py-1 text-xs rounded border bg-white placeholder:text-gray-400 hover:border-blue-400 focus:border-blue-500 focus:outline-none disabled:opacity-50 ${改了("notes") ? "border-yellow-400 bg-yellow-50" : "border-gray-300"}`}
          />
        </td>
        {/* 图片：可点开看大图、可添加。工单配件自己的图优先；没有则带入配件信息图片。
           添加去向：已关联库存配件→配件信息图片(part_images)；未关联→工单配件图片(分支媒体) */}
        <td className="px-2 py-2">
          {(() => {
            const media = partMediaMap[row.id] || [];
            const 目录图 = (row.parts?.part_images || []).filter((p) => p.storage_path);
            return (
              <div className="flex flex-wrap items-center gap-1">
                {media.length > 0 && <PartBranchImages images={media} />}
                {media.length === 0 &&
                  目录图.map((p) => (
                    <div key={p.storage_path} className="relative w-10 h-10 rounded border border-gray-100 overflow-hidden">
                      <img
                        src={p.storage_path}
                        alt=""
                        className="w-full h-full object-cover cursor-pointer"
                        loading="lazy"
                        onClick={() => set预览图(p.storage_path)}
                      />
                      {row.parts?.id && (
                        <button
                          type="button"
                          title="删除此图"
                          onClick={() => 删除目录图片(row, p.storage_path)}
                          className="absolute top-0 right-0 w-3.5 h-3.5 bg-red-500 text-white rounded-full text-[8px] flex items-center justify-center"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                <button
                  type="button"
                  title={row.parts?.id ? "添加配件信息图片" : "添加工单配件图片"}
                  disabled={图片上传中 === row.id}
                  onClick={() => 图片输入Refs.current[row.id]?.click()}
                  className="w-10 h-10 rounded border border-dashed border-gray-300 text-gray-400 flex items-center justify-center text-sm hover:border-blue-400 hover:text-blue-500 disabled:opacity-50"
                >
                  {图片上传中 === row.id ? "…" : "+"}
                </button>
                <input
                  ref={(el) => { 图片输入Refs.current[row.id] = el; }}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      if (row.parts?.id) void 上传目录图片(row, f);
                      else void 上传分支图片(row, f);
                    }
                    e.target.value = "";
                  }}
                />
              </div>
            );
          })()}
        </td>
        <td className="px-2 py-2 sticky right-0 bg-white z-10">
          <div className="flex items-center gap-2">
            {wo && (
              <Link href={`/work-orders/${wo.id}`} className="text-xs text-blue-600 hover:text-blue-700">
                工单详情
              </Link>
            )}
            <button
              type="button"
              onClick={() => openEditModal(row)}
              disabled={isSaving}
              className="text-xs text-blue-600 hover:text-blue-700 disabled:opacity-50"
            >
              编辑
            </button>
            <button
              type="button"
              onClick={() => handleAddSiblingBranch(row)}
              disabled={isSaving}
              className="text-xs text-green-600 hover:text-green-700 disabled:opacity-50"
              title="添加同配件分支"
            >
              分支
            </button>
            {!row.is_purchased && !row.is_arrived && (
              <button
                type="button"
                onClick={() => handleDeleteBranch(row)}
                disabled={isSaving}
                className="text-xs text-red-500 hover:text-red-600 disabled:opacity-50"
                title="删除分支"
              >
                删除
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  }

  const { showPrices } = usePriceVisibility();

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="px-6 py-3 border-b border-gray-100 flex items-center justify-between gap-4 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-900">
          {STATUS_TITLES[status]}
          <span className="ml-2 text-xs font-normal text-gray-500">共 {rows.length} 条</span>
        </h3>
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 mr-1">分组:</span>
          {GROUP_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setGroupBy(opt.key)}
              className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                groupBy === opt.key
                  ? "bg-blue-600 border-blue-600 text-white"
                  : "bg-white border-gray-200 text-gray-600 hover:border-blue-400"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="px-6 py-2 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          {selectedIds.size > 0 && (
            <>
              <span className="text-xs text-gray-500">已选 {selectedIds.size} 条</span>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => set批量供应商弹层开((v) => !v)}
                  className="px-3 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700 transition-colors"
                >
                  批量设置供应商...
                </button>
                {批量供应商弹层开 && (
                  <div
                    ref={批量供应商弹层ref}
                    className="absolute left-0 top-full mt-1 z-50 w-64 bg-white border border-gray-200 rounded-lg shadow-lg"
                  >
                    <div className="p-2 border-b border-gray-100">
                      <input
                        type="text"
                        autoFocus
                        value={批量供应商搜索}
                        onChange={(e) => set批量供应商搜索(e.target.value)}
                        placeholder="搜索供应商..."
                        className="w-full px-2 py-1 text-xs rounded border border-gray-200 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {批量供应商列表.length === 0 && (
                        <div className="px-3 py-2 text-xs text-gray-400">无匹配供应商</div>
                      )}
                      {批量供应商列表.map(({ s, 匹配行数 }) => (
                        <div
                          key={s.id}
                          onClick={() => applyBatchSupplier(s.name || "")}
                          className="px-3 py-1.5 text-xs hover:bg-blue-50 cursor-pointer border-t border-gray-50 flex items-center justify-between gap-2"
                        >
                          <span className="font-medium text-gray-900 truncate">{s.name}</span>
                          <span className="shrink-0 text-[10px] text-gray-400">
                            {匹配行数 > 0 && <span className="text-blue-600 mr-1">匹配{匹配行数}行</span>}
                            {s.recommendation_level ? "⭐".repeat(s.recommendation_level) : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="px-3 py-1.5 text-[10px] text-gray-400 border-t border-gray-100">
                      点击供应商即应用到已选 {selectedIds.size} 行（草稿），再点「提交保存」生效
                    </div>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                取消选择
              </button>
              {status === "pending_inquiry" && (
                <button
                  type="button"
                  onClick={() => set询价弹窗开(true)}
                  className="px-3 py-1 text-xs rounded border border-blue-600 text-blue-600 hover:bg-blue-50 transition-colors"
                >
                  生成询价链接
                </button>
              )}
              {缺采购价行数 > 0 && (
                <span className="text-xs text-amber-600">
                  有 {缺采购价行数} 行已选供应商但未填采购价，两者必须同时填写才能提交
                </span>
              )}
            </>
          )}
          {selectedIds.size === 0 && (
            <span className="text-xs text-gray-400">提示: 在表格中修改品牌/规格/价格/供应商后,点击下方「提交保存」统一提交</span>
          )}
        </div>
        {selectedIds.size > 0 && (status === "pending_quote" || status === "pending_confirm") && (
          <button
            type="button"
            onClick={revertSelected}
            disabled={submitting}
            className="px-4 py-1.5 text-xs font-medium rounded-md bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 disabled:opacity-50 transition-colors"
          >
            {submitting ? "撤销中..." : `撤销到${status === "pending_quote" ? "待询价" : "待报价"}`}
          </button>
        )}
        {changedCount > 0 && (
          <button
            type="button"
            onClick={submitAll}
            disabled={submitting}
            className="px-4 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? "保存中..." : `提交保存 (${changedCount} 条)`}
          </button>
        )}
      </div>
      {/* 品牌/规格搜索建议 */}
      <datalist id="brand-suggestions">
        {availableBrands.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
      <datalist id="spec-suggestions">
        {availableSpecs.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {/* 表格区：限高内滚（双向），表头 sticky top-0 冻结——配合页头 StickyPageHeader，
       * 滚动时 页头+标题栏+表头 全固定，只有数据行滚动。
       * max-h = 视口高 - 页头实测高（CSS 变量）- 标题栏/边距预留（11rem），保证主区域不再滚动、标题栏不被遮 */}
      <div className="overflow-auto max-h-[calc(100vh_-_var(--sticky-header-h,13rem)_-_11rem)]">
        <table className="w-full text-xs min-w-[1200px]">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-2 py-2 text-left font-medium text-gray-500 w-10 sticky top-0 bg-gray-50 z-10">
                <input
                  type="checkbox"
                  checked={rows.length > 0 && selectedIds.size === rows.length}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
              </th>
              <th className="px-2 py-2 text-left font-bold text-gray-700 sticky top-0 bg-gray-50 z-10">工单号</th>
              <th className="px-2 py-2 text-left font-bold text-gray-700 sticky top-0 bg-gray-50 z-10">编码</th>
              <th className="px-2 py-2 text-left font-bold text-gray-700 sticky top-0 bg-gray-50 z-10">配件</th>
              <th className="px-2 py-2 text-left font-bold text-gray-700 sticky top-0 bg-gray-50 z-10">品牌</th>
              <th className="px-2 py-2 text-left font-bold text-gray-700 sticky top-0 bg-gray-50 z-10">规格</th>
              <th className="px-2 py-2 text-right font-bold text-gray-700 sticky top-0 bg-gray-50 z-10">数量</th>
              <th className="px-2 py-2 text-right font-bold text-gray-700 sticky top-0 bg-gray-50 z-10">库存</th>
              <th className="px-2 py-2 text-right font-bold text-gray-700 sticky top-0 bg-gray-50 z-10">采购价</th>
              {!隐藏销售价客户意见 && (
                <>
                  <th className="px-2 py-2 text-right font-bold text-gray-700 sticky top-0 bg-gray-50 z-10">销售价</th>
                  <th className="px-2 py-2 text-left font-bold text-gray-700 sticky top-0 bg-gray-50 z-10">客户意见</th>
                </>
              )}
              <th className="px-2 py-2 text-left font-bold text-gray-700 sticky top-0 bg-gray-50 z-10">供应商</th>
              <th className="px-2 py-2 text-left font-bold text-gray-700 sticky top-0 bg-gray-50 z-10">备注</th>
              <th className="px-2 py-2 text-left font-bold text-gray-700 sticky top-0 bg-gray-50 z-10">图片</th>
              <th className="px-2 py-2 text-left font-bold text-gray-700 sticky top-0 right-0 bg-gray-50 z-20">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={totalCols} className="px-6 py-12 text-center text-gray-400">
                  加载中...
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={totalCols} className="px-6 py-12 text-center text-gray-400">
                  暂无{STATUS_TITLES[status]}的配件
                </td>
              </tr>
            )}
            {!loading && groups.map((g, idx) => (
              <Fragment key={`grp-${idx}`}>
                {groupBy !== "none" && (
                  <tr className="bg-gray-200">
                    <td colSpan={totalCols} className="px-3 py-2 text-xs font-semibold text-gray-700">
                      <span className="inline-block px-2 py-0.5 rounded bg-blue-50 text-blue-700 mr-2">
                        {GROUP_OPTIONS.find((o) => o.key === groupBy)?.label.replace("按", "")}
                      </span>
                      {/* 车牌分组时车牌号放大加粗（采购员按车找配件，车牌是主线索） */}
                      {groupBy === "plate" ? (
                        <span className="text-sm font-bold text-gray-900">{g.key}</span>
                      ) : (
                        g.key
                      )}
                      {(() => {
                        const wo = g.rows[0]?.work_order_items?.work_orders;
                        const vin = wo?.vehicles?.vin;
                        const customer = wo?.customers;
                        return (
                          <>
                            {vin && (
                              <span className="ml-6 text-sm text-gray-600 font-normal">
                                VIN:{vin}
                              </span>
                            )}
                            {customer?.name && (
                              <span className="ml-4 text-sm text-gray-600 font-normal">
                                客户:{customer.name}
                              </span>
                            )}
                            {/* 手机号只在待确认页显示（联系客户确认价格用；询价/报价阶段不显示） */}
                            {status === "pending_confirm" && customer?.phone && (
                              <span className="ml-4 text-sm text-gray-600 font-normal">
                                手机:{customer.phone}
                              </span>
                            )}
                          </>
                        );
                      })()}
                      <span className="ml-2 text-gray-400">({g.rows.length} 条)</span>
                    </td>
                  </tr>
                )}
                {(() => {
                  let branchColorIdx = -1;
                  return g.rows.map((r, rIdx) => {
                    const prevName = rIdx > 0 ? g.rows[rIdx - 1].name : null;
                    const isNewBranch = prevName !== null && prevName !== r.name;
                    if (rIdx === 0 || isNewBranch) {
                      branchColorIdx = (branchColorIdx + 1) % BRANCH_BG_COLORS.length;
                    }
                    return renderRow(r, isNewBranch, branchColorIdx);
                  });
                })()}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

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
                editId={editRow.part_id || undefined}
                onSaved={handlePartSaved}
                onCancel={closeEditModal}
                prefillData={{
                  part_number: newPartQuery || editRow.part_number || undefined,
                  name: editRow.name || undefined,
                  unit: editRow.unit || undefined,
                  purchase_price: editRow.unit_cost != null ? String(editRow.unit_cost) : undefined,
                  notes: editRow.notes || undefined,
                }}
              />
            </div>
          </div>
        </div>
      )}
      {/* 图片大图预览（点任意处关闭） */}
      {预览图 && (
        <div
          className="fixed inset-0 z-[130] bg-black/80 flex items-center justify-center p-4"
          onClick={() => set预览图(null)}
        >
          <img src={预览图} alt="" className="max-w-full max-h-full object-contain rounded" />
        </div>
      )}
      {确认弹窗}
      {/* 生成询价链接弹窗：勾选项发给供应商自助报价 */}
      <QuoteSheetModal
        open={询价弹窗开}
        rows={rows
          .filter((r) => selectedIds.has(r.id))
          .map((r) => ({ id: r.id, name: r.name, quantity: r.quantity, unit: r.unit, supplier_name: r.supplier_name }))}
        suppliers={suppliers}
        onClose={() => set询价弹窗开(false)}
      />
    </div>
  );
}

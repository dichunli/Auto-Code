"use client";

import { useEffect, useMemo, useState, useRef, Fragment } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { requestNotificationPermission, sendBrowserNotification } from "@/lib/notification";
import { PartBranchImages } from "./PartBranchImages";

const OPINION_LABELS: Record<string, { text: string; cls: string }> = {
  agree: { text: "同意", cls: "bg-green-50 text-green-700" },
  reject: { text: "否决", cls: "bg-red-50 text-red-600" },
  pending: { text: "未确定", cls: "bg-gray-50 text-gray-600" },
};

const STATUS_TITLES: Record<string, string> = {
  pending_inquiry: "待询价",
  pending_quote: "待报价",
  pending_confirm: "待确认",
};

type EditableField = "part_number" | "brand" | "specification" | "cost" | "price" | "supplier" | "notes" | "customer_opinion";
type GroupBy = "plate" | "category" | "name" | "supplier";

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
  quantity: number;
  unit_cost: number | null;
  unit_price: number | null;
  customer_opinion: string | null;
  supplier_name: string | null;
  is_purchased: boolean | null;
  is_arrived: boolean | null;
  work_order_item_id: string;
  part_name_id: string | null;
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
      customers: { name: string; phone: string | null } | null;
      vehicles: { plate_number: string; vin: string | null } | null;
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
  const supplierButtonRef = useRef<HTMLButtonElement>(null);
  const [supplierDropdownPos, setSupplierDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [partMediaMap, setPartMediaMap] = useState<Record<string, { id: string; storage_path: string }[]>>({});

  /* 批量选择 */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchSupplier, setBatchSupplier] = useState<string>("");
  const [showBatchBar, setShowBatchBar] = useState(false);

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

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      .subscribe((status) => {
        console.log("[Realtime] 订阅状态:", status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          work_order_item_id, part_name_id, part_id, part_number, notes,
          part_names(name, category_id, part_categories(name)),
          parts(
            id, part_number, name, quantity, unit_cost, unit_price,
            part_brands(name),
            part_specifications(name),
            part_images(storage_path)
          ),
          work_order_items(
            name,
            work_orders(
              id, order_no, settled_at, order_type,
              customers(name, phone),
              vehicles(plate_number, vin, vehicle_model_id)
            )
          )
        `)
        .order("created_at", { ascending: false })
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
    const { data: partMediaData } = partIds.length > 0
      ? await supabase.from("work_order_item_part_media").select("id, work_order_item_part_id, storage_path").in("work_order_item_part_id", partIds)
      : { data: [] };
    const mediaMap: Record<string, { id: string; storage_path: string }[]> = {};
    partMediaData?.forEach((m: any) => {
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
      (vmList || []).forEach((v: any) => {
        vmMap.set(String(v.id), { 厂商: v.厂商, 品牌: v.品牌, 车系: v.车系 });
      });
      (svmList || []).forEach((r: any) => {
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
    setAvailableBrands((brandList || []).map((b: any) => b.name).filter(Boolean));
    setAvailableSpecs([...new Set((specList || []).map((s: any) => s.name).filter(Boolean))]);

    /* 品牌名 -> ID 映射 */
    setPartBrandsMap(new Map((brandList || []).map((b: any) => [b.name, String(b.id)])));

    /* 供应商关联数据 */
    const spnMap = new Map<string, Set<string>>();
    (spn || []).forEach((r: any) => {
      const set = spnMap.get(r.supplier_id) || new Set();
      set.add(String(r.part_name_id));
      spnMap.set(r.supplier_id, set);
    });
    setSupplierPartNameIds(spnMap);

    const spcMap = new Map<string, Set<string>>();
    (spc || []).forEach((r: any) => {
      const set = spcMap.get(r.supplier_id) || new Set();
      set.add(String(r.part_category_id));
      spcMap.set(r.supplier_id, set);
    });
    setSupplierCategoryIds(spcMap);

    const spbMap = new Map<string, Set<string>>();
    (spb || []).forEach((r: any) => {
      const set = spbMap.get(r.supplier_id) || new Set();
      set.add(String(r.part_brand_id));
      spbMap.set(r.supplier_id, set);
    });
    setSupplierBrandIds(spbMap);

    setLoading(false);
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
      } else if (_field === "cost" || _field === "price") {
        if (trimmed === "") continue;
        const num = Number(trimmed);
        if (!Number.isFinite(num) || num < 0) continue;
        const dbField = _field === "cost" ? "unit_cost" : "unit_price";
        const original = _field === "cost" ? Number(row.unit_cost || 0) : Number(row.unit_price || 0);
        if (num !== original) update[dbField] = num;
      }
    }

    return Object.keys(update).length > 0 ? update : null;
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

    const matched = (data || []) as any[];
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
    if (!confirm(`确定将选中的 ${selectedIds.size} 条配件撤销到「${prevStatus}」状态吗？`)) return;

    setSubmitting(true);
    let updateData: Record<string, any> = {};
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
    const rowIds = Object.keys(edits);
    if (rowIds.length === 0) return;

    /* 待询价状态下必须填写供应商 */
    if (status === "pending_inquiry") {
      const missingSupplier = rowIds.some((id) => {
        const row = rows.find((r) => r.id === id);
        if (!row) return false;
        const supplier = edits[id]?.supplier !== undefined ? edits[id].supplier : row.supplier_name;
        return !supplier || supplier.trim() === "";
      });
      if (missingSupplier) {
        alert("待报价单据必须填写供应商，请先补全后再提交");
        return;
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

  const changedCount = Object.keys(edits).length;

  /* 在当前配件上添加同项目分支 */
  async function handleAddSiblingBranch(row: PartBranchRow) {
    if (!confirm("确定添加该配件的新分支吗？")) return;
    setSavingId(row.id);
    const { error } = await supabase.from("work_order_item_parts").insert({
      work_order_item_id: row.work_order_item_id,
      part_name_id: row.part_name_id,
      name: row.name,
      quantity: row.quantity,
      unit: row.unit,
      customer_opinion: "pending",
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
    if (!confirm("确定删除该配件分支吗？")) return;
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

  function applyBatchSupplier() {
    if (!batchSupplier) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of next) {
        setEditValue(id, "supplier", batchSupplier);
      }
      return next;
    });
    setBatchSupplier("");
  }

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
      .map(([key, rs]) => ({ key, rows: rs }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, groupBy]);

  const totalCols = 15;

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
    const wo = row.work_order_items?.work_orders!;
    const opinion = OPINION_LABELS[row.customer_opinion || "pending"];
    const isSaving = savingId === row.id;
    const partNumberDraft = edits[row.id]?.part_number;
    const brandDraft = edits[row.id]?.brand;
    const specDraft = edits[row.id]?.specification;
    const costDraft = edits[row.id]?.cost;
    const priceDraft = edits[row.id]?.price;
    const supplierDraft = edits[row.id]?.supplier;
    const notesDraft = edits[row.id]?.notes;

    const partNumberValue = partNumberDraft !== undefined ? partNumberDraft : (row.part_number || "");
    const brandValue = brandDraft !== undefined ? brandDraft : (row.brand || "");
    const specValue = specDraft !== undefined ? specDraft : (row.specification || "");
    const costValue = costDraft !== undefined ? costDraft : (row.unit_cost != null && row.unit_cost > 0 ? String(row.unit_cost) : "");
    const priceValue = priceDraft !== undefined ? priceDraft : (row.unit_price != null && row.unit_price > 0 ? String(row.unit_price) : "");
    const supplierValue = supplierDraft !== undefined ? supplierDraft : (row.supplier_name || "");
    const notesValue = notesDraft !== undefined ? notesDraft : (row.notes || "");

    const firstImage = row.parts?.part_images?.[0]?.storage_path;

    const hasDraft = !!edits[row.id] && Object.keys(edits[row.id]!).length > 0;
    const branchBg = hasDraft ? "" : BRANCH_BG_COLORS[branchColorIndex % BRANCH_BG_COLORS.length];

    return (
      <tr key={row.id} className={`hover:bg-gray-50 ${hasDraft ? "bg-yellow-50/40" : branchBg} ${isNewBranch ? "border-t-2 border-gray-200" : ""}`}>
        <td className="px-3 py-3">
          <input
            type="checkbox"
            checked={selectedIds.has(row.id)}
            onChange={() => toggleSelect(row.id)}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
        </td>
        <td className="px-3 py-3">
          <Link href={`/work-orders/${wo.id}`} className="text-blue-600 hover:text-blue-700 font-medium">
            {wo.order_no}
          </Link>
        </td>
        {/* 编码 */}
        <td className="px-3 py-3">
          <input
            type="text"
            disabled={isSaving}
            value={partNumberValue}
            onChange={(e) => setEditValue(row.id, "part_number", e.target.value.toUpperCase())}
            onKeyDown={(e) => handleKeyDown(e, row, "part_number")}
            placeholder="编码/条码"
            className={`w-24 px-2 py-1 text-xs rounded border hover:border-blue-400 focus:border-blue-500 focus:outline-none disabled:opacity-50 ${hasDraft && partNumberDraft !== undefined ? "border-yellow-400 bg-yellow-50" : "border-gray-200"}`}
          />
        </td>
        <td className="px-3 py-3 text-gray-900">{row.name}</td>
        <td className="px-3 py-3">
          <input
            type="text"
            disabled={isSaving}
            value={brandValue}
            onChange={(e) => setEditValue(row.id, "brand", e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, row, "brand")}
            placeholder="-"
            list="brand-suggestions"
            className={`w-24 px-2 py-1 text-xs rounded border hover:border-blue-400 focus:border-blue-500 focus:outline-none disabled:opacity-50 ${hasDraft && brandDraft !== undefined ? "border-yellow-400 bg-yellow-50" : "border-gray-200"}`}
          />
        </td>
        <td className="px-3 py-3">
          <input
            type="text"
            disabled={isSaving}
            value={specValue}
            onChange={(e) => setEditValue(row.id, "specification", e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, row, "specification")}
            placeholder="-"
            list="spec-suggestions"
            className={`w-24 px-2 py-1 text-xs rounded border hover:border-blue-400 focus:border-blue-500 focus:outline-none disabled:opacity-50 ${hasDraft && specDraft !== undefined ? "border-yellow-400 bg-yellow-50" : "border-gray-200"}`}
          />
        </td>
        <td className={`px-3 py-3 text-right ${row.quantity <= 0 ? "bg-red-50 text-red-600 font-semibold" : "text-gray-700"}`}>
          {row.quantity} {row.unit || "件"}
        </td>
        {/* 库存 */}
        <td className="px-3 py-3 text-right text-gray-700">
          {row.parts ? (
            <span className={row.parts.quantity <= 0 ? "text-red-600 font-semibold" : ""}>{row.parts.quantity}</span>
          ) : (
            <span className="text-gray-300">-</span>
          )}
        </td>
        <td className="px-3 py-3 text-right">
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
              placeholder="-"
              className={`w-20 px-2 py-1 text-right text-xs rounded border hover:border-blue-400 focus:border-blue-500 focus:outline-none disabled:opacity-50 ${hasDraft && costDraft !== undefined ? "border-yellow-400 bg-yellow-50" : "border-gray-200"}`}
            />
          </div>
        </td>
        <td className="px-3 py-3 text-right">
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
              className={`w-20 px-2 py-1 text-right text-xs rounded border hover:border-blue-400 focus:border-blue-500 focus:outline-none disabled:opacity-50 ${hasDraft && priceDraft !== undefined ? "border-yellow-400 bg-yellow-50" : "border-gray-200"}`}
            />
          </div>
        </td>
        <td className="px-3 py-3">
          <select
            disabled={isSaving}
            value={edits[row.id]?.customer_opinion !== undefined ? edits[row.id]!.customer_opinion! : (row.customer_opinion || "pending")}
            onChange={(e) => setEditValue(row.id, "customer_opinion", e.target.value)}
            className={`px-2 py-1 text-xs rounded border hover:border-blue-400 focus:border-blue-500 focus:outline-none disabled:opacity-50 ${hasDraft && edits[row.id]?.customer_opinion !== undefined ? "border-yellow-400 bg-yellow-50" : "border-gray-200"}`}
          >
            <option value="pending">未确定</option>
            <option value="agree">同意</option>
            <option value="reject">否决</option>
          </select>
        </td>
        <td className="px-3 py-3">
          <button
            type="button"
            disabled={isSaving}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setSupplierDropdownPos({ top: rect.bottom + 4, left: rect.left });
              setOpenSupplierRowId(openSupplierRowId === row.id ? null : row.id);
            }}
            className={`w-28 px-2 py-1 text-xs rounded border text-left truncate hover:border-blue-400 focus:border-blue-500 focus:outline-none disabled:opacity-50 ${hasDraft && supplierDraft !== undefined ? "border-yellow-400 bg-yellow-50" : "border-gray-200"} ${supplierValue ? "text-gray-900" : "text-gray-400"}`}
          >
            {supplierValue || "请选择"}
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
        {/* 备注 */}
        <td className="px-3 py-3">
          <input
            type="text"
            disabled={isSaving}
            value={notesValue}
            onChange={(e) => setEditValue(row.id, "notes", e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, row, "notes")}
            placeholder="-"
            className={`w-28 px-2 py-1 text-xs rounded border hover:border-blue-400 focus:border-blue-500 focus:outline-none disabled:opacity-50 ${hasDraft && notesDraft !== undefined ? "border-yellow-400 bg-yellow-50" : "border-gray-200"}`}
          />
        </td>
        {/* 图片 */}
        <td className="px-3 py-3">
          {(() => {
            const media = partMediaMap[row.id] || [];
            const allImages = media.length > 0
              ? media
              : firstImage
                ? [{ id: `fallback-${row.id}`, storage_path: firstImage }]
                : [];
            return allImages.length > 0
              ? <PartBranchImages images={allImages} />
              : <span className="text-xs text-gray-300">-</span>;
          })()}
        </td>
        <td className="px-3 py-3 sticky right-0 bg-white z-10">
          <div className="flex items-center gap-2">
            <Link href={`/work-orders/${wo.id}`} className="text-xs text-blue-600 hover:text-blue-700">
              处理
            </Link>
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
              <select
                value={batchSupplier}
                onChange={(e) => setBatchSupplier(e.target.value)}
                className="text-xs px-2 py-1 border border-gray-200 rounded focus:border-blue-500 focus:outline-none"
              >
                <option value="">选择供应商批量设置...</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={applyBatchSupplier}
                disabled={!batchSupplier}
                className="px-3 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                批量应用
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                取消选择
              </button>
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
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[1200px]">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-3 text-left font-medium text-gray-500 w-10">
                <input
                  type="checkbox"
                  checked={rows.length > 0 && selectedIds.size === rows.length}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
              </th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">工单号</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">编码</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">配件</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">品牌</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">规格</th>
              <th className="px-3 py-3 text-right font-medium text-gray-500">数量</th>
              <th className="px-3 py-3 text-right font-medium text-gray-500">库存</th>
              <th className="px-3 py-3 text-right font-medium text-gray-500">采购价</th>
              <th className="px-3 py-3 text-right font-medium text-gray-500">销售价</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">客户意见</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">供应商</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">备注</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">图片</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500 sticky right-0 bg-gray-50 z-10">操作</th>
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
                      {g.key}
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
                            {customer?.phone && (
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
                    const prevItemId = rIdx > 0 ? g.rows[rIdx - 1].work_order_item_id : null;
                    const isNewBranch = prevItemId !== null && prevItemId !== r.work_order_item_id;
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
    </div>
  );
}

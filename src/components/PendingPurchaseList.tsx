"use client";

import { useEffect, useMemo, useState, Fragment } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { filterLogisticsByRegion, supplierNeedsLogistics, REGION_LABELS } from "@/lib/logisticsFilter";
import { PriceValue } from "@/components/PriceVisibilityContext";

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
  notes: string | null;
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
  const router = useRouter();
  const supabase = createClient();
  const [rows, setRows] = useState<PartBranchRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [logisticsCompanies, setLogisticsCompanies] = useState<LogisticsCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [supplierMap, setSupplierMap] = useState<Record<string, string>>({});
  const [logisticsMap, setLogisticsMap] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>("supplier");
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
  const [stockQtyMap, setStockQtyMap] = useState<Record<string, number>>({});
  const [stockLoading, setStockLoading] = useState(false);

  /* 撤销弹窗 */
  const [showRevokeModal, setShowRevokeModal] = useState(false);
  const [revokeOpinion, setRevokeOpinion] = useState<"reject" | "pending">("pending");
  const [revokeReason, setRevokeReason] = useState("");
  const [revokeCustomReason, setRevokeCustomReason] = useState("");

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
    const [{ data: parts }, { data: sups }, { data: logistics }] = await Promise.all([
      supabase
        .from("work_order_item_parts")
        .select(`
          id, name, brand, specification, unit, quantity, unit_cost, unit_price,
          customer_opinion, supplier_name, part_id, part_number, part_name_id,
          alias_name, notes, work_order_item_id,
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
    ]);

    const filtered = ((parts || []) as unknown as PartBranchRow[]).filter((r) => {
      const wo = r.work_order_items?.work_orders;
      if (!wo) return false;
      if (wo.settled_at) return false;
      if (wo.order_type === "cancelled") return false;
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

    setRows(filtered);
    setSuppliers(sups || []);
    setLogisticsCompanies(logistics || []);
    setLoading(false);
  }

  function getRowSupplierId(row: PartBranchRow): string | null {
    if (supplierMap[row.id]) return supplierMap[row.id];
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

  /* 按 groupBy 分组 */
  const groups = useMemo(() => {
    const map = new Map<string, PartBranchRow[]>();
    for (const r of rows) {
      const k = getGroupKey(r, groupBy);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, "zh"))
      .map(([key, rs]) => ({ key, rows: rs }));
  }, [rows, groupBy]);

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

  function toggleSelectAll() {
    if (selected.size === rows.length) {
      setSelected(new Set());
      return;
    }
    const firstWithSupplier = rows.find((r) => getRowSupplierId(r));
    if (!firstWithSupplier) {
      alert("请至少为一条记录选择供应商后才能全选");
      return;
    }
    const baseSupplier = getRowSupplierId(firstWithSupplier);
    const sameSupplierIds = rows
      .filter((r) => getRowSupplierId(r) === baseSupplier)
      .map((r) => r.id);
    setSelected(new Set(sameSupplierIds));
  }

  function setRowSupplier(rowId: string, supplierId: string) {
    setSupplierMap((prev) => ({ ...prev, [rowId]: supplierId }));
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

    const available = filterLogisticsByRegion(logisticsCompanies, region);
    setFilteredLogistics(available);
    setModalRegion(region);
    setSelectedLogisticsId("");
    setShowLogisticsModal(true);
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

    if (!confirm(`将为 ${selectedRows.length} 条配件生成采购单,是否继续?`)) {
      return;
    }

    setSubmitting(true);
    try {
      const sid = getRowSupplierId(selectedRows[0]);
      if (!sid) throw new Error("无法获取供应商ID");
      const totalAmount = selectedRows.reduce(
        (sum, it) => sum + Number(it.unit_cost || 0) * Number(it.quantity || 0),
        0
      );
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const randomStr = Math.floor(1000 + Math.random() * 9000);
      const orderNo = `CG-${dateStr}-${randomStr}`;

      const { data: order, error: orderErr } = await supabase
        .from("purchase_orders")
        .insert({
          order_no: orderNo,
          supplier_id: sid,
          status: "submitted",
          total_amount: totalAmount,
          logistics_company_id: finalLogisticsId,
          notes: `由「待采购」批量生成${logisticsName ? ` | 物流: ${logisticsName}` : ""}`,
        })
        .select("id")
        .single();

      if (orderErr || !order) throw orderErr || new Error("创建采购单失败");

      /* 批量查询图片和分类 */
      const workOrderItemIds = selectedRows.map((r) => r.work_order_item_id).filter((x): x is string => !!x);
      const partNameIds = selectedRows.map((r) => r.part_name_id).filter((x): x is string => !!x);
      const [{ data: mediaData }, { data: pnData }] = await Promise.all([
        workOrderItemIds.length > 0
          ? supabase.from("work_order_item_media").select("work_order_item_id, storage_path").in("work_order_item_id", workOrderItemIds).eq("media_type", "image")
          : Promise.resolve({ data: [] as any[] }),
        partNameIds.length > 0
          ? supabase.from("part_names").select("id, part_categories(name)").in("id", partNameIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const mediaMap: Record<string, string[]> = {};
      for (const m of mediaData || []) {
        if (!mediaMap[m.work_order_item_id]) mediaMap[m.work_order_item_id] = [];
        mediaMap[m.work_order_item_id].push(m.storage_path);
      }
      const categoryMap: Record<string, string> = {};
      for (const p of pnData || []) {
        categoryMap[p.id] = p.part_categories?.name || "";
      }

      const itemInserts = selectedRows.map((it) => ({
        order_id: order.id,
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
      }));

      const { error: itemErr } = await supabase.from("purchase_order_items").insert(itemInserts);
      if (itemErr) throw itemErr;

      const branchIds = selectedRows.map((it) => it.id);
      const { error: updErr } = await supabase
        .from("work_order_item_parts")
        .update({ is_purchased: true, supplier_name: suppliers.find((s) => s.id === sid)?.name || null })
        .in("id", branchIds);
      if (updErr) throw updErr;

      alert("已生成 1 张采购单(已提交),请到「待收货」或「采购订单」中查看。");
      setShowLogisticsModal(false);
      setSelected(new Set());
      loadData();
    } catch (err: any) {
      alert("发起采购失败: " + (err.message || String(err)));
    } finally {
      setSubmitting(false);
    }
  }

  async function loadLowStockParts() {
    setStockLoading(true);
    const { data } = await supabase
      .from("parts")
      .select("id, part_number, name, part_brands(name), part_specifications(name), unit, quantity, min_stock, unit_cost, supplier_id, suppliers(name)")
      .order("name");

    const list: LowStockPart[] = (data || [])
      .filter((p: any) => (p.quantity || 0) < (p.min_stock || 0))
      .map((p: any) => ({
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
      }));

    setLowStockParts(list);
    setStockSelected(new Set());
    setStockQtyMap({});
    setStockLoading(false);
  }

  function openStockModal() {
    loadLowStockParts();
    setShowStockModal(true);
  }

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
          setStockQtyMap((q) => ({ ...q, [id]: suggestQty }));
        }
      }
      return next;
    });
  }

  function setStockQty(id: string, qty: number) {
    setStockQtyMap((prev) => ({ ...prev, [id]: Math.max(1, qty) }));
  }

  async function handleCreateStockPurchases() {
    if (stockSelected.size === 0) {
      alert("请先选择要采购的配件");
      return;
    }
    const selectedParts = lowStockParts.filter((p) => stockSelected.has(p.id));
    const missingQty = selectedParts.find((p) => !stockQtyMap[p.id] || stockQtyMap[p.id] <= 0);
    if (missingQty) {
      alert(`请为 ${missingQty.name} 填写采购数量`);
      return;
    }

    const groups: Record<string, LowStockPart[]> = {};
    selectedParts.forEach((p) => {
      const sid = p.supplier_id;
      if (!sid) return;
      if (!groups[sid]) groups[sid] = [];
      groups[sid].push(p);
    });

    const noSupplierParts = selectedParts.filter((p) => !p.supplier_id);
    if (noSupplierParts.length > 0) {
      alert(`以下配件未设置供应商，无法创建采购单：${noSupplierParts.map((p) => p.name).join("、")}`);
      return;
    }

    if (!confirm(`将为 ${selectedParts.length} 条安全库存配件按供应商分组生成采购单,是否继续?`)) {
      return;
    }

    setSubmitting(true);
    try {
      const supplierIds = Object.keys(groups);
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      let createdCount = 0;

      for (let idx = 0; idx < supplierIds.length; idx++) {
        const sid = supplierIds[idx];
        const items = groups[sid];
        const totalAmount = items.reduce(
          (sum, it) => sum + Number(it.unit_cost || 0) * (stockQtyMap[it.id] || 1),
          0
        );
        const randomStr = Math.floor(1000 + Math.random() * 9000);
        const orderNo = `CG-${dateStr}-${randomStr}`;

        const { data: order, error: orderErr } = await supabase
          .from("purchase_orders")
          .insert({
            order_no: orderNo,
            supplier_id: sid,
            status: "draft",
            total_amount: totalAmount,
            notes: "由「安全库存补货」批量生成",
          })
          .select("id")
          .single();

        if (orderErr || !order) throw orderErr || new Error("创建采购单失败");

        const itemInserts = items.map((it) => ({
          order_id: order.id,
          part_id: it.id,
          part_number: it.part_number,
          name: it.name,
          brand: it.brand,
          specification: it.specification,
          quantity: stockQtyMap[it.id] || 1,
          unit_cost: it.unit_cost,
        }));

        const { error: itemErr } = await supabase.from("purchase_order_items").insert(itemInserts);
        if (itemErr) throw itemErr;

        createdCount++;
      }

      alert(`已生成 ${createdCount} 张采购单(草稿状态),请到「采购订单」中审批并发出。`);
      setShowStockModal(false);
    } catch (err: any) {
      alert("发起采购失败: " + (err.message || String(err)));
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
    if (!confirm(`确认撤销 ${selectedRows.length} 条配件?\n客户意见将变更为「${revokeOpinion === "reject" ? "否决" : "未确定"}」`)) {
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
    } catch (err: any) {
      alert("撤销失败: " + (err.message || String(err)));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="text-center text-gray-400 py-12">加载中...</div>;
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-gray-900">
            待采购
            <span className="ml-2 text-xs font-normal text-gray-500">共 {rows.length} 条</span>
          </h3>
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
              <th className="px-3 py-3 text-left font-medium text-gray-500 w-10">
                <input
                  type="checkbox"
                  checked={rows.length > 0 && selected.size === rows.length}
                  onChange={toggleSelectAll}
                  className="rounded"
                />
              </th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">工单号</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">客户/车牌</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">项目</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">配件</th>
              <th className="px-3 py-3 text-right font-medium text-gray-500">数量</th>
              <th className="px-3 py-3 text-right font-medium text-gray-500">采购价</th>
              <th className="px-3 py-3 text-right font-medium text-gray-500">销售价</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">供应商 *</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">物流公司</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {groups.map((g, gIdx) => (
              <Fragment key={`grp-${gIdx}`}>
                <tr className="bg-gray-200">
                  <td colSpan={10} className="px-3 py-2 text-xs font-semibold text-gray-700">
                    <span className="inline-block px-2 py-0.5 rounded bg-blue-50 text-blue-700 mr-2">
                      {GROUP_OPTIONS.find((o) => o.key === groupBy)?.label.replace("按", "")}
                    </span>
                    {g.key}
                    <span className="ml-2 text-gray-400">({g.rows.length} 条)</span>
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
                    const wo = r.work_order_items?.work_orders!;
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
                          <Link href={`/work-orders/${wo.id}`} className="text-blue-600 hover:text-blue-700 font-medium">
                            {wo.order_no}
                          </Link>
                        </td>
                        <td className="px-3 py-3 text-gray-700">
                          <div>{wo.customers?.name || "-"}</div>
                          <div className="text-xs text-gray-500">{wo.vehicles?.plate_number || "-"}</div>
                        </td>
                        <td className="px-3 py-3 text-gray-700">{r.work_order_items?.name || "-"}</td>
                        <td className="px-3 py-3">
                          <div className="text-base font-medium text-gray-900">{r.name}</div>
                          <div className="text-sm text-gray-400">{r.brand || ""} {r.specification || ""}</div>
                          {notArrivedMarks[r.id] && (
                            <span className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded border ${
                              notArrivedMarks[r.id] === "欠发货已入库"
                                ? "bg-blue-50 text-blue-600 border-blue-100"
                                : "bg-orange-50 text-orange-600 border-orange-100"
                            }`}>
                              {notArrivedMarks[r.id] === "欠发货已入库" ? "欠发货已入库" : "漏发"}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right text-gray-700">
                          {r.quantity} {r.unit || "件"}
                        </td>
                        <td className="px-3 py-3 text-right text-gray-700">
                          <PriceValue value={r.unit_cost} />
                        </td>
                        <td className="px-3 py-3 text-right text-gray-700">
                          <PriceValue value={r.unit_price} />
                        </td>
                        <td className="px-3 py-3">
                          <select
                            value={supplierMap[r.id] || ""}
                            onChange={(e) => setRowSupplier(r.id, e.target.value)}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                          >
                            <option value="">{r.supplier_name || "请选择"}</option>
                            {suppliers.map((s) => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-3">
                          {(() => {
                            const region = getRowSupplierRegion(r);
                            if (region === "local") {
                              return <span className="text-gray-400 text-xs">-</span>;
                            }
                            const available = filterLogisticsByRegion(logisticsCompanies, region);
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
                      </tr>
                    );
                  });
                })()}
              </Fragment>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-6 py-12 text-center text-gray-400">
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
          <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-3xl max-h-[80vh] flex flex-col">
            <h3 className="text-base font-semibold text-gray-900 mb-4">添加安全库存配件</h3>
            <p className="text-xs text-gray-400 mb-3">以下配件库存低于安全线，勾选后可直接生成采购单</p>
            <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg mb-4">
              {stockLoading ? (
                <div className="text-center text-gray-400 py-8">加载中...</div>
              ) : lowStockParts.length === 0 ? (
                <div className="text-center text-gray-400 py-8">暂无库存不足的配件</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-500 w-10">
                        <input
                          type="checkbox"
                          checked={lowStockParts.length > 0 && stockSelected.size === lowStockParts.length}
                          onChange={() => {
                            if (stockSelected.size === lowStockParts.length) {
                              setStockSelected(new Set());
                              setStockQtyMap({});
                            } else {
                              setStockSelected(new Set(lowStockParts.map((p) => p.id)));
                              const map: Record<string, number> = {};
                              lowStockParts.forEach((p) => { map[p.id] = Math.max(p.min_stock - p.quantity, 1); });
                              setStockQtyMap(map);
                            }
                          }}
                          className="rounded"
                        />
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">配件</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">当前库存</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">安全线</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">采购价</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">供应商</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">采购数量</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {lowStockParts.map((p) => (
                      <tr key={p.id} className={stockSelected.has(p.id) ? "bg-blue-50" : "hover:bg-gray-50"}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={stockSelected.has(p.id)}
                            onChange={() => toggleStockSelect(p.id)}
                            className="rounded"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-base font-medium text-gray-900">{p.name}</div>
                          <div className="text-sm text-gray-400">{p.part_number || ""} {p.brand || ""} {p.specification || ""}</div>
                        </td>
                        <td className="px-3 py-2 text-right text-red-600 font-medium">{p.quantity}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{p.min_stock}</td>
                        <td className="px-3 py-2 text-right text-gray-700"><PriceValue value={p.unit_cost} /></td>
                        <td className="px-3 py-2 text-gray-700">{p.supplier_name || "-"}</td>
                        <td className="px-3 py-2 text-right">
                          {stockSelected.has(p.id) && (
                            <input
                              type="number"
                              min={1}
                              value={stockQtyMap[p.id] || ""}
                              onChange={(e) => setStockQty(p.id, parseInt(e.target.value) || 1)}
                              className="w-16 px-2 py-1 text-xs text-right border border-gray-300 rounded"
                            />
                          )}
                        </td>
                      </tr>
                    ))}
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
                disabled={stockSelected.size === 0 || submitting}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? "生成中..." : `生成采购单 (${stockSelected.size})`}
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
    </div>
  );
}

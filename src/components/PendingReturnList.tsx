"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { PartSearchDropdown } from "@/components/PartSearchDropdown";
import { useConfirm } from "./ConfirmDialog";
import PartForm from "@/app/parts/new/PartForm";
import { RETURN_REASON_LABELS } from "@/lib/purchaseFlowLabels";
import { usePartLinking } from "./usePartLinking";
import { 批量撤销退货, 生成采退单 } from "@/app/procurement/actions";
import { DocumentNameInput } from "./DocumentNameInput";
import { EditReturnPhotosModal } from "./EditReturnPhotosModal";
import { ImageUploader } from "./ImageUploader";
import { toast } from "@/lib/globalToast";

/* 退货原因中文化：保持原变量名，引用处零改动 */
const returnReasonMap = RETURN_REASON_LABELS;

/* 配件展示取值（2026-09-16 已入库退货接入）：记录快照列优先，
   工单配件行嵌入兜底（收货异常的老记录没有快照） */
function 取名称(r: ReturnRecord): string {
  return r.part_name || r.work_order_item_parts?.name || "-";
}
function 取编码(r: ReturnRecord): string {
  return r.part_number || r.work_order_item_parts?.part_number || "";
}
function 取品牌(r: ReturnRecord): string {
  return r.brand || r.work_order_item_parts?.brand || "";
}
function 取规格(r: ReturnRecord): string {
  return r.specification || r.work_order_item_parts?.specification || "";
}
function 取单位(r: ReturnRecord): string {
  return r.unit || r.work_order_item_parts?.unit || "";
}

interface WorkOrderItemPart {
  id: string;
  name: string;
  part_number: string | null;
  part_id: string | null;
  brand: string | null;
  specification: string | null;
  unit: string | null;
  unit_cost: number | null;
  notes: string | null;
  supplier_id: string | null;
  document_name: string | null;
}

/* 记录类型导出给采购看板 page.tsx：服务端首屏查询结果作为 props 传入用（待办清单第9项） */
export interface ReturnRecord {
  id: string;
  supplier_name: string | null;
  return_reason: string;
  quantity: number;
  logistics_company: string | null;
  tracking_no: string | null;
  photos: string[] | null;
  /* 外包装照片（2026-09-18：photos 列=货物照片） */
  package_photos: string[] | null;
  status: string;
  created_at: string;
  /* 2026-09-16 已入库退货接入：来源 + 采购明细/供应商关联 + 配件快照列
     （备货采购的货没有工单配件行，展示/建采退单直接用快照） */
  source: string;
  purchase_order_item_id: string | null;
  supplier_id: string | null;
  part_id: string | null;
  part_number: string | null;
  part_name: string | null;
  brand: string | null;
  specification: string | null;
  unit: string | null;
  unit_cost: number | null;
  batch_id: string | null;
  notes: string | null;
  /* 退自仓位（2026-09-18 用户拍板：待退货显示仓位） */
  warehouse_id: string | null;
  location: string | null;
  warehouses: { name: string } | null;
  /* 车牌（2026-09-18 用户拍板：有车牌信息的退货记录要显示，经采购明细快照取） */
  purchase_order_items: { license_plate: string | null } | null;
  work_order_item_parts: WorkOrderItemPart | null;
  profiles: { full_name: string | null } | null;
}

/* 首屏数据 props（服务端查询注入，待办清单第9项）：
   有 initialRecords 时首屏直接渲染、跳过 useEffect 里的 loadData，
   避免 SPA 软导航时 session 未就绪导致整页空白；后续操作照常走 loadData 刷新 */
interface PendingReturnListProps {
  initialRecords?: ReturnRecord[];
}

export function PendingReturnList(props: PendingReturnListProps) {
  const supabase = createClient();
  const { 请求确认, 确认弹窗 } = useConfirm();
  const [records, setRecords] = useState<ReturnRecord[]>(props.initialRecords ?? []);
  const [loading, setLoading] = useState(!props.initialRecords);
  const [submitting, setSubmitting] = useState<string | null>(null);

  /* 供应商过滤 */
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null);

  /* 物流公司档案（2026-09-18 用户拍板：确认退货的物流公司改下拉选择，
     选档案里的名字，自动入物流应付时按名匹配才落得准） */
  const [物流公司列表, set物流公司列表] = useState<string[]>([]);

  /* 批量选择 */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  /* 退货清单弹窗 */
  const [returnListOpen, setReturnListOpen] = useState(false);
  const [returnListItems, setReturnListItems] = useState<ReturnRecord[]>([]);

  /* 修改退货照片弹窗（2026-09-18 用户拍板：待退货可修改退货照片） */
  const [改照片记录, set改照片记录] = useState<ReturnRecord | null>(null);

  /* 采退单确认弹窗 */
  interface ReturnModalGroup {
    supplierName: string;
    supplierId: string | null;
    records: ReturnRecord[];
    logisticsCompany: string;
    trackingNo: string;
    notes: string;
    shippingFeePayer: string;
    shippingFee: string;
    /* 退货照片（2026-09-18 用户拍板）：确认退货时必填；
       货物/外包装初始值 = 各记录在退货时已拍的照片合集，可继续补拍；
       交接照 = 交货给物流公司/供应商时拍，只能这里拍 */
    goodsPhotos: string[];
    packagePhotos: string[];
    handoverPhotos: string[];
    /* 本地交接（2026-09-18 用户拍板）：本地供应商没有物流公司，
       勾选后物流公司/运单号免填（写库时物流公司记"本地交接"），照片仍必填 */
    本地交接: boolean;
  }

  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnModalGroups, setReturnModalGroups] = useState<ReturnModalGroup[]>([]);

  interface PartBrandInfo {
    name: string;
  }

  interface PartInfo {
    part_number: string | null;
    name: string | null;
    unit: string | null;
    brand_id: string | null;
    part_brands: PartBrandInfo | PartBrandInfo[] | null;
    specification_text: string | null;
    purchase_price: number | null;
    notes: string | null;
  }


  const loadData = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("supplier_return_records")
      .select(
        "id, supplier_name, return_reason, quantity, logistics_company, tracking_no, photos, package_photos, status, created_at, source, purchase_order_item_id, supplier_id, part_id, part_number, part_name, brand, specification, unit, unit_cost, batch_id, notes, warehouse_id, location, warehouses(name), purchase_order_items(license_plate), work_order_item_parts(id, name, part_number, part_id, brand, specification, unit, unit_cost, notes, document_name), profiles(full_name)"
      )
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("加载待退货记录失败:", error);
      setLoading(false);
      return;
    }

    setRecords((data || []) as unknown as ReturnRecord[]);
    setLoading(false);
  }, [supabase]);

  /* 物流公司档案下拉选项（独立挂载即拉，不走 loadData——首屏由服务端注入时 loadData 会跳过） */
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("logistics_companies").select("name").order("name");
      set物流公司列表(((data || []) as { name: string }[]).map((c) => c.name));
    })();
  }, [supabase]);

  useEffect(() => {
    /* 服务端已给首屏数据则跳过首次查询，避免重复拉取 */
    if (props.initialRecords) return;
    loadData();

  }, [loadData, props.initialRecords]);

  /* 批量撤销(级联回滚已收编进数据库事务函数 revoke_supplier_returns:
     已入库的整单回滚入库,弃货类加回库存,任一失败整体回滚) */
  async function handleBatchRevoke() {
    if (selectedIds.size === 0) {
      toast("请先选择要撤销的记录", "warning");
      return;
    }
    setSubmitting("batch-revoke");
    try {
      const ids = Array.from(selectedIds);

      /* 2026-09-16 两类来源撤销语义不同，确认文案分开说明：
         - 收货异常(receipt_exception)：整单回滚入库（采购单退回待收货）
         - 已入库退货(inbound_return)：只加回库存+删记录，不碰入库单 */
      const 选中记录 = records.filter((r) => ids.includes(r.id));
      const 已入库退货数 = 选中记录.filter((r) => r.source === "inbound_return").length;
      const 老来源ids = 选中记录.filter((r) => r.source !== "inbound_return").map((r) => r.id);

      /* 查询老来源记录涉及的采购单是否有入库单,用于提示用户(只读) */
      const { data: recordRows } = await supabase
        .from("supplier_return_records")
        .select("work_order_item_part_id")
        .in("id", 老来源ids.length > 0 ? 老来源ids : ["00000000-0000-0000-0000-000000000000"]);
      const partIds = (recordRows || [])
        .map((r: { work_order_item_part_id: string | null }) => r.work_order_item_part_id)
        .filter((x): x is string => !!x);

      let inboundNos = "";
      if (partIds.length > 0) {
        const { data: poiRows } = await supabase
          .from("purchase_order_items")
          .select("order_id")
          .in("work_order_item_part_id", partIds);
        const orderIds = [...new Set((poiRows || []).map((p: { order_id: string }) => p.order_id))];
        if (orderIds.length > 0) {
          const { data: ioRows } = await supabase
            .from("inbound_orders")
            .select("inbound_no")
            .in("purchase_order_id", orderIds)
            /* 2026-09-08 两阶段入库：提示文案只列正式入库单号 */
            .eq("status", "completed");
          inboundNos = [...new Set((ioRows || []).map((o: { inbound_no: string }) => o.inbound_no))].join("、");
        }
      }

      const 文案段: string[] = [];
      if (老来源ids.length > 0) {
        文案段.push(
          inboundNos
            ? `${老来源ids.length} 条收货异常记录关联的入库单 ${inboundNos} 也将被整单撤销`
            : `${老来源ids.length} 条收货异常记录将撤销其收货处理`
        );
      }
      if (已入库退货数 > 0) {
        文案段.push(`${已入库退货数} 条已入库退货撤销后库存将自动加回`);
      }
      if (!(await 请求确认(`确认撤销选中的 ${selectedIds.size} 条退货记录？\n${文案段.join("\n")}`))) {
        setSubmitting(null);
        return;
      }

      const res = await 批量撤销退货(ids);
      if (!res.success) throw new Error(res.error || "批量撤销失败");

      setSelectedIds(new Set());
      loadData();
    } catch (err: unknown) {
      toast("批量撤销失败: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setSubmitting(null);
    }
  }

  /* 单条撤销（2026-09-18 用户拍板：待退货状态可以撤销退货）：
     与批量撤销同一个 RPC（revoke_supplier_returns 一个事务），确认文案按来源区分 */
  async function handleRowRevoke(r: ReturnRecord) {
    const 文案 = r.source === "inbound_return"
      ? "确认撤销这条退货记录？撤销后库存将自动加回。"
      : "确认撤销这条退货记录？撤销将回滚其收货处理（关联入库单可能整单撤销）。";
    if (!(await 请求确认(文案))) return;
    setSubmitting(`revoke-${r.id}`);
    try {
      const res = await 批量撤销退货([r.id]);
      if (!res.success) throw new Error(res.error || "撤销失败");
      loadData();
    } catch (err: unknown) {
      toast("撤销失败: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setSubmitting(null);
    }
  }

  /* 打开采退单确认弹窗（2026-09-18：支持指定记录——行内"确认退货"只带本条；
     不传则用批量勾选的记录）。照片/物流/运费必填校验全在弹窗确认时做，
     不再保留"标记完成"捷径（那条不拍照不填物流，绕过了必填规则） */
  function openReturnModal(指定ids?: string[]) {
    const ids = 指定ids ?? Array.from(selectedIds);
    if (ids.length === 0) {
      toast("请先选择要提交的记录", "warning");
      return;
    }
    const items = records.filter((r) => ids.includes(r.id));
    const map = new Map<string, ReturnRecord[]>();
    for (const r of items) {
      const key = r.supplier_name || "未指定供应商";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    const groups: ReturnModalGroup[] = Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, "zh"))
      .map(([supplierName, list]) => ({
        supplierName,
        /* 供应商 id：记录快照列优先（已入库退货从采购单取的准确值），
           工单配件行兜底（收货异常的老记录） */
        supplierId: list[0]?.supplier_id || list[0]?.work_order_item_parts?.supplier_id || null,
        records: list,
        logisticsCompany: list[0]?.logistics_company || "",
        trackingNo: list[0]?.tracking_no || "",
        notes: "",
        shippingFeePayer: "supplier",
        shippingFee: "",
        /* 照片预填：退货时已拍的照片合集（去重），确认时可继续补拍 */
        goodsPhotos: [...new Set(list.flatMap((r) => r.photos ?? []))],
        packagePhotos: [...new Set(list.flatMap((r) => r.package_photos ?? []))],
        handoverPhotos: [] as string[],
        本地交接: false,
      }));
    setReturnModalGroups(groups);
    setReturnModalOpen(true);
  }

  function closeReturnModal() {
    setReturnModalOpen(false);
    setReturnModalGroups([]);
  }

  /* 确认生成采退单(全部供应商的建单+明细+应收冲减已收编进
     数据库事务函数 create_purchase_return_orders,任一失败整体回滚)
     2026-09-18 用户拍板必填项：货物照片+外包装照片+物流公司必选，我方付必填运费金额 */
  async function handleConfirmReturnOrders() {
    for (const g of returnModalGroups) {
      if (g.goodsPhotos.length === 0) {
        toast(`供应商「${g.supplierName}」还没有货物照片，确认退货前必须拍照上传`, "warning");
        return;
      }
      if (g.packagePhotos.length === 0) {
        toast(`供应商「${g.supplierName}」还没有外包装照片，确认退货前必须拍照上传`, "warning");
        return;
      }
      if (g.handoverPhotos.length === 0) {
        toast(`供应商「${g.supplierName}」还没有交接照片，交货给物流公司/供应商时必须拍照上传`, "warning");
        return;
      }
      if (!g.本地交接 && !g.logisticsCompany.trim()) {
        toast(`供应商「${g.supplierName}」还没选物流公司，物流公司必选（本地供应商请勾选"本地交接"）`, "warning");
        return;
      }
      if (g.shippingFeePayer === "self" && !(parseFloat(g.shippingFee) > 0)) {
        toast(`供应商「${g.supplierName}」退货运费为我方付，必须填写运费金额`, "warning");
        return;
      }
    }
    setSubmitting("batch-complete");
    try {
      const res = await 生成采退单(
        returnModalGroups.map((g) => ({
          supplier_id: g.supplierId || null,
          supplier_name: g.supplierName,
          /* 本地交接（2026-09-18）：无物流公司时写死"本地交接"，列表/详情直接可读 */
          logistics_company: g.本地交接 ? "本地交接" : g.logisticsCompany.trim() || null,
          tracking_no: g.本地交接 ? null : g.trackingNo || null,
          return_shipping_fee: !g.本地交接 && g.shippingFeePayer === "self" ? parseFloat(g.shippingFee) || 0 : 0,
          shipping_fee_payer: g.本地交接 ? null : g.shippingFeePayer || null,
          notes: g.notes || null,
          goods_photos: g.goodsPhotos,
          package_photos: g.packagePhotos,
          handover_photos: g.handoverPhotos,
          records: g.records.map((r) => ({
            record_id: r.id,
            /* 快照列优先（2026-09-16），工单配件行兜底 */
            part_id: r.part_id || r.work_order_item_parts?.part_id || null,
            part_number: r.part_number || r.work_order_item_parts?.part_number || null,
            name: r.part_name || r.work_order_item_parts?.name || null,
            brand: r.brand || r.work_order_item_parts?.brand || null,
            specification: r.specification || r.work_order_item_parts?.specification || null,
            quantity: r.quantity,
            return_reason: r.return_reason,
            unit_cost: r.unit_cost ?? r.work_order_item_parts?.unit_cost ?? null,
          })),
        }))
      );
      if (!res.success) throw new Error(res.error || "生成采退单失败");

      /* 生成退货清单 */
      const items = records.filter((r) => selectedIds.has(r.id));
      setReturnListItems(items);
      setReturnListOpen(true);
      setSelectedIds(new Set());
      closeReturnModal();
      loadData();
    } catch (err: unknown) {
      toast("批量提交失败: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setSubmitting(null);
    }
  }

  /* 行内配件编辑逻辑已抽到 usePartLinking（对照表驱动的共享实现） */
  const 配件联动 = usePartLinking<ReturnRecord>({
    supabase,
    主表: "work_order_item_parts",
    双写WOI: false,
    getRowId: (r) => r.work_order_item_parts?.id || "",
    getWoiId: () => null,
    getWoi当前值: (r) => r.work_order_item_parts,
    写WoiPartId: true,
    行内unitCost来源: "purchase_price",
    行内写售价: false,
    弹窗写supplierPartName: false,
    弹窗写WoiDocumentName: false,
    弹窗规格来源: "specification_text",
    取弹前行: (r) => r.work_order_item_parts || {},
    setSubmitting,
    /* 待退货不在局部更新范围内，保持整表重查 */
    保存后: () => loadData(),
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


  /* 供应商选项 */
  const supplierOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) {
      set.add(r.supplier_name || "未指定供应商");
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh"));
  }, [records]);

  /* 供应商退货数量统计 */
  const supplierCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of records) {
      const name = r.supplier_name || "未指定供应商";
      map.set(name, (map.get(name) || 0) + r.quantity);
    }
    return map;
  }, [records]);

  /* 过滤后的记录 */
  const filteredRecords = useMemo(() => {
    if (!supplierFilter) return records;
    return records.filter((r) => (r.supplier_name || "未指定供应商") === supplierFilter);
  }, [records, supplierFilter]);

  /* 按供应商分组 */
  const displayGroups = useMemo(() => {
    const map = new Map<string, ReturnRecord[]>();
    for (const r of filteredRecords) {
      const key = r.supplier_name || "未指定供应商";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, "zh"))
      .map(([key, list]) => ({ key, list }));
  }, [filteredRecords]);

  /* 退货清单按供应商分组 */
  const returnListGroups = useMemo(() => {
    const map = new Map<string, ReturnRecord[]>();
    for (const r of returnListItems) {
      const key = r.supplier_name || "未指定供应商";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, "zh"))
      .map(([key, list]) => ({ key, list }));
  }, [returnListItems]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
        加载中...
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
        暂无待退货记录
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 批量操作栏 + 供应商过滤 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setSelectedIds(new Set(records.map((r) => r.id)))}
            className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
          >
            全选
          </button>
          <span className="text-xs text-gray-500">
            已选 {selectedIds.size} 条
          </span>
          <button
            type="button"
            onClick={() => openReturnModal()}
            disabled={selectedIds.size === 0 || submitting === "batch-complete"}
            className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            {submitting === "batch-complete" ? "提交中..." : "生成采退单"}
          </button>
          <button
            type="button"
            onClick={handleBatchRevoke}
            disabled={selectedIds.size === 0 || submitting === "batch-revoke"}
            className="px-3 py-1.5 bg-orange-600 text-white text-xs font-medium rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50"
          >
            {submitting === "batch-revoke" ? "撤销中..." : "批量撤销"}
          </button>
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
            >
              取消全选
            </button>
          )}
        </div>
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
      </div>

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
                共 {g.list.length} 条退货记录 · 合计 {g.list.reduce((sum, r) => sum + r.quantity, 0)} 件
              </span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 w-10">
                    <input
                      type="checkbox"
                      checked={g.list.length > 0 && g.list.every((r) => selectedIds.has(r.id))}
                      onChange={(e) => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) {
                            for (const r of g.list) next.add(r.id);
                          } else {
                            for (const r of g.list) next.delete(r.id);
                          }
                          return next;
                        });
                      }}
                      className="rounded"
                    />
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">配件信息</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">单据名称</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">退货原因</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">数量</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">退自仓位</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">物流信息</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">退货照片</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">时间</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {g.list.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(r.id)}
                        onChange={(e) => {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(r.id);
                            else next.delete(r.id);
                            return next;
                          });
                        }}
                        className="rounded"
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="space-y-1">
                        {/* 行内配件编辑只对有工单配件行的老来源记录开放；
                            已入库退货（含备货件）直接写死在快照列，无可编辑对象 */}
                        {r.work_order_item_parts && (
                          <PartSearchDropdown
                            value={r.work_order_item_parts?.part_number || ""}
                            onChange={() => {}}
                            onSelect={(part) => handleInlinePartSelect(r, part)}
                            onCreateNew={(query) => openCreateNewModal(r, query)}
                            onClear={() => handleInlineClear(r)}
                            disabled={submitting === `inline-${r.id}`}
                            placeholder="编码"
                            inputClassName="w-24 border-gray-200 text-xs"
                          />
                        )}
                        <div className="font-medium text-gray-900">{取名称(r)}</div>
                        {(取品牌(r) || 取规格(r) || 取单位(r)) && (
                          <div className="text-xs text-gray-400">
                            {取品牌(r)} {取规格(r)} {取单位(r) ? `(${取单位(r)})` : ""}
                          </div>
                        )}
                        {/* 车牌（2026-09-18 用户拍板）：有车牌信息的退货记录要显示 */}
                        {r.purchase_order_items?.license_plate && (
                          <div className="text-xs text-blue-600">车牌 {r.purchase_order_items.license_plate}</div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-700 whitespace-nowrap">
                      {r.work_order_item_parts && (
                        <DocumentNameInput 工单配件行id={r.work_order_item_parts.id} 初始值={r.work_order_item_parts.document_name || ""} 保存后={loadData} />
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {returnReasonMap[r.return_reason] || r.return_reason}
                      {/* 已入库退货来源标识 + 备注（2026-09-16） */}
                      {r.source === "inbound_return" && (
                        <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-orange-50 text-orange-600">已入库退货</span>
                      )}
                      {r.notes && <div className="text-xs text-gray-400 mt-0.5">{r.notes}</div>}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{r.quantity}</td>
                    {/* 退自仓位（2026-09-18 用户拍板）：仓库名 · 仓位 */}
                    <td className="px-6 py-4 text-gray-500 text-xs">
                      {r.warehouses?.name ? (
                        <div>
                          <div>{r.warehouses.name}</div>
                          {r.location && <div className="text-gray-400">{r.location}</div>}
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-500 text-xs">
                      {r.logistics_company && r.tracking_no ? (
                        <div>
                          <div>{r.logistics_company}</div>
                          <div className="text-gray-400">{r.tracking_no}</div>
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {/* 照片分两类（2026-09-18）：photos=货物照，package_photos=外包装照 */}
                      {(r.photos && r.photos.length > 0) || (r.package_photos && r.package_photos.length > 0) ? (
                        <div className="space-y-1">
                          {r.photos && r.photos.length > 0 && (
                            <div className="flex gap-1 items-center">
                              <span className="text-[10px] text-gray-400">货物</span>
                              {r.photos.slice(0, 3).map((url, i) => (
                                <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                                  <img src={url} alt="" loading="lazy" className="w-8 h-8 object-cover rounded border border-gray-200 hover:opacity-80" />
                                </a>
                              ))}
                              {r.photos.length > 3 && (
                                <span className="text-xs text-gray-400 self-center">+{r.photos.length - 3}</span>
                              )}
                            </div>
                          )}
                          {r.package_photos && r.package_photos.length > 0 && (
                            <div className="flex gap-1 items-center">
                              <span className="text-[10px] text-gray-400">包装</span>
                              {r.package_photos.slice(0, 3).map((url, i) => (
                                <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                                  <img src={url} alt="" loading="lazy" className="w-8 h-8 object-cover rounded border border-gray-200 hover:opacity-80" />
                                </a>
                              ))}
                              {r.package_photos.length > 3 && (
                                <span className="text-xs text-gray-400 self-center">+{r.package_photos.length - 3}</span>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-500 text-xs">
                      {new Date(r.created_at).toLocaleString("zh-CN")}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {r.work_order_item_parts && (
                          <button
                            type="button"
                            onClick={() => openEditModal(r)}
                            disabled={submitting === `edit-${r.id}`}
                            className="text-xs text-gray-500 hover:text-blue-600 whitespace-nowrap"
                          >
                            编辑
                          </button>
                        )}
                        {/* 确认退货（2026-09-18）：打开采退单确认弹窗（只带本条），
                            拍照/物流/运费必填校验与批量一致；不再提供免拍照的"标记完成"捷径 */}
                        <button
                          onClick={() => openReturnModal([r.id])}
                          className="text-xs text-green-600 hover:text-green-800 hover:underline"
                        >
                          确认退货
                        </button>
                        {/* 修改照片（2026-09-18）：待退货状态可改退货照片/备注 */}
                        <button
                          onClick={() => set改照片记录(r)}
                          className="text-xs text-gray-500 hover:text-blue-600 hover:underline"
                        >
                          改照片
                        </button>
                        {/* 单条撤销（2026-09-18）：待退货状态可撤销，撤销语义与批量撤销一致 */}
                        <button
                          onClick={() => handleRowRevoke(r)}
                          disabled={submitting === `revoke-${r.id}`}
                          className="text-xs text-orange-600 hover:text-orange-800 hover:underline disabled:opacity-50"
                        >
                          {submitting === `revoke-${r.id}` ? "处理中..." : "撤销"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* 采退单确认弹窗 */}
      {returnModalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-4xl my-8 relative">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <h3 className="text-base font-semibold text-gray-900">采退单确认</h3>
              <button
                type="button"
                onClick={closeReturnModal}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-6">
              {returnModalGroups.map((g, gIdx) => (
                <div key={g.supplierName} className="border border-gray-100 rounded-lg">
                  <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                    <h4 className="text-sm font-semibold text-gray-900">
                      供应商: {g.supplierName}（{g.records.length} 项）
                    </h4>
                  </div>
                  <div className="p-4 space-y-3">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium text-gray-500 w-10">序号</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500">配件名称</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500">零件编码</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500">品牌/规格</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500">退货原因</th>
                            <th className="px-3 py-2 text-right font-medium text-gray-500">数量</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {g.records.map((r, idx) => (
                            <tr key={r.id} className="hover:bg-gray-50">
                              <td className="px-3 py-2 text-gray-500">{idx + 1}</td>
                              <td className="px-3 py-2 text-gray-900 font-medium">
                                {取名称(r)}
                                {/* 车牌（2026-09-18）：有车牌的退货件显示，便于核对工单归属 */}
                                {r.purchase_order_items?.license_plate && (
                                  <span className="ml-1 text-xs text-blue-600">车牌 {r.purchase_order_items.license_plate}</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-gray-600">
                                {取编码(r) || "-"}
                              </td>
                              <td className="px-3 py-2 text-gray-600">
                                {取品牌(r)} {取规格(r)}
                              </td>
                              <td className="px-3 py-2 text-gray-600">
                                {returnReasonMap[r.return_reason] || r.return_reason}
                              </td>
                              <td className="px-3 py-2 text-right text-gray-900">{r.quantity}</td>
                            </tr>
                          ))}
                          <tr className="bg-gray-50">
                            <td colSpan={5} className="px-3 py-2 text-right font-medium text-gray-700">
                              小计
                            </td>
                            <td className="px-3 py-2 text-right font-medium text-gray-900">
                              {g.records.reduce((sum, r) => sum + r.quantity, 0)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">
                          物流公司 {!g.本地交接 && <span className="text-red-500">*</span>}
                        </label>
                        {/* 物流公司改下拉选择（2026-09-18 用户拍板）：选项来自物流公司档案，
                            与"自动入物流应付"按名匹配的口径一致；红框=未选 */}
                        <select
                          value={g.logisticsCompany}
                          disabled={g.本地交接}
                          onChange={(e) => {
                            setReturnModalGroups((prev) =>
                              prev.map((p, i) => (i === gIdx ? { ...p, logisticsCompany: e.target.value } : p))
                            );
                          }}
                          className={`w-full px-2 py-1 text-xs rounded border bg-white focus:outline-none focus:border-blue-400 disabled:bg-gray-50 disabled:text-gray-400 ${
                            !g.本地交接 && !g.logisticsCompany.trim()
                              ? "border-red-400 bg-red-50"
                              : "border-gray-200"
                          }`}
                        >
                          <option value="">{g.本地交接 ? "本地交接无需物流" : "请选择物流公司（必选）"}</option>
                          {物流公司列表.map((name) => (
                            <option key={name} value={name}>{name}</option>
                          ))}
                        </select>
                        {/* 本地交接（2026-09-18）：本地供应商无物流公司时勾选，物流/运单号免填，照片仍必填 */}
                        <label className="mt-1 flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={g.本地交接}
                            onChange={(e) => {
                              setReturnModalGroups((prev) =>
                                prev.map((p, i) => (i === gIdx ? { ...p, 本地交接: e.target.checked } : p))
                              );
                            }}
                            className="rounded"
                          />
                          本地交接（无物流公司）
                        </label>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">运单号</label>
                        <input
                          type="text"
                          value={g.trackingNo}
                          disabled={g.本地交接}
                          onChange={(e) => {
                            setReturnModalGroups((prev) =>
                              prev.map((p, i) => (i === gIdx ? { ...p, trackingNo: e.target.value } : p))
                            );
                          }}
                          placeholder={g.本地交接 ? "本地交接无运单号" : "运单号"}
                          className="w-full px-2 py-1 text-xs rounded border border-gray-200 focus:outline-none focus:border-blue-400 disabled:bg-gray-50 disabled:text-gray-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">备注</label>
                        <input
                          type="text"
                          value={g.notes}
                          onChange={(e) => {
                            setReturnModalGroups((prev) =>
                              prev.map((p, i) => (i === gIdx ? { ...p, notes: e.target.value } : p))
                            );
                          }}
                          placeholder="备注"
                          className="w-full px-2 py-1 text-xs rounded border border-gray-200 focus:outline-none focus:border-blue-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">退货运费承担方</label>
                        {/* 单选按钮（2026-09-18 用户拍板）：供应商/我方，选我方才弹运费金额；
                            本地交接没有物流运费概念，整组禁用 */}
                        <div className="flex items-center gap-4 py-1">
                          <label className={`flex items-center gap-1 text-xs ${g.本地交接 ? "text-gray-400" : "text-gray-700 cursor-pointer"}`}>
                            <input
                              type="radio"
                              name={`payer-${gIdx}`}
                              disabled={g.本地交接}
                              checked={g.shippingFeePayer === "supplier"}
                              onChange={() => {
                                setReturnModalGroups((prev) =>
                                  prev.map((p, i) => (i === gIdx ? { ...p, shippingFeePayer: "supplier", shippingFee: "" } : p))
                                );
                              }}
                              className="accent-green-600"
                            />
                            供应商承担
                          </label>
                          <label className={`flex items-center gap-1 text-xs ${g.本地交接 ? "text-gray-400" : "text-gray-700 cursor-pointer"}`}>
                            <input
                              type="radio"
                              name={`payer-${gIdx}`}
                              disabled={g.本地交接}
                              checked={g.shippingFeePayer === "self"}
                              onChange={() => {
                                setReturnModalGroups((prev) =>
                                  prev.map((p, i) => (i === gIdx ? { ...p, shippingFeePayer: "self" } : p))
                                );
                              }}
                              className="accent-orange-600"
                            />
                            我方承担
                          </label>
                        </div>
                        {g.本地交接 && (
                          <div className="text-[10px] text-gray-400">本地交接无运费</div>
                        )}
                      </div>
                      {g.shippingFeePayer === "self" && !g.本地交接 && (
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">
                            退货运费金额(¥) <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={g.shippingFee}
                            onChange={(e) => {
                              setReturnModalGroups((prev) =>
                                prev.map((p, i) => (i === gIdx ? { ...p, shippingFee: e.target.value } : p))
                              );
                            }}
                            placeholder="必填，计入物流应付"
                            className={`w-full px-2 py-1 text-xs text-right rounded border focus:outline-none focus:border-blue-400 ${
                              !(parseFloat(g.shippingFee) > 0) ? "border-red-400 bg-red-50" : "border-gray-200"
                            }`}
                          />
                        </div>
                      )}
                    </div>
                    {/* 退货照片（2026-09-18 用户拍板）：确认退货时三类照片均必填；
                        货物/外包装已带入退货时拍的照片，可继续补拍；
                        交接照=交货给物流公司/供应商时拍（本地无物流也必填） */}
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        {/* 标签统一两行高（2026-09-18：交接照的说明文字多一行，
                            导致三个上传框错位，固定 min-h 对齐） */}
                        <label className="block text-xs text-gray-500 mb-1 min-h-8">
                          货物照片 <span className="text-red-500">*</span>
                        </label>
                        <div className={`rounded-lg ${g.goodsPhotos.length === 0 ? "ring-2 ring-red-400" : ""}`}>
                          <ImageUploader
                            onUpload={(paths) => {
                              setReturnModalGroups((prev) =>
                                prev.map((p, i) => (i === gIdx ? { ...p, goodsPhotos: paths } : p))
                              );
                            }}
                            existingImages={g.goodsPhotos}
                            maxImages={9}
                            folder="return-goods"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1 min-h-8">
                          外包装照片 <span className="text-red-500">*</span>
                        </label>
                        <div className={`rounded-lg ${g.packagePhotos.length === 0 ? "ring-2 ring-red-400" : ""}`}>
                          <ImageUploader
                            onUpload={(paths) => {
                              setReturnModalGroups((prev) =>
                                prev.map((p, i) => (i === gIdx ? { ...p, packagePhotos: paths } : p))
                              );
                            }}
                            existingImages={g.packagePhotos}
                            maxImages={9}
                            folder="return-package"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1 min-h-8">
                          交接照片 <span className="text-red-500">*</span>
                          <span className="block font-normal text-gray-400">交货给物流/供应商时拍</span>
                        </label>
                        <div className={`rounded-lg ${g.handoverPhotos.length === 0 ? "ring-2 ring-red-400" : ""}`}>
                          <ImageUploader
                            onUpload={(paths) => {
                              setReturnModalGroups((prev) =>
                                prev.map((p, i) => (i === gIdx ? { ...p, handoverPhotos: paths } : p))
                              );
                            }}
                            existingImages={g.handoverPhotos}
                            maxImages={9}
                            folder="return-handover"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeReturnModal}
                  className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleConfirmReturnOrders}
                  disabled={submitting === "batch-complete"}
                  className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  {submitting === "batch-complete" ? "处理中..." : "确认退货"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 退货清单弹窗 */}
      {returnListOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-4xl my-8 relative">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <h3 className="text-base font-semibold text-gray-900">退货清单</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-1.5 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  打印
                </button>
                <button
                  type="button"
                  onClick={() => setReturnListOpen(false)}
                  className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="p-6 space-y-6">
              <div className="text-center">
                <h2 className="text-xl font-bold text-gray-900">供应商退货清单</h2>
                <p className="text-sm text-gray-500 mt-1">
                  日期: {new Date().toLocaleDateString("zh-CN")}
                </p>
              </div>
              {returnListGroups.map((g) => (
                <div key={g.key}>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center border-l-4 border-blue-500 pl-2">
                    <span className="inline-block px-2 py-0.5 rounded bg-blue-600 text-white mr-2 text-[10px] font-bold">供应商</span>
                    <span className="font-bold text-gray-900">{g.key}</span>
                    <span className="ml-2 text-gray-400 font-normal">（{g.list.length} 项）</span>
                  </h4>
                  <table className="w-full text-sm border border-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-500 border-b">序号</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500 border-b">配件名称</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500 border-b">零件编码</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500 border-b">品牌/规格</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500 border-b">退货原因</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-500 border-b">数量</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.list.map((r, idx) => (
                        <tr key={r.id} className="border-b border-gray-100">
                          <td className="px-3 py-2 text-gray-600">{idx + 1}</td>
                          <td className="px-3 py-2 text-gray-900">{取名称(r)}</td>
                          <td className="px-3 py-2 text-gray-600">{取编码(r) || "-"}</td>
                          <td className="px-3 py-2 text-gray-600">
                            {取品牌(r)} {取规格(r)}
                          </td>
                          <td className="px-3 py-2 text-gray-600">
                            {returnReasonMap[r.return_reason] || r.return_reason}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-900">{r.quantity}</td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50">
                        <td colSpan={5} className="px-3 py-2 text-right font-medium text-gray-700">
                          小计
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-gray-900">
                          {g.list.reduce((sum, r) => sum + r.quantity, 0)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ))}
              <div className="text-right font-bold text-gray-900 pt-2 border-t">
                合计数量: {returnListItems.reduce((sum, r) => sum + r.quantity, 0)}
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
                {editItem.work_order_item_parts?.part_id ? "编辑配件信息" : "新增配件信息"}
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

      {/* 修改退货照片弹窗（2026-09-18） */}
      {改照片记录 && (
        <EditReturnPhotosModal
          记录id={改照片记录.id}
          配件名={取名称(改照片记录)}
          初始货物照片={改照片记录.photos ?? []}
          初始外包装照片={改照片记录.package_photos ?? []}
          初始备注={改照片记录.notes ?? ""}
          onClose={() => set改照片记录(null)}
          on保存后={loadData}
        />
      )}

      {确认弹窗}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PartSearchDropdown } from "@/components/PartSearchDropdown";
import { useConfirm } from "./ConfirmDialog";
import PartForm from "@/app/parts/new/PartForm";
import { RETURN_REASON_LABELS } from "@/lib/purchaseFlowLabels";
import { usePartLinking } from "./usePartLinking";
import { 完成退货记录, 批量撤销退货, 生成采退单 } from "@/app/procurement/actions";

/* 退货原因中文化：保持原变量名，引用处零改动 */
const returnReasonMap = RETURN_REASON_LABELS;

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

interface ReturnRecord {
  id: string;
  supplier_name: string | null;
  return_reason: string;
  quantity: number;
  logistics_company: string | null;
  tracking_no: string | null;
  photos: string[] | null;
  status: string;
  created_at: string;
  work_order_item_parts: WorkOrderItemPart | null;
  profiles: { full_name: string | null } | null;
}

export function PendingReturnList() {
  const supabase = createClient();
  const { 请求确认, 确认弹窗 } = useConfirm();
  const [records, setRecords] = useState<ReturnRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);

  /* 供应商过滤 */
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null);

  /* 批量选择 */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  /* 退货清单弹窗 */
  const [returnListOpen, setReturnListOpen] = useState(false);
  const [returnListItems, setReturnListItems] = useState<ReturnRecord[]>([]);

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


  async function loadData() {
    setLoading(true);
    const { data, error } = await supabase
      .from("supplier_return_records")
      .select(
        "id, supplier_name, return_reason, quantity, logistics_company, tracking_no, photos, status, created_at, work_order_item_parts(id, name, part_number, part_id, brand, specification, unit, unit_cost, notes, document_name), profiles(full_name)"
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
  }

  useEffect(() => {
    loadData();
     
  }, []);

  async function handleComplete(id: string) {
    if (!(await 请求确认("确认标记为已完成？"))) return;
    const res = await 完成退货记录(id);
    if (!res.success) {
      alert("更新失败: " + (res.error || "未知错误"));
      return;
    }
    loadData();
  }

  /* 批量撤销(级联回滚已收编进数据库事务函数 revoke_supplier_returns:
     已入库的整单回滚入库,弃货类加回库存,任一失败整体回滚) */
  async function handleBatchRevoke() {
    if (selectedIds.size === 0) {
      alert("请先选择要撤销的记录");
      return;
    }
    setSubmitting("batch-revoke");
    try {
      const ids = Array.from(selectedIds);

      /* 查询涉及的采购单是否有入库单,用于提示用户(只读) */
      const { data: recordRows } = await supabase
        .from("supplier_return_records")
        .select("work_order_item_part_id")
        .in("id", ids);
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
            .in("purchase_order_id", orderIds);
          inboundNos = [...new Set((ioRows || []).map((o: { inbound_no: string }) => o.inbound_no))].join("、");
        }
      }

      const msg = inboundNos
        ? `这些退货记录关联的入库单 ${inboundNos} 也将被撤销，是否继续？`
        : `确认撤销选中的 ${selectedIds.size} 条退货记录？`;
      if (!(await 请求确认(msg))) {
        setSubmitting(null);
        return;
      }

      const res = await 批量撤销退货(ids);
      if (!res.success) throw new Error(res.error || "批量撤销失败");

      setSelectedIds(new Set());
      loadData();
    } catch (err: unknown) {
      alert("批量撤销失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSubmitting(null);
    }
  }

  /* 打开采退单确认弹窗 */
  function openReturnModal() {
    if (selectedIds.size === 0) {
      alert("请先选择要提交的记录");
      return;
    }
    const items = records.filter((r) => selectedIds.has(r.id));
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
        supplierId: list[0]?.work_order_item_parts?.supplier_id || null,
        records: list,
        logisticsCompany: list[0]?.logistics_company || "",
        trackingNo: list[0]?.tracking_no || "",
        notes: "",
        shippingFeePayer: "supplier",
        shippingFee: "",
      }));
    setReturnModalGroups(groups);
    setReturnModalOpen(true);
  }

  function closeReturnModal() {
    setReturnModalOpen(false);
    setReturnModalGroups([]);
  }

  /* 确认生成采退单(全部供应商的建单+明细+应收冲减已收编进
     数据库事务函数 create_purchase_return_orders,任一失败整体回滚) */
  async function handleConfirmReturnOrders() {
    setSubmitting("batch-complete");
    try {
      const res = await 生成采退单(
        returnModalGroups.map((g) => ({
          supplier_id: g.supplierId || null,
          supplier_name: g.supplierName,
          logistics_company: g.logisticsCompany || null,
          tracking_no: g.trackingNo || null,
          return_shipping_fee: g.shippingFeePayer === "self" ? parseFloat(g.shippingFee) || 0 : 0,
          shipping_fee_payer: g.shippingFeePayer || null,
          notes: g.notes || null,
          records: g.records.map((r) => ({
            record_id: r.id,
            part_id: r.work_order_item_parts?.part_id || null,
            part_number: r.work_order_item_parts?.part_number || null,
            name: r.work_order_item_parts?.name || null,
            brand: r.work_order_item_parts?.brand || null,
            specification: r.work_order_item_parts?.specification || null,
            quantity: r.quantity,
            return_reason: r.return_reason,
            unit_cost: r.work_order_item_parts?.unit_cost || null,
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
      alert("批量提交失败: " + (err instanceof Error ? err.message : String(err)));
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
            onClick={openReturnModal}
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
        <div key={g.key} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">供应商: {g.key}</h3>
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
                    <td className="px-6 py-4">
                      <div className="space-y-1">
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
                        <div className="font-medium text-gray-900">{r.work_order_item_parts?.name || "-"}</div>
                        {(r.work_order_item_parts?.brand || r.work_order_item_parts?.specification || r.work_order_item_parts?.unit) && (
                          <div className="text-xs text-gray-400">
                            {r.work_order_item_parts?.brand || ""} {r.work_order_item_parts?.specification || ""} {r.work_order_item_parts?.unit ? `(${r.work_order_item_parts.unit})` : ""}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-700">{r.work_order_item_parts?.document_name || "-"}</td>
                    <td className="px-6 py-4 text-gray-600">{returnReasonMap[r.return_reason] || r.return_reason}</td>
                    <td className="px-6 py-4 text-gray-600">{r.quantity}</td>
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
                      {r.photos && r.photos.length > 0 ? (
                        <div className="flex gap-1">
                          {r.photos.slice(0, 3).map((url, i) => (
                            <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                              <img src={url} alt="" loading="lazy" className="w-8 h-8 object-cover rounded border border-gray-200 hover:opacity-80" />
                            </a>
                          ))}
                          {r.photos.length > 3 && (
                            <span className="text-xs text-gray-400 self-center">+{r.photos.length - 3}</span>
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
                        <button
                          type="button"
                          onClick={() => openEditModal(r)}
                          disabled={submitting === `edit-${r.id}`}
                          className="text-xs text-gray-500 hover:text-blue-600 whitespace-nowrap"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleComplete(r.id)}
                          className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          标记完成
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
                                {r.work_order_item_parts?.name || "-"}
                              </td>
                              <td className="px-3 py-2 text-gray-600">
                                {r.work_order_item_parts?.part_number || "-"}
                              </td>
                              <td className="px-3 py-2 text-gray-600">
                                {r.work_order_item_parts?.brand || ""} {r.work_order_item_parts?.specification || ""}
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
                        <label className="block text-xs text-gray-500 mb-1">物流公司</label>
                        <input
                          type="text"
                          value={g.logisticsCompany}
                          onChange={(e) => {
                            setReturnModalGroups((prev) =>
                              prev.map((p, i) => (i === gIdx ? { ...p, logisticsCompany: e.target.value } : p))
                            );
                          }}
                          placeholder="物流公司"
                          className="w-full px-2 py-1 text-xs rounded border border-gray-200 focus:outline-none focus:border-blue-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">运单号</label>
                        <input
                          type="text"
                          value={g.trackingNo}
                          onChange={(e) => {
                            setReturnModalGroups((prev) =>
                              prev.map((p, i) => (i === gIdx ? { ...p, trackingNo: e.target.value } : p))
                            );
                          }}
                          placeholder="运单号"
                          className="w-full px-2 py-1 text-xs rounded border border-gray-200 focus:outline-none focus:border-blue-400"
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
                        <select
                          value={g.shippingFeePayer}
                          onChange={(e) => {
                            setReturnModalGroups((prev) =>
                              prev.map((p, i) => (i === gIdx ? { ...p, shippingFeePayer: e.target.value } : p))
                            );
                          }}
                          className="w-full px-2 py-1 text-xs rounded border border-gray-200 focus:outline-none focus:border-blue-400"
                        >
                          <option value="supplier">供应商承担</option>
                          <option value="self">我方承担</option>
                        </select>
                      </div>
                      {g.shippingFeePayer === "self" && (
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">退货运费金额(¥)</label>
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
                            placeholder="0.00"
                            className="w-full px-2 py-1 text-xs text-right rounded border border-gray-200 focus:outline-none focus:border-blue-400"
                          />
                        </div>
                      )}
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
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">
                    供应商: {g.key}（{g.list.length} 项）
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
                          <td className="px-3 py-2 text-gray-900">{r.work_order_item_parts?.name || "-"}</td>
                          <td className="px-3 py-2 text-gray-600">{r.work_order_item_parts?.part_number || "-"}</td>
                          <td className="px-3 py-2 text-gray-600">
                            {r.work_order_item_parts?.brand || ""} {r.work_order_item_parts?.specification || ""}
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

      {确认弹窗}
    </div>
  );
}

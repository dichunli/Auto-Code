"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export interface LinkedItem {
  id: string;
  name: string;
  manufacturer?: string;
  brand?: string;
  series?: string;
  model_name?: string;
  sales_version?: string;
  year_start?: number;
  year_end?: number;
  displacement?: string;
  engine?: string;
  fuel_type?: string;
  intake_form?: string;
  transmission_type?: string;
  transmission_code?: string;
  chassis_code?: string;
  drive_type?: string;
  body_type?: string;
  emission_standard?: string;
  front_tire?: string;
  rear_tire?: string;
  notes?: string;
  fitment_position?: string;
  source?: string;
}

interface VehicleModelSelectorProps {
  value: LinkedItem[];
  onChange: (value: LinkedItem[]) => void;
}

const VM_MODAL_PAGE_SIZE = 50;
const VM_MODAL_COLUMNS: { key: string; label: string; type: "int" | "text"; minWidth: number }[] = [
  { key: "id", label: "ID", type: "int", minWidth: 45 },
  { key: "品牌", label: "品牌", type: "text", minWidth: 50 },
  { key: "车系", label: "车系", type: "text", minWidth: 55 },
  { key: "车型", label: "车型", type: "text", minWidth: 140 },
  { key: "年款", label: "年款", type: "int", minWidth: 50 },
  { key: "发动机型号", label: "发动机", type: "text", minWidth: 85 },
  { key: "底盘代号", label: "底盘号", type: "text", minWidth: 75 },
  { key: "变速箱类型", label: "变速箱", type: "text", minWidth: 80 },
  { key: "变速箱代号", label: "变速箱号", type: "text", minWidth: 80 },
  { key: "前轮胎规格", label: "前轮胎", type: "text", minWidth: 80 },
  { key: "后轮胎规格", label: "后轮胎", type: "text", minWidth: 80 },
  { key: "排量", label: "排量", type: "text", minWidth: 50 },
  { key: "燃油类型", label: "燃油", type: "text", minWidth: 55 },
  { key: "销售版本", label: "版本", type: "text", minWidth: 80 },
  { key: "进气形式", label: "进气", type: "text", minWidth: 60 },
  { key: "驱动方式", label: "驱动", type: "text", minWidth: 60 },
  { key: "车身类型", label: "车身", type: "text", minWidth: 70 },
  { key: "排放标准", label: "排放", type: "text", minWidth: 65 },
  { key: "厂商", label: "厂商", type: "text", minWidth: 60 },
];

export default function VehicleModelSelector({ value, onChange }: VehicleModelSelectorProps) {
  const supabase = createClient();

  const [vmModalOpen, setVmModalOpen] = useState(false);
  const [vmModalMode, setVmModalMode] = useState<"add" | "edit" | "delete">("add");
  const [vmModalFilterInputs, setVmModalFilterInputs] = useState<Record<string, string>>({});
  const [vmModalFilters, setVmModalFilters] = useState<Record<string, string>>({});
  const [vmModalList, setVmModalList] = useState<any[]>([]);
  const [vmModalLoading, setVmModalLoading] = useState(false);
  const [vmModalSelectAllLoading, setVmModalSelectAllLoading] = useState(false);
  const [vmModalSelected, setVmModalSelected] = useState<Map<string, any>>(new Map());
  const [vmModalPage, setVmModalPage] = useState(1);
  const [vmModalTotal, setVmModalTotal] = useState(0);

  // 弹窗数据查询
  useEffect(() => {
    if (!vmModalOpen) return;
    let cancelled = false;
    setVmModalLoading(true);
    (async () => {
      const selectedIds = value.map((v) => v.id);
      let query = supabase
        .from("vehicle_models")
        .select(
          "id, 厂商, 品牌, 车系, 车型, 销售版本, 年款, 排量, 发动机型号, 燃油类型, 进气形式, 变速箱类型, 变速箱代号, 底盘代号, 驱动方式, 车身类型, 排放标准, 前轮胎规格, 后轮胎规格",
          { count: "exact" }
        )
        .order("id", { ascending: true });
      Object.entries(vmModalFilters).forEach(([col, val]) => {
        const trimmed = val.trim();
        if (!trimmed) return;
        const colDef = VM_MODAL_COLUMNS.find((c) => c.key === col);
        if (colDef?.type === "int") {
          const num = parseInt(trimmed, 10);
          if (!isNaN(num)) query = query.eq(col, num);
        } else {
          query = query.ilike(col, `%${trimmed}%`);
        }
      });
      const numericIds = selectedIds.map((id) => Number(id)).filter((n) => !isNaN(n));
      if (vmModalMode === "add" && numericIds.length > 0) {
        query = query.not("id", "in", `(${numericIds.join(",")})`);
      } else if ((vmModalMode === "edit" || vmModalMode === "delete") && numericIds.length > 0) {
        query = query.in("id", numericIds);
      } else if ((vmModalMode === "edit" || vmModalMode === "delete") && numericIds.length === 0) {
        setVmModalList([]);
        setVmModalTotal(0);
        setVmModalLoading(false);
        return;
      }
      const from = (vmModalPage - 1) * VM_MODAL_PAGE_SIZE;
      const to = from + VM_MODAL_PAGE_SIZE - 1;
      const { data, count } = await query.range(from, to);
      if (cancelled) return;
      const mapped = (data || []).map((v: any) => ({
        id: String(v.id),
        manufacturer: v.厂商 || "",
        brand: v.品牌 || "",
        series: v.车系 || "",
        model_name: v.车型 || "",
        sales_version: v.销售版本 || "",
        year_start: v.年款,
        year_end: v.年款,
        displacement: v.排量 || "",
        engine: v.发动机型号 || "",
        fuel_type: v.燃油类型 || "",
        intake_form: v.进气形式 || "",
        transmission_type: v.变速箱类型 || "",
        transmission_code: v.变速箱代号 || "",
        chassis_code: v.底盘代号 || "",
        drive_type: v.驱动方式 || "",
        body_type: v.车身类型 || "",
        emission_standard: v.排放标准 || "",
        front_tire: v.前轮胎规格 || "",
        rear_tire: v.后轮胎规格 || "",
      }));
      setVmModalList(mapped);
      setVmModalTotal(count || 0);
      setVmModalLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [vmModalOpen, vmModalMode, vmModalFilters, vmModalPage, value, supabase]);

  // 筛选条件变化时重置到第一页
  useEffect(() => {
    setVmModalPage(1);
  }, [vmModalFilters]);

  function openVmModal(mode: "add" | "edit" | "delete" = "add") {
    setVmModalMode(mode);
    setVmModalOpen(true);
    setVmModalFilterInputs({});
    setVmModalFilters({});
    if (mode === "edit") {
      const preselected = new Map<string, any>();
      value.forEach((v) => {
        preselected.set(v.id, v);
      });
      setVmModalSelected(preselected);
    } else {
      setVmModalSelected(new Map());
    }
    setVmModalSelectAllLoading(false);
    setVmModalPage(1);
  }

  function toggleVmModalSelection(v: any) {
    setVmModalSelected((prev) => {
      const next = new Map(prev);
      if (next.has(v.id)) next.delete(v.id);
      else next.set(v.id, v);
      return next;
    });
  }

  async function selectAllMatchingVmModels() {
    setVmModalSelectAllLoading(true);
    const numericIds = value.map((v) => Number(v.id)).filter((n) => !isNaN(n));
    let query = supabase
      .from("vehicle_models")
      .select(
        "id, 厂商, 品牌, 车系, 车型, 销售版本, 年款, 排量, 发动机型号, 燃油类型, 进气形式, 变速箱类型, 变速箱代号, 底盘代号, 驱动方式, 车身类型, 排放标准"
      )
      .order("id", { ascending: true });
    Object.entries(vmModalFilters).forEach(([col, val]) => {
      const trimmed = val.trim();
      if (!trimmed) return;
      const colDef = VM_MODAL_COLUMNS.find((c) => c.key === col);
      if (colDef?.type === "int") {
        const num = parseInt(trimmed, 10);
        if (!isNaN(num)) query = query.eq(col, num);
      } else {
        query = query.ilike(col, `%${trimmed}%`);
      }
    });
    if (vmModalMode === "add" && numericIds.length > 0) {
      query = query.not("id", "in", `(${numericIds.join(",")})`);
    } else if ((vmModalMode === "edit" || vmModalMode === "delete") && numericIds.length > 0) {
      query = query.in("id", numericIds);
    } else if ((vmModalMode === "edit" || vmModalMode === "delete") && numericIds.length === 0) {
      setVmModalSelectAllLoading(false);
      return;
    }
    query = query.limit(500);
    const { data } = await query;
    setVmModalSelectAllLoading(false);
    if (!data) return;
    const mapped = data.map((v: any) => ({
      id: String(v.id),
      manufacturer: v.厂商 || "",
      brand: v.品牌 || "",
      series: v.车系 || "",
      model_name: v.车型 || "",
      sales_version: v.销售版本 || "",
      year_start: v.年款,
      year_end: v.年款,
      displacement: v.排量 || "",
      engine: v.发动机型号 || "",
      fuel_type: v.燃油类型 || "",
      intake_form: v.进气形式 || "",
      transmission_type: v.变速箱类型 || "",
      transmission_code: v.变速箱代号 || "",
      chassis_code: v.底盘代号 || "",
      drive_type: v.驱动方式 || "",
      body_type: v.车身类型 || "",
      emission_standard: v.排放标准 || "",
    }));
    setVmModalSelected((prev) => {
      const next = new Map(prev);
      mapped.forEach((v) => next.set(v.id, v));
      return next;
    });
  }

  async function deselectAllMatchingVmModels() {
    setVmModalSelectAllLoading(true);
    const numericIds = value.map((v) => Number(v.id)).filter((n) => !isNaN(n));
    let query = supabase.from("vehicle_models").select("id").order("id", { ascending: true });
    Object.entries(vmModalFilters).forEach(([col, val]) => {
      const trimmed = val.trim();
      if (!trimmed) return;
      const colDef = VM_MODAL_COLUMNS.find((c) => c.key === col);
      if (colDef?.type === "int") {
        const num = parseInt(trimmed, 10);
        if (!isNaN(num)) query = query.eq(col, num);
      } else {
        query = query.ilike(col, `%${trimmed}%`);
      }
    });
    if (vmModalMode === "add" && numericIds.length > 0) {
      query = query.not("id", "in", `(${numericIds.join(",")})`);
    } else if ((vmModalMode === "edit" || vmModalMode === "delete") && numericIds.length > 0) {
      query = query.in("id", numericIds);
    } else if ((vmModalMode === "edit" || vmModalMode === "delete") && numericIds.length === 0) {
      setVmModalSelectAllLoading(false);
      return;
    }
    query = query.limit(500);
    const { data } = await query;
    setVmModalSelectAllLoading(false);
    if (!data) return;
    const idsToRemove = new Set(data.map((v: any) => String(v.id)));
    setVmModalSelected((prev) => {
      const next = new Map(prev);
      idsToRemove.forEach((id) => next.delete(id));
      return next;
    });
  }

  function confirmVmModal() {
    const selected = Array.from(vmModalSelected.values());
    const newItems = selected.map((v) => {
      const existing = value.find((existing) => String(existing.id) === String(v.id));
      const name = v.model_name ? `${v.brand} ${v.series} ${v.model_name}` : `${v.brand} ${v.series}`;
      return {
        id: String(v.id),
        name,
        manufacturer: v.manufacturer,
        brand: v.brand,
        series: v.series,
        model_name: v.model_name,
        sales_version: v.sales_version,
        year_start: v.year_start,
        year_end: v.year_end,
        displacement: v.displacement,
        engine: v.engine,
        fuel_type: v.fuel_type,
        intake_form: v.intake_form,
        chassis_code: v.chassis_code,
        transmission_type: v.transmission_type,
        transmission_code: v.transmission_code,
        drive_type: v.drive_type,
        body_type: v.body_type,
        emission_standard: v.emission_standard,
        front_tire: v.front_tire,
        rear_tire: v.rear_tire,
        notes: existing?.notes || "",
      };
    });
    if (vmModalMode === "edit") {
      onChange(newItems);
    } else if (vmModalMode === "delete") {
      const idsToDelete = new Set(selected.map((v) => String(v.id)));
      onChange(value.filter((v) => !idsToDelete.has(String(v.id))));
    } else {
      const merged = [...value];
      newItems.forEach((item) => {
        if (!merged.some((existing) => String(existing.id) === String(item.id))) {
          merged.push(item);
        }
      });
      onChange(merged);
    }
    setVmModalOpen(false);
  }

  function removeVehicleModel(id: string) {
    onChange(value.filter((v) => v.id !== id));
  }

  function updateVehicleModelNotes(id: string, notes: string) {
    onChange(value.map((v) => (v.id === id ? { ...v, notes } : v)));
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900">适用车型</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openVmModal("add")}
            className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            添加
          </button>
          {value.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => openVmModal("edit")}
                className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200"
              >
                编辑
              </button>
              <button
                type="button"
                onClick={() => openVmModal("delete")}
                className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
              >
                删除
              </button>
            </>
          )}
        </div>
      </div>

      {value.length > 0 && (
        <div className="space-y-1.5">
          {value.map((v) => (
            <div key={v.id} className="bg-gray-50 rounded px-2 py-1.5 text-xs">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <div className="flex-1 min-w-0 text-gray-700">
                    <span className="text-gray-500">ID:{String(v.id).slice(0, 8)}</span>
                    <span className="text-gray-400 mx-1">·</span>
                    {v.manufacturer && <span className="text-gray-500 mr-1">{v.manufacturer}</span>}
                    {v.brand} {v.series} {v.model_name}
                    {v.sales_version && <span className="text-gray-500 ml-0.5">({v.sales_version})</span>}
                    {v.year_start && (
                      <span className="text-gray-400 ml-0.5">
                        {v.year_start}
                        {v.year_end && v.year_end !== v.year_start ? `-${v.year_end}` : ""}款
                      </span>
                    )}
                    {v.displacement && (
                      <>
                        <span className="text-gray-400 mx-1">·</span>
                        <span className="text-gray-500">{v.displacement}</span>
                      </>
                    )}
                    {v.engine && (
                      <>
                        <span className="text-gray-400 mx-1">·</span>
                        <span className="text-gray-500">发动机:{v.engine}</span>
                      </>
                    )}
                    {v.fuel_type && (
                      <>
                        <span className="text-gray-400 mx-1">·</span>
                        <span className="text-gray-500">{v.fuel_type}</span>
                      </>
                    )}
                    {v.intake_form && (
                      <>
                        <span className="text-gray-400 mx-1">·</span>
                        <span className="text-gray-500">{v.intake_form}</span>
                      </>
                    )}
                    {v.chassis_code && (
                      <>
                        <span className="text-gray-400 mx-1">·</span>
                        <span className="text-gray-500">底盘号:{v.chassis_code}</span>
                      </>
                    )}
                    {v.transmission_type && (
                      <>
                        <span className="text-gray-400 mx-1">·</span>
                        <span className="text-gray-500">变速箱:{v.transmission_type}</span>
                      </>
                    )}
                    {v.transmission_code && (
                      <>
                        <span className="text-gray-400 mx-1">·</span>
                        <span className="text-gray-500">变速箱号:{v.transmission_code}</span>
                      </>
                    )}
                    {v.front_tire && (
                      <>
                        <span className="text-gray-400 mx-1">·</span>
                        <span className="text-gray-500">前轮胎:{v.front_tire}</span>
                      </>
                    )}
                    {v.rear_tire && (
                      <>
                        <span className="text-gray-400 mx-1">·</span>
                        <span className="text-gray-500">后轮胎:{v.rear_tire}</span>
                      </>
                    )}
                    {v.drive_type && (
                      <>
                        <span className="text-gray-400 mx-1">·</span>
                        <span className="text-gray-500">{v.drive_type}</span>
                      </>
                    )}
                    {v.body_type && (
                      <>
                        <span className="text-gray-400 mx-1">·</span>
                        <span className="text-gray-500">{v.body_type}</span>
                      </>
                    )}
                    {v.emission_standard && (
                      <>
                        <span className="text-gray-400 mx-1">·</span>
                        <span className="text-gray-500">{v.emission_standard}</span>
                      </>
                    )}
                    {v.notes && <span className="text-gray-400 ml-1">· 备注:{v.notes}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      const el = document.getElementById(`vm-note-${v.id}`);
                      if (el) el.focus();
                    }}
                    className="text-blue-600 hover:text-blue-700"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => removeVehicleModel(v.id)}
                    className="text-red-500 hover:text-red-600"
                  >
                    删除
                  </button>
                </div>
              </div>
              <div className="mt-1 flex items-center gap-1 pl-0">
                <span className="text-gray-400">备注:</span>
                <input
                  id={`vm-note-${v.id}`}
                  type="text"
                  placeholder="可选"
                  className="flex-1 min-w-0 px-1.5 py-0.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                  value={v.notes || ""}
                  onChange={(e) => updateVehicleModelNotes(v.id, e.target.value)}
                />
              </div>
            </div>
          ))}
          {value.length > 0 && (
            <div className="text-xs text-gray-500 text-center py-1 border-t border-gray-100 mt-1">
              共匹配 {value.length} 个车型
            </div>
          )}
        </div>
      )}
      {value.length === 0 && (
        <div className="text-xs text-gray-400 text-center py-4">暂未关联车型</div>
      )}

      {/* 弹窗 */}
      {vmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-7xl max-h-[80vh] flex flex-col mx-4">
            <div className="flex items-center gap-4 px-6 py-4 border-b border-gray-200">
              <h3 className="text-base font-semibold text-gray-900 shrink-0">
                {vmModalMode === "add" ? "添加适用车型" : vmModalMode === "edit" ? "编辑适用车型" : "删除适用车型"}
              </h3>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setVmModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none shrink-0"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-auto px-6 py-3">
              {vmModalLoading && <div className="text-sm text-gray-500 text-center py-4">加载中...</div>}
              {!vmModalLoading && vmModalList.length === 0 && (
                <div className="text-sm text-gray-400 text-center py-4">未找到车型</div>
              )}
              {!vmModalLoading && vmModalList.length > 0 && (
                <table className="text-sm whitespace-nowrap w-max">
                  <thead className="bg-gray-50 sticky top-0 z-10">
                    <tr>
                      <th className="px-3 py-2 text-left w-10 align-top bg-gray-50">
                        {vmModalSelectAllLoading ? (
                          <span className="text-xs text-gray-400">处理中...</span>
                        ) : (
                          <input
                            type="checkbox"
                            checked={vmModalList.length > 0 && vmModalList.every((v) => vmModalSelected.has(v.id))}
                            onChange={async (e) => {
                              if (e.target.checked) {
                                await selectAllMatchingVmModels();
                              } else {
                                await deselectAllMatchingVmModels();
                              }
                            }}
                          />
                        )}
                      </th>
                      {VM_MODAL_COLUMNS.map((col) => (
                        <th key={col.key} className="px-3 py-2 text-left align-top bg-gray-50">
                          <div className="flex flex-col gap-1" style={{ minWidth: col.minWidth }}>
                            <span>{col.label}</span>
                            <input
                              type="text"
                              placeholder="筛选..."
                              className="w-full px-1.5 py-0.5 text-[11px] border border-gray-200 rounded bg-white placeholder-gray-300 focus:outline-none focus:border-blue-400"
                              value={vmModalFilterInputs[col.key] || ""}
                              onChange={(e) =>
                                setVmModalFilterInputs((prev) => ({
                                  ...prev,
                                  [col.key]: e.target.value,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  setVmModalFilters({ ...vmModalFilterInputs });
                                }
                              }}
                            />
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {vmModalList.map((v) => (
                      <tr key={v.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={vmModalSelected.has(v.id)}
                            onChange={() => toggleVmModalSelection(v)}
                          />
                        </td>
                        <td className="px-3 py-2 text-gray-500">{v.id}</td>
                        <td className="px-3 py-2">{v.brand || "-"}</td>
                        <td className="px-3 py-2">{v.series || "-"}</td>
                        <td className="px-3 py-2">{v.model_name || "-"}</td>
                        <td className="px-3 py-2 text-gray-500">{v.year_start ?? "-"}</td>
                        <td className="px-3 py-2 text-gray-700">{v.engine || "-"}</td>
                        <td className="px-3 py-2 text-gray-700">{v.chassis_code || "-"}</td>
                        <td className="px-3 py-2 text-gray-700">{v.transmission_type || "-"}</td>
                        <td className="px-3 py-2 text-gray-700">{v.transmission_code || "-"}</td>
                        <td className="px-3 py-2 text-gray-700">{v.front_tire || "-"}</td>
                        <td className="px-3 py-2 text-gray-700">{v.rear_tire || "-"}</td>
                        <td className="px-3 py-2 text-gray-700">{v.displacement || "-"}</td>
                        <td className="px-3 py-2 text-gray-700">{v.fuel_type || "-"}</td>
                        <td className="px-3 py-2 text-gray-700">{v.sales_version || "-"}</td>
                        <td className="px-3 py-2 text-gray-700">{v.intake_form || "-"}</td>
                        <td className="px-3 py-2 text-gray-700">{v.drive_type || "-"}</td>
                        <td className="px-3 py-2 text-gray-700">{v.body_type || "-"}</td>
                        <td className="px-3 py-2 text-gray-700">{v.emission_standard || "-"}</td>
                        <td className="px-3 py-2 text-gray-700">{v.manufacturer || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 gap-4 flex-wrap">
              <div className="flex items-center gap-4 text-sm text-gray-600 shrink-0">
                <span>
                  共 <span className="font-medium text-gray-900">{vmModalTotal}</span> 个车型
                </span>
                <span>
                  已选 <span className="font-medium text-blue-600">{vmModalSelected.size}</span> 个
                </span>
              </div>
              {(() => {
                const totalPages = Math.max(1, Math.ceil(vmModalTotal / VM_MODAL_PAGE_SIZE));
                if (totalPages <= 1) return <div />;
                return (
                  <div className="flex items-center gap-2 text-sm">
                    <button
                      type="button"
                      onClick={() => setVmModalPage((p) => Math.max(1, p - 1))}
                      disabled={vmModalPage <= 1}
                      className="px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      上一页
                    </button>
                    <span className="text-gray-600">
                      第 {vmModalPage}/{totalPages} 页
                    </span>
                    <button
                      type="button"
                      onClick={() => setVmModalPage((p) => Math.min(totalPages, p + 1))}
                      disabled={vmModalPage >= totalPages}
                      className="px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      下一页
                    </button>
                  </div>
                );
              })()}
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setVmModalOpen(false)}
                  className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={confirmVmModal}
                  disabled={vmModalSelected.size === 0}
                  className={`px-4 py-2 text-sm text-white rounded-lg disabled:opacity-50 ${
                    vmModalMode === "delete" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
                  }`}
                >
                  {vmModalMode === "delete" ? "删除" : "确定"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

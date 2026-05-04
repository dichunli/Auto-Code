"use client";

import { useState, useMemo } from "react";

interface VehicleItem {
  vehicle_model_id: number;
  vehicle_name: string;
  品牌?: string;
  车系?: string;
  车型?: string;
  年款?: number | null;
  排量?: string | null;
  发动机型号: string | null;
  底盘型号: string | null;
  变速箱型号: string | null;
}

interface VehicleDeleteModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (vehicleIds: number[]) => void;
  vehicles: VehicleItem[];
  prices?: { price: number; vip_price: number | null; customer_parts_price: number | null; company_price: number | null };
}

export default function VehicleDeleteModal({ open, onClose, onConfirm, vehicles, prices }: VehicleDeleteModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [filters, setFilters] = useState({
    id: "",
    品牌: "",
    车系: "",
    车型: "",
    年款: "",
    排量: "",
    发动机型号: "",
    底盘型号: "",
    变速箱型号: "",
  });

  const filteredVehicles = useMemo(() => {
    let result = [...vehicles];

    if (filters.id) {
      const id = parseInt(filters.id);
      if (!Number.isNaN(id)) result = result.filter((v) => v.vehicle_model_id === id);
    }
    if (filters.品牌) {
      const q = filters.品牌.toLowerCase();
      result = result.filter((v) => v.品牌?.toLowerCase().includes(q));
    }
    if (filters.车系) {
      const q = filters.车系.toLowerCase();
      result = result.filter((v) => v.车系?.toLowerCase().includes(q));
    }
    if (filters.车型) {
      const q = filters.车型.toLowerCase();
      result = result.filter((v) => v.车型?.toLowerCase().includes(q));
    }
    if (filters.年款) {
      const year = parseInt(filters.年款);
      if (!Number.isNaN(year)) result = result.filter((v) => v.年款 === year);
    }
    if (filters.排量) {
      const q = filters.排量.toLowerCase();
      result = result.filter((v) => v.排量?.toLowerCase().includes(q));
    }
    if (filters.发动机型号) {
      const q = filters.发动机型号.toLowerCase();
      result = result.filter((v) => v.发动机型号?.toLowerCase().includes(q));
    }
    if (filters.底盘型号) {
      const q = filters.底盘型号.toLowerCase();
      result = result.filter((v) => v.底盘型号?.toLowerCase().includes(q));
    }
    if (filters.变速箱型号) {
      const q = filters.变速箱型号.toLowerCase();
      result = result.filter((v) => v.变速箱型号?.toLowerCase().includes(q));
    }

    return result;
  }, [vehicles, filters]);

  const totalCount = filteredVehicles.length;
  const displayVehicles = filteredVehicles.slice((page - 1) * pageSize, page * pageSize);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const allPageSelected = displayVehicles.length > 0 && displayVehicles.every((v) => selectedIds.has(v.vehicle_model_id));

  function toggleSelection(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSelectAll() {
    if (allPageSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        displayVehicles.forEach((v) => next.delete(v.vehicle_model_id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        displayVehicles.forEach((v) => next.add(v.vehicle_model_id));
        return next;
      });
    }
  }

  function handleConfirm() {
    if (selectedIds.size === 0) {
      alert("请至少选择一个车型");
      return;
    }
    setConfirming(true);
    onConfirm(Array.from(selectedIds));
  }

  function handleClose() {
    setSelectedIds(new Set());
    setConfirming(false);
    setPage(1);
    setFilters({ id: "", 品牌: "", 车系: "", 车型: "", 年款: "", 排量: "", 发动机型号: "", 底盘型号: "", 变速箱型号: "" });
    onClose();
  }

  function updateFilter(key: keyof typeof filters, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">删除已关联车型</h3>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        {/* 价格显示 */}
        {prices && (
          <div className="px-6 py-3 border-b border-gray-100 bg-gray-50">
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-sm text-gray-700 font-medium">设定价格：</span>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">销售价</label>
                <input
                  type="number"
                  className="w-28 px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-gray-100"
                  value={prices.price}
                  readOnly
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">VIP价</label>
                <input
                  type="number"
                  className="w-28 px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-gray-100"
                  value={prices.vip_price ?? ""}
                  readOnly
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">自带配件价</label>
                <input
                  type="number"
                  className="w-28 px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-gray-100"
                  value={prices.customer_parts_price ?? ""}
                  readOnly
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">单位价</label>
                <input
                  type="number"
                  className="w-28 px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-gray-100"
                  value={prices.company_price ?? ""}
                  readOnly
                />
              </div>
              <span className="text-xs text-gray-500">已选择 {selectedIds.size} 个车型</span>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-auto px-6 py-3">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left w-10">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={handleSelectAll}
                    className="w-4 h-4"
                  />
                </th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">
                  <div className="space-y-1">
                    <div>ID</div>
                    <input
                      type="text"
                      className="w-16 px-1.5 py-0.5 border border-gray-300 rounded text-xs"
                      placeholder="筛选"
                      value={filters.id}
                      onChange={(e) => updateFilter("id", e.target.value)}
                    />
                  </div>
                </th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">
                  <div className="space-y-1">
                    <div>品牌</div>
                    <input
                      type="text"
                      className="w-20 px-1.5 py-0.5 border border-gray-300 rounded text-xs"
                      placeholder="筛选"
                      value={filters.品牌}
                      onChange={(e) => updateFilter("品牌", e.target.value)}
                    />
                  </div>
                </th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">
                  <div className="space-y-1">
                    <div>车系</div>
                    <input
                      type="text"
                      className="w-20 px-1.5 py-0.5 border border-gray-300 rounded text-xs"
                      placeholder="筛选"
                      value={filters.车系}
                      onChange={(e) => updateFilter("车系", e.target.value)}
                    />
                  </div>
                </th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">
                  <div className="space-y-1">
                    <div>车型</div>
                    <input
                      type="text"
                      className="w-20 px-1.5 py-0.5 border border-gray-300 rounded text-xs"
                      placeholder="筛选"
                      value={filters.车型}
                      onChange={(e) => updateFilter("车型", e.target.value)}
                    />
                  </div>
                </th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">
                  <div className="space-y-1">
                    <div>年款</div>
                    <input
                      type="text"
                      className="w-16 px-1.5 py-0.5 border border-gray-300 rounded text-xs"
                      placeholder="筛选"
                      value={filters.年款}
                      onChange={(e) => updateFilter("年款", e.target.value)}
                    />
                  </div>
                </th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">
                  <div className="space-y-1">
                    <div>排量</div>
                    <input
                      type="text"
                      className="w-16 px-1.5 py-0.5 border border-gray-300 rounded text-xs"
                      placeholder="筛选"
                      value={filters.排量}
                      onChange={(e) => updateFilter("排量", e.target.value)}
                    />
                  </div>
                </th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">
                  <div className="space-y-1">
                    <div>发动机型号</div>
                    <input
                      type="text"
                      className="w-20 px-1.5 py-0.5 border border-gray-300 rounded text-xs"
                      placeholder="筛选"
                      value={filters.发动机型号}
                      onChange={(e) => updateFilter("发动机型号", e.target.value)}
                    />
                  </div>
                </th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">
                  <div className="space-y-1">
                    <div>底盘型号</div>
                    <input
                      type="text"
                      className="w-20 px-1.5 py-0.5 border border-gray-300 rounded text-xs"
                      placeholder="筛选"
                      value={filters.底盘型号}
                      onChange={(e) => updateFilter("底盘型号", e.target.value)}
                    />
                  </div>
                </th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">
                  <div className="space-y-1">
                    <div>变速箱型号</div>
                    <input
                      type="text"
                      className="w-20 px-1.5 py-0.5 border border-gray-300 rounded text-xs"
                      placeholder="筛选"
                      value={filters.变速箱型号}
                      onChange={(e) => updateFilter("变速箱型号", e.target.value)}
                    />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {displayVehicles.map((v) => (
                <tr key={v.vehicle_model_id} className="hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(v.vehicle_model_id)}
                      onChange={() => toggleSelection(v.vehicle_model_id)}
                      className="w-4 h-4"
                    />
                  </td>
                  <td className="px-3 py-2 text-gray-600">{v.vehicle_model_id}</td>
                  <td className="px-3 py-2 text-gray-900">{v.品牌 || "-"}</td>
                  <td className="px-3 py-2 text-gray-900">{v.车系 || "-"}</td>
                  <td className="px-3 py-2 text-gray-900">{v.车型 || "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{v.年款 ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{v.排量 ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{v.发动机型号 ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{v.底盘型号 ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{v.变速箱型号 ?? "-"}</td>
                </tr>
              ))}
              {displayVehicles.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-gray-400">无匹配车型</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50">
          <div className="text-xs text-gray-500">
            共 {totalCount} 条，第 {page}/{totalPages} 页
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                上一页
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                下一页
              </button>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirming || selectedIds.size === 0}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {confirming ? "删除中..." : "确认删除"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

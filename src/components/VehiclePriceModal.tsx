"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

interface VehicleModel {
  id: number;
  品牌: string;
  车系: string;
  车型: string;
  年款: number | null;
  排量: string | null;
  发动机型号: string | null;
  底盘型号: string | null;
  变速箱型号: string | null;
}

interface VehiclePriceModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (vehicleIds: number[], price: number, vipPrice: number | null, customerPartsPrice: number | null, companyPrice: number | null) => void;
  defaultPrices?: { price: number; vip_price: number | null; customer_parts_price: number | null; company_price: number | null };
  excludedIds?: number[];
  preSelectedIds?: number[];
}

export default function VehiclePriceModal({ open, onClose, onConfirm, defaultPrices, excludedIds, preSelectedIds }: VehiclePriceModalProps) {
  const supabase = createClient();
  const [price, setPrice] = useState("");
  const [vipPrice, setVipPrice] = useState("");
  const [customerPartsPrice, setCustomerPartsPrice] = useState("");
  const [companyPrice, setCompanyPrice] = useState("");
  const [vehicles, setVehicles] = useState<VehicleModel[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
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

  // 初始化：打开时重置价格和选择
  useEffect(() => {
    if (!open) {
      setConfirming(false);
      return;
    }
    if (defaultPrices) {
      setPrice(defaultPrices.price.toString());
      setVipPrice(defaultPrices.vip_price?.toString() ?? "");
      setCustomerPartsPrice(defaultPrices.customer_parts_price?.toString() ?? "");
      setCompanyPrice(defaultPrices.company_price?.toString() ?? "");
    } else {
      setPrice("");
      setVipPrice("");
      setCustomerPartsPrice("");
      setCompanyPrice("");
    }
    setSelectedIds(new Set(preSelectedIds || []));
    setPage(1);
    setFilters({ id: "", 品牌: "", 车系: "", 车型: "", 年款: "", 排量: "", 发动机型号: "", 底盘型号: "", 变速箱型号: "" });
  }, [open]);

  // 加载车型列表：分页/筛选变化时
  useEffect(() => {
    if (!open) return;
    loadVehicles();
  }, [open, page, excludedIds?.join(",")]);

  async function loadVehicles() {
    setLoading(true);
    let query = supabase.from("vehicle_models").select("id,品牌,车系,车型,年款,排量,发动机型号,底盘型号,变速箱型号", { count: "exact" });

    if (filters.id) query = query.eq("id", parseInt(filters.id));
    if (filters.品牌) query = query.ilike("品牌", `%${filters.品牌}%`);
    if (filters.车系) query = query.ilike("车系", `%${filters.车系}%`);
    if (filters.车型) query = query.ilike("车型", `%${filters.车型}%`);
    if (filters.年款) query = query.eq("年款", parseInt(filters.年款));
    if (filters.排量) query = query.ilike("排量", `%${filters.排量}%`);
    if (filters.发动机型号) query = query.ilike("发动机型号", `%${filters.发动机型号}%`);
    if (filters.底盘型号) query = query.ilike("底盘型号", `%${filters.底盘型号}%`);
    if (filters.变速箱型号) query = query.ilike("变速箱型号", `%${filters.变速箱型号}%`);

    if (excludedIds && excludedIds.length > 0) {
      query = query.not("id", "in", `(${excludedIds.join(",")})`);
    }

    const { data, count, error } = await query
      .order("id")
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (error) {
      console.error("加载车型失败:", error);
      setVehicles([]);
      setTotalCount(0);
    } else {
      setVehicles((data as unknown as VehicleModel[]) || []);
      setTotalCount(count || 0);
    }
    setLoading(false);
  }

  function toggleSelection(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSelectAll() {
    const allMatchingSelected = selectedIds.size === totalCount && totalCount > 0;
    if (allMatchingSelected) {
      setSelectedIds(new Set());
      return;
    }
    // 选中所有符合筛选条件的车型（跨分页）
    setLoading(true);
    let query = supabase.from("vehicle_models").select("id").limit(10000);

    if (filters.id) query = query.eq("id", parseInt(filters.id));
    if (filters.品牌) query = query.ilike("品牌", `%${filters.品牌}%`);
    if (filters.车系) query = query.ilike("车系", `%${filters.车系}%`);
    if (filters.车型) query = query.ilike("车型", `%${filters.车型}%`);
    if (filters.年款) query = query.eq("年款", parseInt(filters.年款));
    if (filters.排量) query = query.ilike("排量", `%${filters.排量}%`);
    if (filters.发动机型号) query = query.ilike("发动机型号", `%${filters.发动机型号}%`);
    if (filters.底盘型号) query = query.ilike("底盘型号", `%${filters.底盘型号}%`);
    if (filters.变速箱型号) query = query.ilike("变速箱型号", `%${filters.变速箱型号}%`);
    if (excludedIds && excludedIds.length > 0) {
      query = query.not("id", "in", `(${excludedIds.join(",")})`);
    }

    const { data, error } = await query.order("id");
    if (!error && data) {
      const allIds = (data as unknown as { id: number }[]).map((v) => v.id);
      setSelectedIds(new Set(allIds));
    }
    setLoading(false);
  }

  function handleConfirm() {
    if (confirming) return;
    const priceVal = price === "" ? NaN : parseFloat(price);
    const vipVal = vipPrice === "" ? null : parseFloat(vipPrice);
    const cpVal = customerPartsPrice === "" ? null : parseFloat(customerPartsPrice);
    const coVal = companyPrice === "" ? null : parseFloat(companyPrice);
    if (Number.isNaN(priceVal)) {
      alert("请输入有效的销售价");
      return;
    }
    if (selectedIds.size === 0 && !preSelectedIds) {
      alert("请至少选择一个车型");
      return;
    }
    setConfirming(true);
    onConfirm(Array.from(selectedIds), priceVal, vipVal, cpVal, coVal);
    setPrice("");
    setVipPrice("");
    setCustomerPartsPrice("");
    setCompanyPrice("");
    setSelectedIds(new Set());
    setPage(1);
    setFilters({ id: "", 品牌: "", 车系: "", 车型: "", 年款: "", 排量: "", 发动机型号: "", 底盘型号: "", 变速箱型号: "" });
  }

  function handleClose() {
    setPrice("");
    setVipPrice("");
    setCustomerPartsPrice("");
    setCompanyPrice("");
    setSelectedIds(new Set());
    setPage(1);
    setFilters({ id: "", 品牌: "", 车系: "", 车型: "", 年款: "", 排量: "", 发动机型号: "", 底盘型号: "", 变速箱型号: "" });
    onClose();
  }

  if (!open) return null;

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">关联车型定价</h3>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        <div className="px-6 py-3 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-sm text-gray-700 font-medium">设定价格：</span>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">销售价</label>
              <input
                type="number"
                className="w-28 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">VIP价</label>
              <input
                type="number"
                className="w-28 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
                value={vipPrice}
                onChange={(e) => setVipPrice(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">自带配件价</label>
              <input
                type="number"
                className="w-28 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
                value={customerPartsPrice}
                onChange={(e) => setCustomerPartsPrice(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">单位价</label>
              <input
                type="number"
                className="w-28 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
                value={companyPrice}
                onChange={(e) => setCompanyPrice(e.target.value)}
              />
            </div>
            <span className="text-xs text-gray-500">已选择 {selectedIds.size} 个车型</span>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-6 py-3">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left w-10">
                  <input
                    type="checkbox"
                    checked={totalCount > 0 && selectedIds.size === totalCount}
                    ref={(el) => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size !== totalCount; }}
                    onChange={handleSelectAll}
                    disabled={loading}
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
                      value={filters.id?.toString() || ""}
                      onChange={(e) => setFilters((f) => ({ ...f, id: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && loadVehicles()}
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
                      onChange={(e) => setFilters((f) => ({ ...f, 品牌: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && loadVehicles()}
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
                      onChange={(e) => setFilters((f) => ({ ...f, 车系: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && loadVehicles()}
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
                      onChange={(e) => setFilters((f) => ({ ...f, 车型: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && loadVehicles()}
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
                      onChange={(e) => setFilters((f) => ({ ...f, 年款: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && loadVehicles()}
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
                      onChange={(e) => setFilters((f) => ({ ...f, 排量: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && loadVehicles()}
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
                      onChange={(e) => setFilters((f) => ({ ...f, 发动机型号: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && loadVehicles()}
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
                      onChange={(e) => setFilters((f) => ({ ...f, 底盘型号: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && loadVehicles()}
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
                      onChange={(e) => setFilters((f) => ({ ...f, 变速箱型号: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && loadVehicles()}
                    />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {vehicles.map((v) => (
                <tr key={v.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(v.id)}
                      onChange={() => toggleSelection(v.id)}
                      className="w-4 h-4"
                    />
                  </td>
                  <td className="px-3 py-2 text-gray-600">{v.id}</td>
                  <td className="px-3 py-2 text-gray-900">{v.品牌}</td>
                  <td className="px-3 py-2 text-gray-900">{v.车系}</td>
                  <td className="px-3 py-2 text-gray-900">{v.车型}</td>
                  <td className="px-3 py-2 text-gray-600">{v.年款 ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{v.排量 ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{v.发动机型号 ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{v.底盘型号 ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{v.变速箱型号 ?? "-"}</td>
                </tr>
              ))}
              {vehicles.length === 0 && !loading && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-gray-400">
                    暂无数据，请调整筛选条件
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {loading && (
            <div className="py-4 text-center text-sm text-gray-500">加载中...</div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50">
          <div className="text-xs text-gray-500">
            共 {totalCount} 条，第 {page}/{Math.max(1, totalPages)} 页
          </div>
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
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
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
            disabled={confirming}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {confirming ? "保存中..." : "确认关联"}
          </button>
        </div>
      </div>
    </div>
  );
}

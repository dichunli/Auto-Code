"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";

interface Part {
  id: string;
  part_number: string;
  name: string;
  unit: string;
  quantity: number;
  min_stock: number;
  unit_cost: number | null;
  unit_price: number | null;
  location: string | null;
  specification_text: string | null;
  part_name_id: string | null;
  part_names: { name: string; unit: string } | null;
  part_brands: { name: string } | null;
  part_specifications: { name: string } | null;
  part_categories: { name: string } | null;
  suppliers: { name: string } | null;
  selectedQuantity?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (parts: Part[]) => void;
  vehicleModelId?: string | null;
}

export function PartPickerModal({ open, onClose, onConfirm, vehicleModelId }: Props) {
  const supabase = createClient();

  // 数据
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(false);

  // 搜索条件
  const [partNumber, setPartNumber] = useState("");
  const [nameQuery, setNameQuery] = useState("");
  const [specQuery, setSpecQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [stockFilter, setStockFilter] = useState("all"); // all, inStock, outOfStock

  // 配件分类选项
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);

  // 已选
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedQtyMap, setSelectedQtyMap] = useState<Record<string, number>>({});

  // 分页
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // 关联车型配件ID列表
  const [linkedPartIds, setLinkedPartIds] = useState<Set<string>>(new Set());

  // 加载配件分类
  useEffect(() => {
    if (!open) return;
    supabase.from("part_categories").select("id, name").order("name").then(({ data }) => {
      setCategories(data || []);
    });
  }, [open, supabase]);

  // 加载关联车型的配件ID
  useEffect(() => {
    if (!open || !vehicleModelId) {
      setLinkedPartIds(new Set());
      return;
    }
    supabase
      .from("part_vehicle_models")
      .select("part_id")
      .eq("vehicle_model_id", vehicleModelId)
      .then(({ data }) => {
        setLinkedPartIds(new Set((data || []).map((r) => r.part_id)));
      });
  }, [open, vehicleModelId, supabase]);

  // 查询配件
  const doSearch = useCallback(async () => {
    setLoading(true);
    setCurrentPage(1);

    let query = supabase
      .from("parts")
      .select(
        "id, part_number, name, unit, quantity, min_stock, unit_cost, unit_price, location, specification_text, part_name_id, part_names(name, unit), part_brands(name), part_specifications(name), part_categories(name), suppliers(name)"
      )
      .order("name", { ascending: true })
      .limit(500);

    // 编号/零件号
    if (partNumber.trim()) {
      query = query.ilike("part_number", `%${partNumber.trim()}%`);
    }

    // 名称
    if (nameQuery.trim()) {
      query = query.ilike("name", `%${nameQuery.trim()}%`);
    }

    // 规格（specification_text）
    if (specQuery.trim()) {
      query = query.ilike("specification_text", `%${specQuery.trim()}%`);
    }

    // 配件分类
    if (categoryId) {
      query = query.eq("category_id", categoryId);
    }

    const { data, error } = await query;

    if (error) {
      console.error("查询配件失败:", error);
      setParts([]);
    } else {
      setParts((data as any[]) || []);
    }
    setLoading(false);
  }, [supabase, partNumber, nameQuery, specQuery, categoryId]);

  // 打开时自动查询一次
  useEffect(() => {
    if (open) {
      doSearch();
      setSelectedIds(new Set());
      setSelectedQtyMap({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 客户端过滤（库存状态、关联车型等）
  const filteredParts = useMemo(() => {
    let result = [...parts];

    // 库存过滤
    if (stockFilter === "inStock") {
      result = result.filter((p) => p.quantity > 0);
    } else if (stockFilter === "outOfStock") {
      result = result.filter((p) => p.quantity <= 0);
    }

    // 优先排序：与当前车型匹配的配件排在前面
    if (vehicleModelId && linkedPartIds.size > 0) {
      result.sort((a, b) => {
        const aLinked = linkedPartIds.has(a.id);
        const bLinked = linkedPartIds.has(b.id);
        if (aLinked && !bLinked) return -1;
        if (!aLinked && bLinked) return 1;
        return 0;
      });
    }

    return result;
  }, [parts, stockFilter, vehicleModelId, linkedPartIds]);

  // 分页
  const totalCount = filteredParts.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedParts = filteredParts.slice((safePage - 1) * pageSize, safePage * pageSize);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setSelectedQtyMap((q) => { const n = { ...q }; delete n[id]; return n; });
      } else {
        next.add(id);
        setSelectedQtyMap((q) => ({ ...q, [id]: 1 }));
      }
      return next;
    });
  }

  function toggleSelectAll() {
    const pageIds = paginatedParts.map((p) => p.id);
    const allSelected = paginatedParts.every((p) => selectedIds.has(p.id));
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of pageIds) next.delete(id);
        return next;
      });
      setSelectedQtyMap((q) => {
        const n = { ...q };
        for (const id of pageIds) delete n[id];
        return n;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of pageIds) next.add(id);
        return next;
      });
      setSelectedQtyMap((q) => {
        const n = { ...q };
        for (const id of pageIds) { if (!n[id]) n[id] = 1; }
        return n;
      });
    }
  }

  function updateQuantity(id: string, qty: number) {
    if (qty < 1 || isNaN(qty)) {
      toggleSelect(id);
      return;
    }
    setSelectedQtyMap((prev) => ({ ...prev, [id]: qty }));
  }

  // 已选配件数据
  const selectedParts = useMemo(() => parts.filter((p) => selectedIds.has(p.id)), [parts, selectedIds]);

  function handleConfirm() {
    const selected = selectedParts.map((p) => ({
      ...p,
      selectedQuantity: selectedQtyMap[p.id] ?? 1,
    }));
    onConfirm(selected);
    setSelectedIds(new Set());
    setSelectedQtyMap({});
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-[1400px] mx-4 max-h-[90vh] flex flex-col">
        {/* 标题 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">选择配件</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 搜索条件 */}
        <div className="px-6 py-4 border-b border-gray-100 space-y-3">
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 whitespace-nowrap">编号/零件号:</span>
              <input
                type="text"
                value={partNumber}
                onChange={(e) => setPartNumber(e.target.value)}
                placeholder="编号/零件号"
                className="w-40 px-3 py-1.5 border border-gray-200 rounded-lg text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 whitespace-nowrap">名称/品牌:</span>
              <input
                type="text"
                value={nameQuery}
                onChange={(e) => setNameQuery(e.target.value)}
                placeholder="名称/品牌"
                className="w-40 px-3 py-1.5 border border-gray-200 rounded-lg text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 whitespace-nowrap">规格/型号:</span>
              <input
                type="text"
                value={specQuery}
                onChange={(e) => setSpecQuery(e.target.value)}
                placeholder="规格/型号"
                className="w-40 px-3 py-1.5 border border-gray-200 rounded-lg text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 whitespace-nowrap">配件分类:</span>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-32 px-3 py-1.5 border border-gray-200 rounded-lg text-sm"
              >
                <option value="">全部分类</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={doSearch}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
            >
              查询
            </button>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 whitespace-nowrap">有无库存:</span>
              <select
                value={stockFilter}
                onChange={(e) => { setStockFilter(e.target.value); setCurrentPage(1); }}
                className="w-28 px-3 py-1.5 border border-gray-200 rounded-lg text-sm"
              >
                <option value="all">全部</option>
                <option value="inStock">有库存</option>
                <option value="outOfStock">无库存</option>
              </select>
            </div>
          </div>
        </div>

        {/* 主体：左侧表格 + 右侧已选 */}
        <div className="flex-1 flex min-h-0">
          {/* 左侧 */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* 统计栏 */}
            <div className="px-6 py-2 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
              <span className="text-sm text-gray-600">
                已选择 <span className="font-semibold text-blue-600">{selectedIds.size}</span> 个配件
              </span>
              <span className="text-sm text-gray-400">
                共 {totalCount} 条记录，共 {totalPages} 页
              </span>
            </div>

            {/* 表格 */}
            <div className="flex-1 overflow-auto px-6 py-2">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left w-10">
                      <input
                        type="checkbox"
                        checked={paginatedParts.length > 0 && paginatedParts.every((p) => selectedIds.has(p.id))}
                        onChange={toggleSelectAll}
                        className="rounded border-gray-300"
                      />
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500 w-10">序号</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">配件名称</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">零件编号</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">总库存</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">规格/型号</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">品牌</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">适用车型</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">售价</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">仓位</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr>
                      <td colSpan={10} className="px-6 py-12 text-center text-gray-400">
                        加载中...
                      </td>
                    </tr>
                  ) : paginatedParts.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-6 py-12 text-center text-gray-400">
                        暂无配件数据
                      </td>
                    </tr>
                  ) : (
                    paginatedParts.map((part, idx) => (
                      <tr key={part.id} className={`hover:bg-gray-50 ${linkedPartIds.has(part.id) ? 'bg-blue-50/60 border-l-2 border-l-blue-400' : ''}`}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(part.id)}
                            onChange={() => toggleSelect(part.id)}
                            className="rounded border-gray-300"
                          />
                        </td>
                        <td className="px-3 py-2 text-gray-500">{(safePage - 1) * pageSize + idx + 1}</td>
                        <td className="px-3 py-2 font-medium text-gray-900">{part.name}</td>
                        <td className="px-3 py-2 text-gray-600">{part.part_number || "-"}</td>
                        <td className="px-3 py-2">
                          <span className={`font-medium ${part.quantity <= 0 ? "text-red-600" : part.quantity <= part.min_stock ? "text-orange-600" : "text-gray-900"}`}>
                            {part.quantity}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {part.specification_text || part.part_specifications?.name || "-"}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{part.part_brands?.name || "-"}</td>
                        <td className="px-3 py-2 text-gray-600">
                          {vehicleModelId && linkedPartIds.has(part.id) ? (
                            <span className="text-green-600 text-xs bg-green-50 px-1.5 py-0.5 rounded">已关联</span>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{formatCurrency(part.unit_price)}</td>
                        <td className="px-3 py-2 text-gray-600">{part.location || "-"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-center gap-1">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
                >
                  上一页
                </button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let page = i + 1;
                  if (totalPages > 5 && safePage > 3) {
                    page = safePage - 3 + i;
                    if (page > totalPages - 4) page = totalPages - 4 + i;
                  }
                  if (page > totalPages) return null;
                  return (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`px-3 py-1 text-sm rounded ${
                        page === safePage ? "bg-blue-600 text-white" : "border border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      {page}
                    </button>
                  );
                })}
                {totalPages > 5 && safePage < totalPages - 2 && <span className="px-1 text-gray-400">...</span>}
                {totalPages > 5 && safePage < totalPages - 2 && (
                  <button
                    onClick={() => setCurrentPage(totalPages)}
                    className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50"
                  >
                    {totalPages}
                  </button>
                )}
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
                >
                  下一页
                </button>
                <span className="ml-3 text-sm text-gray-500">{pageSize} 条/页</span>
                <span className="ml-2 text-sm text-gray-500">
                  {totalCount} 条记录，共 {totalPages} 页
                </span>
              </div>
            )}
          </div>

          {/* 右侧：已选择配件视图 */}
          <div className="w-72 border-l border-gray-200 flex flex-col bg-gray-50">
            <div className="px-4 py-3 border-b border-gray-200 bg-white flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-900">
                已选择配件 <span className="text-blue-600">({selectedIds.size})</span>
              </h3>
              {selectedIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => { setSelectedIds(new Set()); setSelectedQtyMap({}); }}
                  className="text-xs text-red-600 hover:text-red-700"
                >
                  清空
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {selectedParts.length === 0 ? (
                <div className="text-center text-gray-400 text-sm py-8">暂未选择配件</div>
              ) : (
                selectedParts.map((part) => (
                  <div key={part.id} className="bg-white rounded-lg border border-gray-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{part.name}</div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {part.part_number && <span className="mr-1">编号:{part.part_number} ·</span>}
                          <span>库存:{part.quantity}</span>
                          <span className="mx-1">·</span>
                          <span>售价:{formatCurrency(part.unit_price)}</span>
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1 flex-wrap">
                          {part.part_brands?.name && <span>品牌:{part.part_brands.name} ·</span>}
                          <span>{part.part_specifications?.name || part.specification_text || "-"}</span>
                          <span className="mx-1">·</span>
                          <span>数量:</span>
                          <input
                            type="number"
                            min={1}
                            value={selectedQtyMap[part.id] ?? 1}
                            onChange={(e) => updateQuantity(part.id, parseInt(e.target.value) || 1)}
                            className="w-14 px-1 py-0.5 border border-gray-200 rounded text-xs text-center"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleSelect(part.id)}
                        className="text-xs text-red-600 hover:text-red-700 shrink-0 mt-0.5"
                      >
                        移除
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={selectedIds.size === 0}
            className="px-5 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            确定 ({selectedIds.size})
          </button>
        </div>
      </div>
    </div>
  );
}

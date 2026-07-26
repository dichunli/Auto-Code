"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import BarcodeScanModal from "./BarcodeScanModal";

interface Part {
  id: string;
  part_number: string;
  oe_number: string | null;
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
  vehicleModelId?: number | null;
  defaultNameQuery?: string;
  replacedPartName?: string;
  compact?: boolean;
}

export function PartPickerModal({ open, onClose, onConfirm, vehicleModelId, defaultNameQuery, replacedPartName, compact }: Props) {
  const supabase = createClient();

  // 数据
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(false);

  // 搜索条件
  const [partNumber, setPartNumber] = useState("");
  const [oeNumberQuery, setOeNumberQuery] = useState("");
  const [nameQuery, setNameQuery] = useState("");
  const [brandQuery, setBrandQuery] = useState("");
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

  // 扫码弹窗
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);

  // 编号智能提示：输入≥2字符防抖模糊查，出候选下拉
  const [pnSuggests, setPnSuggests] = useState<{ id: string; part_number: string; name: string }[]>([]);
  const [showPnSuggests, setShowPnSuggests] = useState(false);
  const pnSuggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (pnSuggestTimer.current) clearTimeout(pnSuggestTimer.current);
    const kw = partNumber.trim();
    if (kw.length < 2) { setPnSuggests([]); return; }
    pnSuggestTimer.current = setTimeout(async () => {
      const { data } = await supabase
        .from("parts")
        .select("id, part_number, name")
        .ilike("part_number", `%${kw}%`)
        .limit(8);
      setPnSuggests(data || []);
    }, 250);
    return () => { if (pnSuggestTimer.current) clearTimeout(pnSuggestTimer.current); };
  }, [partNumber, supabase]);

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
        "id, part_number, oe_number, name, unit, quantity, min_stock, unit_cost, unit_price, location, specification_text, part_name_id, part_names(name, unit), part_brands(name), part_specifications(name), part_categories(name), suppliers(name)"
      )
      .order("name", { ascending: true })
      .limit(500);

    // 编号/零件号
    if (partNumber.trim()) {
      query = query.ilike("part_number", `%${partNumber.trim()}%`);
    }

    // OE号
    if (oeNumberQuery.trim()) {
      query = query.ilike("oe_number", `%${oeNumberQuery.trim()}%`);
    }

    // 名称
    if (nameQuery.trim()) {
      query = query.ilike("name", `%${nameQuery.trim()}%`);
    }

    // 品牌：先查匹配的品牌ID，再按 brand_id 过滤（parts.brand_id 关联 part_brands）
    if (brandQuery.trim()) {
      const { data: brandRows } = await supabase
        .from("part_brands")
        .select("id")
        .ilike("name", `%${brandQuery.trim()}%`);
      const brandIds = (brandRows || []).map((b) => b.id);
      if (brandIds.length === 0) {
        // 没有匹配品牌，直接返回空
        setParts([]);
        setLoading(false);
        return;
      }
      query = query.in("brand_id", brandIds);
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
      setParts((data as unknown as Part[]) || []);
    }
    setLoading(false);
  }, [supabase, partNumber, oeNumberQuery, nameQuery, brandQuery, specQuery, categoryId]);

  // 使用指定名称搜索（用于默认名称和扫码后的搜索）
  const doSearchWithName = useCallback(async (searchName: string) => {
    setLoading(true);
    setCurrentPage(1);

    let query = supabase
      .from("parts")
      .select(
        "id, part_number, oe_number, name, unit, quantity, min_stock, unit_cost, unit_price, location, specification_text, part_name_id, part_names(name, unit), part_brands(name), part_specifications(name), part_categories(name), suppliers(name)"
      )
      .order("name", { ascending: true })
      .limit(500);

    // 名称
    if (searchName.trim()) {
      query = query.ilike("name", `%${searchName.trim()}%`);
    }

    const { data, error } = await query;

    if (error) {
      console.error("查询配件失败:", error);
      setParts([]);
    } else {
      setParts((data as unknown as Part[]) || []);
    }
    setLoading(false);
  }, [supabase]);

  // 扫码回调：按编码搜索
  const handleBarcodeScan = useCallback(async (barcode: string) => {
    setShowBarcodeScanner(false);
    const trimmed = barcode.trim();
    if (!trimmed) return;

    setPartNumber(trimmed);
    setLoading(true);
    setCurrentPage(1);

    const { data, error } = await supabase
      .from("parts")
      .select(
        "id, part_number, oe_number, name, unit, quantity, min_stock, unit_cost, unit_price, location, specification_text, part_name_id, part_names(name, unit), part_brands(name), part_specifications(name), part_categories(name), suppliers(name)"
      )
      .or(`part_number.ilike.%${trimmed}%,name.ilike.%${trimmed}%`)
      .order("name", { ascending: true })
      .limit(100);

    if (error) {
      console.error("扫码搜索失败:", error);
      setParts([]);
    } else {
      setParts((data as unknown as Part[]) || []);
    }
    setLoading(false);
  }, [supabase]);

  // 扫码提示
  const [scanToast, setScanToast] = useState("");
  const scanToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 扫码枪手动模式（自动识别没认出时兜底）：专用输入框，扫码/输码回车必中
  const [gunMode, setGunMode] = useState(false);
  const [gunCode, setGunCode] = useState("");
  const gunInputRef = useRef<HTMLInputElement>(null);
  // 扫码命中：按 编码/条码 精确匹配，命中则加入已选并数量+1
  const handleScanCode = useCallback(async (rawCode: string) => {
    const kw = rawCode.trim();
    if (!kw) return;
    const { data } = await supabase
      .from("parts")
      .select("id, part_number, oe_number, name, unit, quantity, min_stock, unit_cost, unit_price, location, specification_text, part_name_id, barcode, part_names(name, unit), part_brands(name), part_specifications(name), part_categories(name), suppliers(name)")
      .or(`part_number.eq.${kw},barcode.eq.${kw}`)
      .limit(2);
    let toast = "";
    if (!data || data.length === 0) {
      toast = `✗ 未找到编码「${kw}」`;
    } else if (data.length > 1) {
      toast = `编码「${kw}」匹配多个，请手动选择`;
    } else {
      const hit = data[0] as unknown as Part;
      setParts((prev) => (prev.some((p) => p.id === hit.id) ? prev : [hit, ...prev]));
      setSelectedIds((prev) => new Set(prev).add(hit.id));
      let newQty = 1;
      setSelectedQtyMap((prev) => { newQty = (prev[hit.id] || 0) + 1; return { ...prev, [hit.id]: newQty }; });
      toast = `✓ 已扫入 ${hit.name} ×${newQty}`;
    }
    setScanToast(toast);
    if (scanToastTimer.current) clearTimeout(scanToastTimer.current);
    scanToastTimer.current = setTimeout(() => setScanToast(""), 2500);
  }, [supabase]);

  // 全局扫码识别：靠输入速度判断——一串字符极快到达(每字符<40ms)且以回车结尾即判为扫码。
  // 手动慢速打字不受影响；扫码时拦截字符避免落入搜索框污染。
  useEffect(() => {
    if (!open || gunMode) return; // 扫码枪手动模式下由专用输入框处理，关闭全局识别避免冲突
    let buffer = "";
    let lastTime = 0;
    let fastCount = 0;
    function onKeyDown(e: KeyboardEvent) {
      const now = Date.now();
      const gap = now - lastTime;
      lastTime = now;
      if (e.key === "Enter") {
        // 快速连击累计足够(≥3)且缓冲够长→判为扫码
        if (buffer.length >= 3 && fastCount >= buffer.length - 1) {
          e.preventDefault();
          const code = buffer;
          buffer = ""; fastCount = 0;
          handleScanCode(code);
        } else {
          buffer = ""; fastCount = 0;
        }
        return;
      }
      if (e.key.length === 1) {
        if (gap > 100) { buffer = ""; fastCount = 0; } // 间隔过大→新序列(手动输入)
        buffer += e.key;
        if (gap < 40) {
          fastCount++;
          // 快速连击(扫码枪)→拦截，避免字符落入搜索框污染
          e.preventDefault();
          e.stopPropagation();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, gunMode, handleScanCode]);

  // 开启扫码枪模式时聚焦专用输入框
  useEffect(() => {
    if (gunMode) setTimeout(() => gunInputRef.current?.focus(), 50);
  }, [gunMode]);

  // 打开时自动查询一次，如果有默认名称搜索词则填入
  useEffect(() => {
    if (open) {
      if (defaultNameQuery && defaultNameQuery.trim()) {
        setNameQuery(defaultNameQuery.trim());
        // 延迟搜索，等待状态更新
        setTimeout(() => {
          doSearchWithName(defaultNameQuery.trim());
        }, 0);
      } else {
        doSearch();
      }
      setSelectedIds(new Set());
      setSelectedQtyMap({});
      setBrandQuery("");
    }
     
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

    // 排序：① 适用本车型（已关联）的配件置顶  ② 其余（含车型内部）按库存数量降序
    result.sort((a, b) => {
      const aLinked = vehicleModelId && linkedPartIds.has(a.id) ? 1 : 0;
      const bLinked = vehicleModelId && linkedPartIds.has(b.id) ? 1 : 0;
      if (aLinked !== bLinked) return bLinked - aLinked; // 车型匹配置顶
      return (b.quantity || 0) - (a.quantity || 0); // 库存数量降序
    });

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
        // 选中不预填数量，数量留空由用户填
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
      // 选中不自动填数量（数量留空，由用户填，或到工单里按实际填）
    }
  }

  // 更新数量：空值 → 移除该键（表示留空）；有效正数 → 记录
  function updateQuantity(id: string, raw: string) {
    setSelectedQtyMap((prev) => {
      const n = { ...prev };
      const num = Number(raw);
      if (raw.trim() === "" || isNaN(num) || num < 1) {
        delete n[id];
      } else {
        n[id] = num;
      }
      return n;
    });
  }

  // 已选配件数据
  const selectedParts = useMemo(() => parts.filter((p) => selectedIds.has(p.id)), [parts, selectedIds]);

  function handleConfirm() {
    const selected = selectedParts.map((p) => ({
      ...p,
      // 不自动填 1：用户没填数量则不传（下游存 null，工单里红框提醒）
      selectedQuantity: selectedQtyMap[p.id],
    }));
    onConfirm(selected);
    setSelectedIds(new Set());
    setSelectedQtyMap({});
  }

  if (!open) return null;

  /* ========== 紧凑模式（移动端） ========== */
  if (compact) {
    return (
      <>
        <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/50">
          <div className="bg-white rounded-t-xl sm:rounded-xl border border-gray-200 w-full max-w-lg sm:mx-4 max-h-[90vh] flex flex-col">
            {/* 标题 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
              <h2 className="text-base font-semibold text-gray-900">选择配件</h2>
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

            {/* 搜索 + 标签 */}
            <div className="px-4 py-3 border-b border-gray-100 space-y-2 shrink-0">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={nameQuery}
                  onChange={(e) => {
                    setNameQuery(e.target.value);
                    if (!e.target.value.trim()) {
                      doSearchWithName("");
                    }
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") doSearchWithName(nameQuery); }}
                  placeholder="搜索配件编码或名称..."
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowBarcodeScanner(true)}
                  className="px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 whitespace-nowrap shrink-0"
                >
                  扫码
                </button>
              </div>

              {/* 快捷标签 */}
              <div className="flex flex-wrap gap-1.5">
                {replacedPartName && (
                  <button
                    type="button"
                    onClick={() => {
                      if (nameQuery === replacedPartName) {
                        setNameQuery("");
                        doSearchWithName("");
                      } else {
                        setNameQuery(replacedPartName);
                        doSearchWithName(replacedPartName);
                      }
                    }}
                    className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                      nameQuery === replacedPartName
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                    }`}
                  >
                    {replacedPartName}
                  </button>
                )}
              </div>
            </div>

            {/* 配件列表 */}
            <div className="flex-1 overflow-y-auto px-4 py-2">
              {loading ? (
                <p className="text-xs text-gray-400 text-center py-4">加载中...</p>
              ) : filteredParts.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">未找到配件</p>
              ) : (
                <div className="space-y-1">
                  {filteredParts.map((part) => {
                    const isLinked = linkedPartIds.has(part.id);
                    const hasStock = part.quantity > 0;
                    const alreadySelected = selectedIds.has(part.id);
                    return (
                      <button
                        key={part.id}
                        type="button"
                        onClick={() => toggleSelect(part.id)}
                        className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                          alreadySelected
                            ? "bg-blue-50 border-blue-300"
                            : isLinked
                              ? "bg-blue-50/50 border-blue-200 hover:bg-blue-100"
                              : "bg-white border-gray-100 hover:bg-gray-50"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-gray-900 truncate">
                              {part.name}
                              {isLinked && (
                                <span className="ml-1 text-xs text-blue-600 font-normal">(匹配车型)</span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5">
                              {part.part_number && <span>编号: {part.part_number} · </span>}
                              库存:{" "}
                              <span className={hasStock ? "text-green-600 font-medium" : "text-red-500"}>
                                {part.quantity}
                              </span>
                            </div>
                          </div>
                          <div className="shrink-0 ml-3 text-right">
                            <div className="text-sm font-medium text-gray-900">
                              ¥{part.unit_price || 0}
                            </div>
                            {alreadySelected && (
                              <div className="text-[10px] text-blue-600">已选择</div>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 已选择区域 */}
            {selectedIds.size > 0 && (
              <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 shrink-0">
                <h3 className="text-sm font-medium text-gray-700 mb-2">
                  已选择 ({selectedIds.size}项)
                </h3>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {selectedParts.map((part) => (
                    <div key={part.id} className="flex items-center gap-2 p-2 rounded-lg border border-gray-200 bg-white">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{part.name}</div>
                        <div className="text-xs text-gray-500">
                          {part.part_number && <span className="mr-1">{part.part_number} ·</span>}
                          库存:{part.quantity}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className="text-xs text-gray-500">数量</span>
                        <input
                          type="number"
                          min={1}
                          value={selectedQtyMap[part.id] ?? ""}
                          onChange={(e) => updateQuantity(part.id, e.target.value)}
                          placeholder="数量"
                          className="w-12 px-1 py-0.5 border border-gray-200 rounded text-xs text-center"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleSelect(part.id)}
                        className="text-xs text-red-600 hover:text-red-700 px-1 flex-shrink-0"
                      >
                        移除
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 底部按钮 */}
            <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-100 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={selectedIds.size === 0}
                className="flex-1 px-4 py-2.5 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                确认添加 ({selectedIds.size})
              </button>
            </div>
          </div>
        </div>

        <BarcodeScanModal
          open={showBarcodeScanner}
          onClose={() => setShowBarcodeScanner(false)}
          onScan={handleBarcodeScan}
        />
      </>
    );
  }

  /* ========== 桌面端默认布局 ========== */
  return (
    <>
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-xl border border-gray-200 w-full max-w-[1400px] mx-4 max-h-[90vh] flex flex-col">
        {/* 标题 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-900">选择配件</h2>
            <span className="inline-flex items-center gap-1 text-xs text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              可直接扫码枪扫码，自动加入并累计数量
            </span>
            {scanToast && (
              <span className={`text-sm font-medium px-2 py-0.5 rounded ${scanToast.startsWith("✓") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                {scanToast}
              </span>
            )}
          </div>
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
              <div className="relative">
                <input
                  type="text"
                  value={partNumber}
                  onChange={(e) => { setPartNumber(e.target.value); setShowPnSuggests(true); }}
                  onFocus={() => setShowPnSuggests(true)}
                  onBlur={() => setTimeout(() => setShowPnSuggests(false), 150)}
                  onKeyDown={(e) => { if (e.key === "Enter") { setShowPnSuggests(false); doSearch(); } }}
                  placeholder="编号/零件号（可扫码枪）"
                  className="w-40 px-3 py-1.5 border border-gray-200 rounded-lg text-sm"
                />
                {showPnSuggests && pnSuggests.length > 0 && (
                  <div className="absolute z-10 mt-1 w-64 max-h-60 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
                    {pnSuggests.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { setPartNumber(s.part_number); setShowPnSuggests(false); doSearch(); }}
                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 border-b border-gray-50 last:border-0"
                      >
                        <span className="font-mono text-blue-700">{s.part_number}</span>
                        <span className="text-xs text-gray-500 ml-2">{s.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 whitespace-nowrap">OE号:</span>
              <input
                type="text"
                value={oeNumberQuery}
                onChange={(e) => setOeNumberQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") doSearch(); }}
                placeholder="OE原厂编码"
                className="w-40 px-3 py-1.5 border border-gray-200 rounded-lg text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 whitespace-nowrap">名称:</span>
              <input
                type="text"
                value={nameQuery}
                onChange={(e) => setNameQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") doSearch(); }}
                placeholder="配件名称"
                className="w-32 px-3 py-1.5 border border-gray-200 rounded-lg text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 whitespace-nowrap">品牌:</span>
              <input
                type="text"
                value={brandQuery}
                onChange={(e) => setBrandQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") doSearch(); }}
                placeholder="品牌"
                className="w-28 px-3 py-1.5 border border-gray-200 rounded-lg text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 whitespace-nowrap">规格/型号:</span>
              <input
                type="text"
                value={specQuery}
                onChange={(e) => setSpecQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") doSearch(); }}
                placeholder="规格/型号"
                className="w-32 px-3 py-1.5 border border-gray-200 rounded-lg text-sm"
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
            <button
              type="button"
              onClick={() => setGunMode((v) => !v)}
              className={`px-4 py-1.5 text-sm rounded-lg border ${gunMode ? "bg-green-600 text-white border-green-600" : "bg-white text-green-700 border-green-300 hover:bg-green-50"}`}
              title="自动识别没认出扫码时，开启此模式，用专用框扫码必中"
            >
              {gunMode ? "扫码枪模式：开" : "扫码枪模式"}
            </button>
          </div>

          {/* 扫码枪手动模式：专用输入框（自动识别的兜底） */}
          {gunMode && (
            <div className="flex items-center gap-2 p-2 rounded-lg border border-green-300 bg-green-50">
              <span className="inline-flex items-center gap-1.5 text-sm text-green-700 shrink-0">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                扫码中…
              </span>
              <input
                ref={gunInputRef}
                type="text"
                value={gunCode}
                onChange={(e) => setGunCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleScanCode(gunCode); setGunCode(""); } }}
                placeholder="扫码枪对准扫，或输入编码后回车"
                className="flex-1 px-3 py-1.5 border border-green-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
              />
            </div>
          )}

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
              <div className="flex items-center gap-3">
                {replacedPartName && (
                  <span className="text-xs px-2.5 py-1 bg-orange-50 text-orange-700 border border-orange-200 rounded-md">
                    替换前: {replacedPartName}
                  </span>
                )}
                <span className="text-sm text-gray-600">
                  已选择 <span className="font-semibold text-blue-600">{selectedIds.size}</span> 个配件
                </span>
              </div>
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
                    <th className="px-3 py-2 text-left font-medium text-gray-500">OE号</th>
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
                      <td colSpan={11} className="px-6 py-12 text-center text-gray-400">
                        加载中...
                      </td>
                    </tr>
                  ) : paginatedParts.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-6 py-12 text-center text-gray-400">
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
                        <td className="px-3 py-2 text-gray-600">{part.oe_number || "-"}</td>
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
                            value={selectedQtyMap[part.id] ?? ""}
                            onChange={(e) => updateQuantity(part.id, e.target.value)}
                            placeholder="数量"
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

    {/* 扫码弹窗 */}
    <BarcodeScanModal
      open={showBarcodeScanner}
      onClose={() => setShowBarcodeScanner(false)}
      onScan={handleBarcodeScan}
    />
  </>
  );
}

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";

interface MatchedPart {
  id: string;
  part_number: string | null;
  barcode: string | null;
  name: string | null;
  unit: string | null;
  unit_cost: number | null;
  unit_price: number | null;
  standard_price: number | null;
  vip_price: number | null;
  purchase_price: number | null;
  part_name_id: string | null;
  brand_id: string | null;
  specification_id: string | null;
  part_brands: { name: string | null } | null;
  part_specifications: { name: string | null } | null;
  part_names: { name: string | null; unit: string | null; part_categories: { name: string | null } | null } | null;
  part_images: { storage_path: string }[] | null;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSelect: (part: MatchedPart) => void;
  onCreateNew: (query: string) => void;
  onClear?: () => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}

export function PartSearchDropdown({
  value,
  onChange,
  onSelect,
  onCreateNew,
  onClear,
  disabled,
  placeholder = "编码/条码",
  className = "",
  inputClassName = "",
}: Props) {
  const supabase = createClient();
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<MatchedPart[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const updatePosition = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropdownPos({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width < 320 ? 320 : rect.width,
    });
  }, []);

  const doSearch = useCallback(async (q: string) => {
    const trimmed = q.trim().toUpperCase();
    if (!trimmed || trimmed.length < 1) {
      setResults([]);
      setShowDropdown(false);
      return;
    }
    setSearching(true);

    const { data, error } = await supabase
      .from("parts")
      .select(
        `id, part_number, barcode, name, unit, unit_cost, unit_price, standard_price, vip_price, purchase_price,
         part_name_id, brand_id, specification_id,
         part_brands(name), part_specifications(name),
         part_names(name, unit, part_categories(name)),
         part_images(storage_path)`
      )
      .or(`part_number.ilike.%${trimmed}%,barcode.ilike.%${trimmed}%`)
      .order("part_number", { ascending: true })
      .limit(10);

    if (error) {
      console.error("配件搜索失败:", error);
      setResults([]);
    } else {
      setResults((data || []) as unknown as MatchedPart[]);
      setShowDropdown(true);
      updatePosition();
    }
    setSearching(false);
    setActiveIndex(-1);
  }, [supabase, updatePosition]);

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);
    onChange(val);

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (!val.trim()) {
      setShowDropdown(false);
      setResults([]);
      return;
    }
    timeoutRef.current = setTimeout(() => {
      doSearch(val);
    }, 300);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showDropdown) {
      if (e.key === "Enter") {
        e.preventDefault();
        doSearch(query);
      }
      return;
    }

    const total = results.length + 1; // +1 for "新建"

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % total);
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((prev) => (prev <= 0 ? total - 1 : prev - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < results.length) {
          selectPart(results[activeIndex]);
        } else if (activeIndex === results.length) {
          handleCreateNew();
        }
        break;
      case "Escape":
        e.preventDefault();
        setShowDropdown(false);
        break;
    }
  }

  function selectPart(part: MatchedPart) {
    setQuery(part.part_number || part.barcode || "");
    onChange(part.part_number || part.barcode || "");
    onSelect(part);
    setShowDropdown(false);
    setActiveIndex(-1);
  }

  function handleCreateNew() {
    onCreateNew(query);
    setShowDropdown(false);
    setActiveIndex(-1);
  }

  function handleClear() {
    setQuery("");
    onChange("");
    setShowDropdown(false);
    setResults([]);
    setActiveIndex(-1);
    onClear?.();
  }

  /* 点击外部关闭下拉 */
  useEffect(() => {
    if (!showDropdown) return;
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showDropdown]);

  /* 滚动/resize 时更新下拉框位置 */
  useEffect(() => {
    if (!showDropdown) return;
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [showDropdown, updatePosition]);

  return (
    <div className={`relative inline-block ${className}`}>
      <input
        ref={inputRef}
        type="text"
        disabled={disabled}
        value={query}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (query.trim().length >= 1 && results.length > 0) {
            setShowDropdown(true);
            updatePosition();
          }
        }}
        placeholder={placeholder}
        className={`px-2 py-1 pr-6 text-xs rounded border focus:outline-none disabled:opacity-50 ${inputClassName}`}
      />
      {query && !disabled && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs leading-none w-4 h-4 flex items-center justify-center"
          title="清除"
        >
          ×
        </button>
      )}
      {searching && !query && (
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">搜索中...</span>
      )}

      {showDropdown && dropdownPos &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: dropdownPos.width,
            }}
            className="fixed z-[100] bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto"
          >
            {results.length === 0 ? (
              <div className="px-3 py-3 text-xs text-gray-400 text-center">
                未找到匹配配件
              </div>
            ) : (
              <>
                {results.map((part, idx) => (
                  <div
                    key={part.id}
                    className={`px-3 py-2 cursor-pointer text-xs border-b border-gray-50 last:border-b-0 ${
                      idx === activeIndex ? "bg-blue-50" : "hover:bg-gray-50"
                    }`}
                    onClick={() => selectPart(part)}
                    onMouseEnter={() => setActiveIndex(idx)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-900">
                        {part.part_number || part.barcode || "无编码"}
                      </span>
                      {part.unit_cost != null && (
                        <span className="text-gray-500">采购¥{part.unit_cost}</span>
                      )}
                    </div>
                    <div className="text-gray-600 mt-0.5">
                      {part.name || part.part_names?.name || "-"}
                    </div>
                    <div className="text-gray-400 mt-0.5 flex gap-2">
                      {part.part_brands?.name && <span>品牌:{part.part_brands.name}</span>}
                      {part.part_specifications?.name && <span>规格:{part.part_specifications.name}</span>}
                      {part.part_names?.part_categories?.name && (
                        <span>分类:{part.part_names.part_categories.name}</span>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* 新建配件按钮 */}
            <div
              className={`px-3 py-2 cursor-pointer text-xs border-t border-dashed border-gray-200 ${
                activeIndex === results.length ? "bg-blue-50" : "hover:bg-gray-50"
              }`}
              onClick={handleCreateNew}
              onMouseEnter={() => setActiveIndex(results.length)}
            >
              <div className="font-medium text-blue-600">+ 新建配件</div>
              <div className="text-gray-400 mt-0.5">
                未找到匹配？使用编码「{query || "-"}」创建新配件
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

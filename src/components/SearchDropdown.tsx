"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useDebounce } from "@/lib/useDebounce";

interface Props<T> {
  searchFn: (query: string) => Promise<T[]>;
  renderItem: (item: T) => React.ReactNode;
  getKey: (item: T) => string;
  onSelect: (item: T) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  dropdownClassName?: string;
  minLength?: number;
  debounceMs?: number;
  emptyText?: string;
  emptyRender?: React.ReactNode;
  /* 已选值的外部受控（2026-08-29 待办#11 收敛需要）：
   * 传了 value 后输入框内容完全由外部控制（选中后外部应把值设为已选项的展示文本）；
   * 不传则组件内部自管（纯搜索选择器用法，选中后清空） */
  value?: string;
  onQueryChange?: (q: string) => void;
  /* 有已选值时显示清除按钮（点清除回调 onClear，由外部清空 value） */
  showClear?: boolean;
  onClear?: () => void;
  /* 有已选值时点击/聚焦输入框也显示下拉列表（配合 value 受控） */
  openOnFocusWithValue?: boolean;
  disabled?: boolean;
  /* 输入框右侧附加内容（如"新建"按钮） */
  suffix?: React.ReactNode;
}

export function SearchDropdown<T>({
  searchFn,
  renderItem,
  getKey,
  onSelect,
  placeholder = "搜索...",
  className = "",
  inputClassName = "",
  dropdownClassName = "",
  minLength = 1,
  debounceMs = 300,
  emptyText = "未找到匹配结果",
  emptyRender,
  value,
  onQueryChange,
  showClear = false,
  onClear,
  openOnFocusWithValue = false,
  disabled = false,
  suffix,
}: Props<T>) {
  /* 受控/非受控双模式：传了 value 就用外部值，否则内部自管 */
  const 受控 = value !== undefined;
  const [内部query, set内部query] = useState("");
  const query = 受控 ? value : 内部query;
  const setQuery = (v: string) => {
    if (受控) onQueryChange?.(v);
    else set内部query(v);
  };

  const [results, setResults] = useState<T[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounce(query, debounceMs);

  const doSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed || trimmed.length < minLength) {
        setResults([]);
        setOpen(false);
        return;
      }
      setLoading(true);
      try {
        const data = await searchFn(trimmed);
        setResults(data);
        setOpen(data.length > 0);
        setActiveIndex(-1);
      } catch {
        setResults([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    },
    [searchFn, minLength]
  );

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);
    setOpen(false);
    if (!val.trim()) {
      setResults([]);
    }
  }

  useEffect(() => {
    doSearch(debouncedQuery);
  }, [debouncedQuery]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === "Enter") {
        e.preventDefault();
        doSearch(query);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % results.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((prev) => (prev <= 0 ? results.length - 1 : prev - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < results.length) {
          selectItem(results[activeIndex]);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
    }
  }

  function selectItem(item: T) {
    onSelect(item);
    setOpen(false);
    setActiveIndex(-1);
  }

  /* 点击外部关闭 */
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  /* 有已选值（受控且有内容）时聚焦也展开下拉（品牌搜索框修复的既有交互，收敛保留） */
  function handleFocus() {
    if (results.length > 0) {
      setOpen(true);
      return;
    }
    if (openOnFocusWithValue && query.trim()) {
      doSearch(query);
    }
  }

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <div className="relative flex items-center">
        <input
          type="text"
          placeholder={placeholder}
          disabled={disabled}
          className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:bg-gray-50 ${showClear || suffix ? "pr-8" : ""} ${inputClassName}`}
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">搜索中...</span>
        )}
        {/* 清除按钮：有内容且开启时显示 */}
        {showClear && !loading && query.trim() && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setResults([]);
              setOpen(false);
              onClear?.();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 text-xs"
            title="清除"
          >
            ✕
          </button>
        )}
        {suffix && <div className="absolute right-2 top-1/2 -translate-y-1/2">{suffix}</div>}
      </div>

      {open && (
        <div
          className={`absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto ${dropdownClassName}`}
        >
          {results.length === 0 ? (
            emptyRender ? (
              <div className="px-4 py-3 text-sm text-gray-400 text-center">{emptyRender}</div>
            ) : (
              <div className="px-4 py-3 text-sm text-gray-400 text-center">{emptyText}</div>
            )
          ) : (
            results.map((item, idx) => (
              <button
                key={getKey(item)}
                type="button"
                onClick={() => selectItem(item)}
                onMouseEnter={() => setActiveIndex(idx)}
                className={`w-full text-left px-4 py-2.5 text-sm border-b border-gray-100 last:border-0 transition-colors ${
                  idx === activeIndex ? "bg-blue-50" : "hover:bg-gray-50"
                }`}
              >
                {renderItem(item)}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

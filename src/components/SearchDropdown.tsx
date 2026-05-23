"use client";

import { useState, useEffect, useRef, useCallback } from "react";

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
}: Props<T>) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<T[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

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
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (!val.trim()) {
      setResults([]);
      return;
    }
    timeoutRef.current = setTimeout(() => doSearch(val), debounceMs);
  }

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

  /* 组件卸载时清理定时器 */
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <input
        type="text"
        placeholder={placeholder}
        className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${inputClassName}`}
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (results.length > 0) setOpen(true);
        }}
      />
      {loading && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">搜索中...</span>
      )}

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

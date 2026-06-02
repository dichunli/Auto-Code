"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { LinkedItem } from "@/components/VehicleModelSelector";
import { PartNameItem } from "./PartNameSearch";

interface IdNameItem {
  id: string;
  name: string;
  linked?: boolean;
}

interface BrandSearchProps {
  selectedBrand: LinkedItem | null;
  onSelectBrand: (item: LinkedItem | null) => void;
  selectedPartName: PartNameItem | null;
}

export default function BrandSearch({
  selectedBrand,
  onSelectBrand,
  selectedPartName,
}: BrandSearchProps) {
  const supabase = createClient();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IdNameItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [focus, setFocus] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    const value = query.trim();
    if (selectedBrand && !focus) {
      setResults(null);
      setSearching(false);
      return;
    }
    if (!focus && !value) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    timeoutRef.current = setTimeout(async () => {
      let linked: IdNameItem[] = [];
      let others: IdNameItem[] = [];

      if (selectedPartName) {
        let linkedQuery = supabase
          .from("part_brands")
          .select("id, name, part_name_brands!inner(part_name_id)")
          .eq("part_name_brands.part_name_id", selectedPartName.id);
        if (value) {
          linkedQuery = linkedQuery.ilike("name", `%${value}%`);
        }
        const { data: linkedData } = await linkedQuery.limit(10);
        linked = (linkedData || []).map((b: unknown) => ({
          id: (b as Record<string, unknown>).id as string,
          name: (b as Record<string, unknown>).name as string,
          linked: true,
        }));
      }

      if (value) {
        const excludeIds = linked.map((b) => b.id);
        let otherQuery = supabase
          .from("part_brands")
          .select("id, name")
          .ilike("name", `%${value}%`);
        if (excludeIds.length > 0)
          otherQuery = otherQuery.not("id", "in", `(${excludeIds.join(",")})`);
        const { data: otherData } = await otherQuery.limit(10);
        others = (otherData || []).map((b: unknown) => ({
          id: (b as Record<string, unknown>).id as string,
          name: (b as Record<string, unknown>).name as string,
          linked: false,
        }));
      }

      setResults([...linked, ...others]);
      setSearching(false);
    }, 300);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [query, selectedPartName, focus, supabase, selectedBrand]);

  async function createBrandAndSelect() {
    const name = query.trim();
    if (!name) return;
    const { data, error } = await supabase
      .from("part_brands")
      .insert({ name })
      .select("id, name")
      .single();
    if (error || !data) {
      alert("创建品牌失败: " + (error?.message || "未知错误"));
      return;
    }
    onSelectBrand({ id: data.id, name: data.name });
    setQuery(data.name);
    setResults(null);
    setHighlightedIndex(-1);
    if (selectedPartName) {
      await supabase
        .from("part_name_brands")
        .insert({ part_name_id: selectedPartName.id, brand_id: data.id })
        .then(({ error }) => {
          if (error && !error.message.includes("duplicate")) console.error(error);
        });
    }
  }

  function selectBrand(item: IdNameItem) {
    onSelectBrand({ id: item.id, name: item.name });
    setQuery(item.name);
    setResults(null);
    setHighlightedIndex(-1);
    if (selectedPartName && !item.linked) {
      supabase
        .from("part_name_brands")
        .insert({ part_name_id: selectedPartName.id, brand_id: item.id })
        .then(({ error }) => {
          if (error && !error.message.includes("duplicate")) console.error(error);
        });
    }
  }

  return (
    <div className="col-span-1">
      <label className="block text-sm font-medium text-gray-700 mb-1">品牌</label>
      <div className="relative">
        <input
          id="brand-input"
          type="text"
          placeholder="搜索品牌（优先显示已关联该配件名称的品牌）"
          className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 text-sm ${
            selectedBrand
              ? "border-green-300 focus:ring-green-500 bg-green-50"
              : "border-gray-300 focus:ring-blue-500"
          }`}
          value={selectedBrand ? selectedBrand.name : query}
          onChange={(e) => {
            const val = e.target.value;
            setQuery(val);
            setHighlightedIndex(-1);
            if (selectedBrand && val !== selectedBrand.name) {
              onSelectBrand(null);
            }
          }}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 200)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlightedIndex((prev) => {
                const next = prev + 1;
                return results && next < results.length ? next : prev;
              });
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : prev));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (results && highlightedIndex >= 0 && highlightedIndex < results.length) {
                selectBrand(results[highlightedIndex]);
              } else if (results && results.length > 0) {
                selectBrand(results[0]);
              }
              setTimeout(() => document.getElementById("spec-input")?.focus(), 0);
            } else if (e.key === "Escape") {
              setResults(null);
              setHighlightedIndex(-1);
            } else if (e.key === "Tab") {
              setResults(null);
              setHighlightedIndex(-1);
            }
          }}
        />
        {selectedBrand && (
          <button
            type="button"
            onClick={() => {
              onSelectBrand(null);
              setQuery("");
              setResults(null);
              document.getElementById("brand-input")?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-green-600 bg-green-100 px-1.5 py-0.5 rounded hover:bg-green-200"
          >
            已选 ×
          </button>
        )}
        {searching && <div className="text-xs text-gray-400 mt-1">检索中...</div>}
        {results && results.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
            {results.map((b, index) => (
              <button
                key={b.id}
                type="button"
                onClick={() => selectBrand(b)}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0 flex items-center justify-between ${
                  highlightedIndex === index ? "bg-blue-50" : ""
                }`}
              >
                <span>{b.name}</span>
                {b.linked && (
                  <span className="text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded">已关联</span>
                )}
              </button>
            ))}
          </div>
        )}
        {!searching && query.trim() && results !== null && results.length === 0 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={createBrandAndSelect}
              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
            >
              新建品牌「{query.trim()}」并选择
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

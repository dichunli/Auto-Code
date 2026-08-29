"use client";

import {useState, useEffect, useMemo} from "react";
import { createClient } from "@/lib/supabase/client";
import { useDebounce } from "@/lib/useDebounce";
import { 清理搜索词 } from "@/lib/sanitizeQuery";

export interface PartNameItem {
  id: string;
  name: string;
  unit?: string;
  part_categories?: Record<string, unknown> | Record<string, unknown>[];
  auto_link_vehicle_model?: boolean;
  is_consumable?: boolean;
  sales_commission_type?: string;
  sales_commission_value?: number;
  diagnosis_commission_type?: string;
  diagnosis_commission_value?: number;
  repair_commission_type?: string;
  repair_commission_value?: number;
  qc_commission_type?: string;
  qc_commission_value?: number;
  picking_commission_type?: string;
  picking_commission_value?: number;
  [key: string]: unknown;
}

export interface CommissionFillData {
  name: string;
  unit: string;
  categoryName: string;
  auto_link_vehicle_model: boolean;
  is_consumable: boolean;
  sales_type: string;
  sales_value: string;
  diagnosis_type: string;
  diagnosis_value: string;
  repair_type: string;
  repair_value: string;
  qc_type: string;
  qc_value: string;
  picking_type: string;
  picking_value: string;
}

interface PartNameSearchProps {
  selectedPartName: PartNameItem | null;
  onSelectPartName: (item: PartNameItem | null) => void;
  onCommissionFill: (data: CommissionFillData) => void;
  onClearCommission: () => void;
}

export default function PartNameSearch({
  selectedPartName,
  onSelectPartName,
  onCommissionFill,
  onClearCommission,
}: PartNameSearchProps) {
  const supabase = useMemo(() => createClient(), []);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PartNameItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    const value = debouncedQuery.trim();
    if (selectedPartName && value === selectedPartName.name) {
      setResults(null);
      setSearching(false);
      return;
    }
    if (!value) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    async function doSearch() {
      const { data } = await supabase
        .from("part_names")
        .select(
          `id, name, unit, search_keywords,
           auto_link_vehicle_model, is_consumable,
           sales_commission_type, sales_commission_value,
           diagnosis_commission_type, diagnosis_commission_value,
           repair_commission_type, repair_commission_value,
           qc_commission_type, qc_commission_value,
           picking_commission_type, picking_commission_value,
           part_categories(id, name,
             auto_link_vehicle_model, is_consumable,
             sales_commission_type, sales_commission_value,
             diagnosis_commission_type, diagnosis_commission_value,
             repair_commission_type, repair_commission_value,
             qc_commission_type, qc_commission_value,
             picking_commission_type, picking_commission_value
           )`
        )
        .or(`name.ilike.%${清理搜索词(value)}%,search_keywords.ilike.%${清理搜索词(value)}%`)
        .order("name")
        .limit(10);
      setResults(data || []);
      setSearching(false);
    }
    doSearch();
  }, [debouncedQuery, supabase, selectedPartName]);

  function selectItem(item: PartNameItem) {
    onSelectPartName(item);
    setQuery(item.name);
    setResults(null);
    setHighlightedIndex(-1);

    const rawCat = item.part_categories;
    const cat = Array.isArray(rawCat) ? (rawCat[0] || {}) : (rawCat || {});

    const autoLink = item.auto_link_vehicle_model || (cat as Record<string, unknown>).auto_link_vehicle_model || false;
    const consumable = item.is_consumable || (cat as Record<string, unknown>).is_consumable || false;

    const pick = (nameVal: unknown, catVal: unknown) =>
      nameVal !== null && nameVal !== undefined ? nameVal : catVal;

    onCommissionFill({
      name: item.name,
      unit: item.unit || "件",
      categoryName: (cat as Record<string, unknown>).name as string || "",
      auto_link_vehicle_model: autoLink as boolean,
      is_consumable: consumable as boolean,
      sales_type: pick(item.sales_commission_type, (cat as Record<string, unknown>).sales_commission_type)?.toString() || "",
      sales_value: pick(item.sales_commission_value, (cat as Record<string, unknown>).sales_commission_value)?.toString() || "",
      diagnosis_type: pick(item.diagnosis_commission_type, (cat as Record<string, unknown>).diagnosis_commission_type)?.toString() || "",
      diagnosis_value: pick(item.diagnosis_commission_value, (cat as Record<string, unknown>).diagnosis_commission_value)?.toString() || "",
      repair_type: pick(item.repair_commission_type, (cat as Record<string, unknown>).repair_commission_type)?.toString() || "",
      repair_value: pick(item.repair_commission_value, (cat as Record<string, unknown>).repair_commission_value)?.toString() || "",
      qc_type: pick(item.qc_commission_type, (cat as Record<string, unknown>).qc_commission_type)?.toString() || "",
      qc_value: pick(item.qc_commission_value, (cat as Record<string, unknown>).qc_commission_value)?.toString() || "",
      picking_type: pick(item.picking_commission_type, (cat as Record<string, unknown>).picking_commission_type)?.toString() || "",
      picking_value: pick(item.picking_commission_value, (cat as Record<string, unknown>).picking_commission_value)?.toString() || "",
    });
  }

  function handleInputChange(val: string) {
    setQuery(val);
    setHighlightedIndex(-1);
    if (selectedPartName && val !== selectedPartName.name) {
      onSelectPartName(null);
      onClearCommission();
    }
  }

  return (
    <div className="relative sm:col-span-2">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        配件名称 <span className="text-red-500">*</span>
      </label>
      <div className="relative">
        <input
          id="part-name-input"
          type="text"
          placeholder="输入名称或关键词检索"
          className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 text-sm ${
            selectedPartName
              ? "border-green-300 focus:ring-green-500 bg-green-50"
              : "border-gray-300 focus:ring-blue-500"
          }`}
          value={selectedPartName ? selectedPartName.name : query}
          onChange={(e) => handleInputChange(e.target.value)}
          onBlur={() => setTimeout(() => setResults(null), 200)}
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
                selectItem(results[highlightedIndex]);
                setHighlightedIndex(-1);
                document.getElementById("document-name-input")?.focus();
              } else if (results && results.length > 0) {
                selectItem(results[0]);
                setHighlightedIndex(-1);
                document.getElementById("document-name-input")?.focus();
              }
            } else if (e.key === "Escape") {
              setResults(null);
              setHighlightedIndex(-1);
            }
          }}
        />
        {selectedPartName && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-green-600 bg-green-100 px-1.5 py-0.5 rounded">
            已选
          </span>
        )}
        {searching && <div className="text-xs text-gray-400 mt-1">检索中...</div>}
        {results && results.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
            {results.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  selectItem(item);
                  setHighlightedIndex(-1);
                  document.getElementById("document-name-input")?.focus();
                }}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0 ${
                  highlightedIndex === index ? "bg-blue-50" : ""
                }`}
              >
                <div className="font-medium text-gray-900">{item.name}</div>
                <div className="text-xs text-gray-400">
                  {String((Array.isArray(item.part_categories) ? item.part_categories[0]?.name : item.part_categories?.name) || "-")} · {item.unit || "件"}
                </div>
              </button>
            ))}
          </div>
        )}
        {!searching && query.trim() && results !== null && results.length === 0 && (
          <div className="mt-2 text-xs text-gray-500">
            未找到匹配名称，请先前往{" "}
            <a href="/part-names/new" target="_blank" className="text-blue-600 hover:underline">
              名称库
            </a>{" "}
            新建
          </div>
        )}
      </div>
    </div>
  );
}

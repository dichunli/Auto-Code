"use client";

import {useState, useEffect, useRef, useMemo} from "react";
import { createClient } from "@/lib/supabase/client";
import { LinkedItem } from "@/components/VehicleModelSelector";
import { PartNameItem } from "./PartNameSearch";

interface SpecSearchProps {
  selectedSpecs: LinkedItem[];
  onSelectSpecsChange: (items: LinkedItem[]) => void;
  selectedPartName: PartNameItem | null;
}

export default function SpecSearch({
  selectedSpecs,
  onSelectSpecsChange,
  selectedPartName,
}: SpecSearchProps) {
  const supabase = useMemo(() => createClient(), []);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; name: string }[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    const value = query.trim();
    if (!value || !selectedPartName) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    timeoutRef.current = setTimeout(async () => {
      const { data: linkedData } = await supabase
        .from("part_specifications")
        .select("id, name, part_name_specifications!inner(part_name_id)")
        .ilike("name", `%${value}%`)
        .eq("part_name_specifications.part_name_id", selectedPartName.id)
        .limit(10);
      const linked = (linkedData || [])
        .map((s: unknown) => ({
          id: (s as Record<string, unknown>).id as string,
          name: (s as Record<string, unknown>).name as string,
        }))
        .filter((s: { id: string; name: string }) =>
          !selectedSpecs.some((sel) => sel.id === s.id)
        );

      setResults(linked);
      setSearching(false);
    }, 300);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [query, selectedPartName, selectedSpecs, supabase]);

  async function createSpecAndAdd() {
    const name = query.trim();
    if (!name) return;
    const { data, error } = await supabase
      .from("part_specifications")
      .insert({ name })
      .select("id, name")
      .single();
    if (error || !data) {
      alert("创建规格失败: " + (error?.message || "未知错误"));
      return;
    }
    addSpec({ id: data.id, name: data.name });
    if (selectedPartName) {
      await supabase
        .from("part_name_specifications")
        .insert({ part_name_id: selectedPartName.id, specification_id: data.id })
        .then(({ error }) => {
          if (error && !error.message.includes("duplicate")) console.error(error);
        });
    }
  }

  function addSpec(item: LinkedItem) {
    if (selectedSpecs.some((s) => s.id === item.id)) return;
    onSelectSpecsChange([...selectedSpecs, item]);
    setQuery("");
    setResults(null);
    setHighlightedIndex(-1);
    setTimeout(() => document.getElementById("spec-input")?.focus(), 0);
    if (selectedPartName) {
      supabase
        .from("part_name_specifications")
        .insert({
          part_name_id: (selectedPartName as Record<string, unknown>).id,
          specification_id: item.id,
        })
        .then(({ error }) => {
          if (error && !error.message.includes("duplicate")) console.error(error);
        });
    }
  }

  function removeSpec(id: string) {
    onSelectSpecsChange(selectedSpecs.filter((s) => s.id !== id));
  }

  return (
    <div className="col-span-5">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        规格（可添加多个）
      </label>
      <div className="relative">
        <input
          id="spec-input"
          type="text"
          placeholder="搜索规格（优先显示已关联该配件名称的规格）"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlightedIndex(-1);
          }}
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
              if (
                results &&
                highlightedIndex >= 0 &&
                highlightedIndex < results.length
              ) {
                addSpec(results[highlightedIndex]);
              } else if (results && results.length > 0) {
                addSpec(results[0]);
              }
            } else if (e.key === "Escape") {
              setResults(null);
              setHighlightedIndex(-1);
            } else if (e.key === "Tab") {
              setResults(null);
              setHighlightedIndex(-1);
              setTimeout(
                () => document.getElementById("purchase-price-input")?.focus(),
                0
              );
            }
          }}
        />
        {searching && <div className="text-xs text-gray-400 mt-1">检索中...</div>}
        {results && results.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
            {results.map((s, index) => (
              <button
                key={s.id}
                type="button"
                onClick={() => addSpec(s)}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0 flex items-center justify-between ${
                  highlightedIndex === index ? "bg-blue-50" : ""
                }`}
              >
                <span>{s.name}</span>
              </button>
            ))}
          </div>
        )}
        {!searching &&
          query.trim() &&
          results !== null &&
          results.length === 0 && (
            <div className="mt-2">
              <button
                type="button"
                onClick={createSpecAndAdd}
                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
              >
                新建规格「{query.trim()}」并添加
              </button>
            </div>
          )}
      </div>
      {selectedSpecs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {selectedSpecs.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-md border border-blue-200"
            >
              {s.name}
              <button
                type="button"
                onClick={() => removeSpec(s.id)}
                className="text-blue-400 hover:text-blue-600"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

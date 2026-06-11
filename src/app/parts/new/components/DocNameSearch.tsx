"use client";

import {useState, useEffect, useMemo} from "react";
import { createClient } from "@/lib/supabase/client";
import { useDebounce } from "@/lib/useDebounce";

interface DocNameSearchProps {
  value: string;
  onChange: (value: string) => void;
}

export default function DocNameSearch({ value, onChange }: DocNameSearchProps) {
  const supabase = useMemo(() => createClient(), []);

  const [results, setResults] = useState<string[] | null>(null);
  const [searching, setSearching] = useState(false);
  const debouncedValue = useDebounce(value, 300);

  useEffect(() => {
    const searchValue = debouncedValue.trim();
    if (!searchValue) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    async function doSearch() {
      const { data } = await supabase
        .from("parts")
        .select("document_name")
        .not("document_name", "is", null)
        .ilike("document_name", "%" + searchValue + "%")
        .limit(10);
      const names = Array.from(
        new Set(
          (data || [])
            .map((d: unknown) => (d as Record<string, unknown>).document_name)
            .filter(Boolean)
        )
      ) as string[];
      setResults(names);
      setSearching(false);
    }
    doSearch();
  }, [debouncedValue, supabase]);

  return (
    <div className="relative sm:col-span-2">
      <label className="block text-sm font-medium text-gray-700 mb-1">单据名称</label>
      <div className="relative">
        <input
          id="document-name-input"
          type="text"
          placeholder="输入采购单上的配件名称，可直接输入或从历史调用"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              document.getElementById("brand-input")?.focus();
            }
          }}
        />
        {searching && <div className="text-xs text-gray-400 mt-1">检索中...</div>}
        {results && results.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
            {results.map((name, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  onChange(name);
                  setResults(null);
                }}
                className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

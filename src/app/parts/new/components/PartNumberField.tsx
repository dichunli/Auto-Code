"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

interface PartSearchResult {
  id: string;
  part_number: string;
  name: string;
}

interface PartNumberFieldProps {
  value: string;
  onChange: (value: string) => void;
  editId?: string | null;
  onHasDuplicateChange?: (hasDuplicate: boolean) => void;
}

export default function PartNumberField({
  value,
  onChange,
  editId,
  onHasDuplicateChange,
}: PartNumberFieldProps) {
  const supabase = createClient();
  const [pnResults, setPnResults] = useState<PartSearchResult[] | null>(null);
  const [pnSearching, setPnSearching] = useState(false);
  const pnTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced search
  useEffect(() => {
    if (pnTimeoutRef.current) clearTimeout(pnTimeoutRef.current);
    const searchValue = value.trim().toUpperCase().replace(/\s+/g, "");
    if (!searchValue) {
      setPnResults(null);
      setPnSearching(false);
      if (onHasDuplicateChange) onHasDuplicateChange(false);
      return;
    }
    setPnSearching(true);
    pnTimeoutRef.current = setTimeout(async () => {
      let query = supabase
        .from("parts")
        .select("id, part_number, name")
        .ilike("part_number", `%${searchValue}%`)
        .limit(5);
      if (editId) {
        query = query.neq("id", editId);
      }
      const { data } = await query;
      const results = data || [];
      setPnResults(results);
      setPnSearching(false);
      if (onHasDuplicateChange) {
        const hasDup = results.some((r) => r.part_number.toUpperCase().replace(/\s+/g, "") === searchValue);
        onHasDuplicateChange(hasDup);
      }
    }, 300);
    return () => {
      if (pnTimeoutRef.current) clearTimeout(pnTimeoutRef.current);
    };
  }, [value, supabase, editId, onHasDuplicateChange]);

  function handleChange(input: string) {
    if (/[一-龥]/.test(input)) return;
    if (input.length > 20) return;
    onChange(input.toUpperCase());
  }

  const hasDuplicate =
    pnResults !== null &&
    pnResults.some((r) => r.part_number.toUpperCase().replace(/\s+/g, "") === value.trim().toUpperCase().replace(/\s+/g, ""));

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        配件编码 <span className="text-red-500">*</span>
      </label>
      <input
        type="text"
        maxLength={20}
        placeholder="输入编码（大写英文、数字、符号，不含中文）"
        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 text-sm ${
          hasDuplicate
            ? "border-red-300 focus:ring-red-500 bg-red-50"
            : "border-gray-300 focus:ring-blue-500"
        }`}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            document.getElementById("part-name-input")?.focus();
          }
        }}
      />
      {pnSearching && <div className="text-xs text-gray-400 mt-1">检索中...</div>}
      {!pnSearching && pnResults !== null && pnResults.length > 0 && (
        <div className="mt-2 bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-red-600 font-medium mb-1">以下配件编码与输入匹配，请避免重复：</p>
          <div className="space-y-1">
            {pnResults.map((r) => (
              <div key={r.id} className="text-sm text-red-700">
                {r.part_number} — {r.name}
              </div>
            ))}
          </div>
        </div>
      )}
      {!pnSearching && pnResults !== null && pnResults.length === 0 && value.trim().length > 0 && (
        <div className="mt-1 text-xs text-green-600">该编码可用</div>
      )}
    </div>
  );
}

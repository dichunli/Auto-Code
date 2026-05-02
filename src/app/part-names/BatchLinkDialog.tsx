"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

interface Props {
  open: boolean;
  type: "brand" | "specification";
  selectedIds: string[];
  onClose: () => void;
  onSuccess: () => void;
}

export function BatchLinkDialog({ open, type, selectedIds, onClose, onSuccess }: Props) {
  const supabase = createClient();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState(false);

  const isBrand = type === "brand";
  const title = isBrand ? "批量关联品牌" : "批量关联规格";
  const placeholder = isBrand ? "搜索品牌名称..." : "搜索规格名称...";
  const table = isBrand ? "part_brands" : "part_specifications";
  const linkTable = isBrand ? "part_name_brands" : "part_name_specifications";
  const idColumn = isBrand ? "brand_id" : "specification_id";

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      if (!query.trim()) {
        setResults([]);
        return;
      }
      setSearching(true);
      const { data } = await supabase
        .from(table)
        .select("id, name")
        .ilike("name", `%${query.trim()}%`)
        .order("name")
        .limit(10);
      setResults(data || []);
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [query, open, supabase, table]);

  async function handleLink(targetId: string) {
    if (selectedIds.length === 0) return;
    setLinking(true);

    for (const partNameId of selectedIds) {
      const { error } = await supabase
        .from(linkTable)
        .upsert({ part_name_id: partNameId, [idColumn]: targetId }, { onConflict: "part_name_id,${idColumn}" });
      if (error && !error.message.includes("duplicate")) {
        alert(`关联失败: ${error.message}`);
        setLinking(false);
        return;
      }
    }

    setLinking(false);
    onSuccess();
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-md">
        <h3 className="text-base font-semibold text-gray-900 mb-1">{title}</h3>
        <p className="text-sm text-gray-500 mb-4">已选择 {selectedIds.length} 个配件名称，搜索并选择要关联的{isBrand ? "品牌" : "规格"}：</p>

        <div className="relative mb-3">
          <input
            autoFocus
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {searching && <div className="text-xs text-gray-400 mt-1">搜索中...</div>}
          {results.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => handleLink(r.id)}
                  disabled={linking}
                  className="w-full text-left px-4 py-2.5 hover:bg-gray-50 disabled:opacity-50 border-b border-gray-100 last:border-0"
                >
                  <span className="text-sm text-gray-900">{r.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";

interface LinkedItem {
  id: string;
  name: string;
}

interface Props {
  label: string;
  query: string;
  setQuery: (q: string) => void;
  results: any[] | null;
  searching: boolean;
  linked: LinkedItem[];
  onAdd: (item: LinkedItem) => void;
  onRemove: (id: string) => void;
  onCreate: () => void;
}

export function SearchLinkSection({
  label,
  query,
  setQuery,
  results,
  searching,
  linked,
  onAdd,
  onRemove,
  onCreate,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelectedIds(new Set());
  }, [results]);

  const alreadyLinkedIds = new Set(linked.map((x) => x.id));

  function toggleResult(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  function handleAddSelected() {
    if (!results) return;
    for (const r of results) {
      if (selectedIds.has(r.id) && !alreadyLinkedIds.has(r.id)) {
        onAdd(r);
      }
    }
    setSelectedIds(new Set());
    setQuery("");
  }

  return (
    <div className="mt-6">
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}（可选，可关联多个）</label>
      <div className="relative">
        <input
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder={`搜索${label}并添加...`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {searching && <div className="text-xs text-gray-400 mt-1">搜索中...</div>}
        {results && results.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
            {results.map((r: any) => {
              const isLinked = alreadyLinkedIds.has(r.id);
              const isSelected = selectedIds.has(r.id);
              return (
                <label
                  key={r.id}
                  className={`flex items-center gap-2 px-4 py-2 border-b border-gray-100 last:border-0 cursor-pointer hover:bg-gray-50 ${isLinked ? "opacity-40" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={isLinked}
                    onChange={() => toggleResult(r.id)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-gray-900">{r.name}</span>
                </label>
              );
            })}
            {selectedIds.size > 0 && (
              <div className="sticky bottom-0 bg-white border-t border-gray-100 px-4 py-2">
                <button
                  type="button"
                  onClick={handleAddSelected}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
                >
                  添加选中 ({selectedIds.size})
                </button>
              </div>
            )}
          </div>
        )}
        {!searching && query.trim() && results !== null && results.length === 0 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={onCreate}
              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
            >
              新建「{query.trim()}」并关联
            </button>
          </div>
        )}
      </div>
      {linked.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {linked.map((item) => (
            <span
              key={item.id}
              className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-md border border-blue-200"
            >
              {item.name}
              <button
                type="button"
                onClick={() => onRemove(item.id)}
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

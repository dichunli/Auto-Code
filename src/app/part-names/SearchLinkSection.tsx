"use client";

import { useState } from "react";
import { SearchDropdown } from "@/components/SearchDropdown";

interface LinkedItem {
  id: string;
  name: string;
}

interface Props {
  label: string;
  query: string;
  setQuery: (q: string) => void;
  /* 联想查询：调用方把原来的防抖查询条件包成 searchFn 传入（SearchDropdown 内部统一防抖） */
  searchFn: (q: string) => Promise<LinkedItem[]>;
  linked: LinkedItem[];
  onAdd: (item: LinkedItem) => void;
  onRemove: (id: string) => void;
  onCreate: () => void;
}

/* 关联品牌/规格搜索块：SearchDropdown（单选添加）+ 已关联标签 + 无结果时的"新建并关联"按钮 */
export function SearchLinkSection({
  label,
  query,
  setQuery,
  searchFn,
  linked,
  onAdd,
  onRemove,
  onCreate,
}: Props) {
  /* 记录最近一次查询是否无结果（用于决定"新建"按钮是否显示，与原逻辑一致：只有搜不到才给新建入口） */
  const [lastResultsEmpty, setLastResultsEmpty] = useState(false);

  function handleQueryChange(q: string) {
    /* 查询词变化后、防抖查询完成前，先隐藏新建按钮，避免误点 */
    setLastResultsEmpty(false);
    setQuery(q);
  }

  async function 包装查询(q: string): Promise<LinkedItem[]> {
    const data = await searchFn(q);
    setLastResultsEmpty(data.length === 0);
    return data;
  }

  return (
    <div className="mt-6">
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}（可选，可关联多个）</label>
      <SearchDropdown<LinkedItem>
        value={query}
        onQueryChange={handleQueryChange}
        searchFn={包装查询}
        getKey={(item) => item.id}
        onSelect={onAdd}
        placeholder={`搜索${label}并添加...`}
        renderItem={(item) => (
          <span className={`text-sm text-gray-900 ${linked.some((x) => x.id === item.id) ? "opacity-40" : ""}`}>
            {item.name}
          </span>
        )}
        suffix={
          query.trim() && lastResultsEmpty ? (
            <button
              type="button"
              onClick={onCreate}
              className="px-2 py-0.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 whitespace-nowrap"
              title={`新建「${query.trim()}」并关联`}
            >
              新建
            </button>
          ) : undefined
        }
      />
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

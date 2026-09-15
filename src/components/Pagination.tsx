"use client";

/* 通用翻页控件（2026-09-15 待办列表分页抽出，样式与 PartPickerModal 内联版一致）
 * 受控组件：page/totalCount/pageSize 由父组件持有，切页走 onChange。
 * 仅当总页数 > 1 时渲染，单页数据不打扰。 */
interface PaginationProps {
  page: number;
  totalCount: number;
  pageSize: number;
  onChange: (page: number) => void;
}

export function Pagination({ page, totalCount, pageSize, onChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  /* 父组件数据未回来时 page 可能越界，钳制显示（不反向改父状态） */
  const safePage = Math.min(Math.max(1, page), totalPages);
  if (totalPages <= 1) return null;

  return (
    <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-center gap-1">
      <button
        onClick={() => onChange(Math.max(1, safePage - 1))}
        disabled={safePage <= 1}
        className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
      >
        上一页
      </button>
      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
        let p = i + 1;
        if (totalPages > 5 && safePage > 3) {
          p = safePage - 3 + i;
          if (p > totalPages - 4) p = totalPages - 4 + i;
        }
        if (p > totalPages) return null;
        return (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={`px-3 py-1 text-sm rounded ${
              p === safePage ? "bg-blue-600 text-white" : "border border-gray-300 hover:bg-gray-50"
            }`}
          >
            {p}
          </button>
        );
      })}
      {totalPages > 5 && safePage < totalPages - 2 && <span className="px-1 text-gray-400">...</span>}
      {totalPages > 5 && safePage < totalPages - 2 && (
        <button
          onClick={() => onChange(totalPages)}
          className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50"
        >
          {totalPages}
        </button>
      )}
      <button
        onClick={() => onChange(Math.min(totalPages, safePage + 1))}
        disabled={safePage >= totalPages}
        className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
      >
        下一页
      </button>
      <span className="ml-3 text-sm text-gray-500">{pageSize} 条/页</span>
      <span className="ml-2 text-sm text-gray-500">
        {totalCount} 条记录，共 {totalPages} 页
      </span>
    </div>
  );
}

"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useDebounce } from "@/lib/useDebounce";

interface WorkOrderSearchProps {
  keyword: string;
}

export default function WorkOrderSearch({ keyword: initialKeyword }: WorkOrderSearchProps) {
  const router = useRouter();
  const [keyword, setKeyword] = useState(initialKeyword);
  const isFirstRender = useRef(true);
  const debouncedKeyword = useDebounce(keyword, 300);

  /* 同步 URL 参数变化 */
  useEffect(() => {
    setKeyword(initialKeyword);
  }, [initialKeyword]);

  /* 防抖搜索：输入停止 300ms 后自动提交 */
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const params = new URLSearchParams(window.location.search);
    params.set("page", "1");
    if (debouncedKeyword.trim()) {
      params.set("keyword", debouncedKeyword.trim());
    } else {
      params.delete("keyword");
    }
    const qs = params.toString();
    router.push(qs ? `/work-orders?${qs}` : "/work-orders");
  }, [debouncedKeyword, router]);

  return (
    <div className="relative">
      <input
        type="text"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="搜索工单号、车牌号、VIN、客户名称、电话、单位..."
        className="w-full sm:w-80 pl-10 pr-4 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
      {keyword && (
        <button
          type="button"
          onClick={() => setKeyword("")}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

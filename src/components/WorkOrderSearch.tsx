"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function WorkOrderSearch() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const status = searchParams.get("status") || "";
  const [keyword, setKeyword] = useState(searchParams.get("keyword") || "");

  const doSearch = useCallback(
    (value: string) => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (value.trim()) params.set("keyword", value.trim());
      router.push(`/work-orders?${params.toString()}`);
    },
    [router, status]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      const current = searchParams.get("keyword") || "";
      if (keyword !== current) {
        doSearch(keyword);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [keyword, searchParams, doSearch]);

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

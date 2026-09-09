"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useDebounce } from "@/lib/useDebounce";

/* 待领料搜索框：防抖 300ms 后跳转 ?q= 由服务端过滤（工单号/车牌/客户/配件名/编码） */
export function PickingSearchBar({ 初始值 }: { 初始值: string }) {
  const router = useRouter();
  const [关键词, set关键词] = useState(初始值);
  const 防抖关键词 = useDebounce(关键词, 300);

  /* 输入防抖后更新 URL（保留在待领料 Tab，清空时去掉 q 参数） */
  useEffect(() => {
    const kw = 防抖关键词.trim();
    if (kw === 初始值.trim()) return;
    router.replace(kw ? `/picking?tab=pending_pick&q=${encodeURIComponent(kw)}` : "/picking?tab=pending_pick");

  }, [防抖关键词]);  

  return (
    <input
      type="text"
      value={关键词}
      onChange={(e) => set关键词(e.target.value)}
      placeholder="搜索工单号 / 车牌 / 厂家品牌车型 / 车主姓名电话"
      className="w-full max-w-md px-3 py-2 mb-4 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:border-blue-400"
    />
  );
}

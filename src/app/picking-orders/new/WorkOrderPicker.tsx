"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { 工单概要 } from "./page";

/* 选择要开领料单的工单（只列出有待领料配件的工单） */
export default function WorkOrderPicker({ 工单列表 }: { 工单列表: (工单概要 & { 待领件数: number })[] }) {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");

  const 过滤后 = useMemo(() => {
    const kw = keyword.trim();
    if (!kw) return 工单列表;
    return 工单列表.filter(
      (w) => w.order_no.includes(kw) || w.车牌.includes(kw.toUpperCase()) || w.客户.includes(kw)
    );
  }, [工单列表, keyword]);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">开领料单 - 选择工单</h1>
        <Link href="/picking-orders" className="text-sm text-blue-600 hover:text-blue-700">
          ← 返回领料单列表
        </Link>
      </div>

      <input
        type="text"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="搜索工单号 / 车牌 / 客户"
        className="w-full px-3 py-2 mb-4 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-blue-400"
      />

      {过滤后.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          没有待领料的工单（配件到货并关联库存后才会出现在这里）
        </div>
      ) : (
        <div className="space-y-2">
          {过滤后.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => router.push(`/picking-orders/new?work_order_id=${w.id}`)}
              className="w-full bg-white rounded-xl border border-gray-200 px-5 py-4 flex items-center justify-between hover:border-blue-400 transition-colors text-left"
            >
              <div>
                <div className="font-medium text-gray-900">{w.order_no}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {w.车牌} · {w.客户}
                </div>
              </div>
              <div className="text-xs px-2 py-1 rounded bg-purple-50 text-purple-600 border border-purple-200">
                待领 {w.待领件数} 件
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

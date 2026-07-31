"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { 领料单概要 } from "./page";

/* 选择要退料的领料单（只列出还有可退配件的） */
export default function PickingOrderPicker({
  领料单列表,
}: {
  领料单列表: (领料单概要 & { 可退件数: number })[];
}) {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");

  const 过滤后 = useMemo(() => {
    const kw = keyword.trim();
    if (!kw) return 领料单列表;
    return 领料单列表.filter(
      (o) => o.picking_no.includes(kw) || o.工单号.includes(kw) || o.车牌.includes(kw.toUpperCase())
    );
  }, [领料单列表, keyword]);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">开退料单 - 选择领料单</h1>
        <Link href="/material-returns" className="text-sm text-blue-600 hover:text-blue-700">
          ← 返回退料单列表
        </Link>
      </div>

      <input
        type="text"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="搜索领料单号 / 工单号 / 车牌"
        className="w-full px-3 py-2 mb-4 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-blue-400"
      />

      {过滤后.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          没有可退料的领料单（领料后未全退的才会出现在这里）
        </div>
      ) : (
        <div className="space-y-2">
          {过滤后.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => router.push(`/material-returns/new?picking_order_id=${o.id}`)}
              className="w-full bg-white rounded-xl border border-gray-200 px-5 py-4 flex items-center justify-between hover:border-blue-400 transition-colors text-left"
            >
              <div>
                <div className="font-medium text-gray-900">{o.picking_no}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  工单 {o.工单号} · {o.车牌} · {new Date(o.created_at).toLocaleDateString("zh-CN")}
                </div>
              </div>
              <div className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 border border-red-200">
                可退 {o.可退件数} 件
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

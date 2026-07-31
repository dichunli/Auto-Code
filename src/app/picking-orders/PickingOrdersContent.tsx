"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { 领料单 } from "./page";

const PAGE_SIZE = 15;

export default function PickingOrdersContent({ initialRecords }: { initialRecords: 领料单[] }) {
  const [orders] = useState<领料单[]>(initialRecords);
  const [keyword, setKeyword] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const filteredOrders = useMemo(() => {
    let list = orders;
    const kw = keyword.trim();
    if (kw) {
      list = list.filter(
        (o) =>
          o.picking_no.includes(kw) ||
          (o.work_orders?.order_no || "").includes(kw) ||
          (o.receiver_name || "").includes(kw)
      );
    }
    if (dateFrom) {
      list = list.filter((o) => o.created_at >= `${dateFrom}T00:00:00`);
    }
    if (dateTo) {
      list = list.filter((o) => o.created_at <= `${dateTo}T23:59:59`);
    }
    return list;
  }, [orders, keyword, dateFrom, dateTo]);

  /* 筛选条件变化时重置页码 */
  useEffect(() => {
    setPage(1);
  }, [keyword, dateFrom, dateTo]);

  const totalPages = Math.ceil(filteredOrders.length / PAGE_SIZE) || 1;
  const pagedOrders = filteredOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">领料单列表</h1>
        <Link
          href="/picking-orders/new"
          className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
        >
          + 开领料单
        </Link>
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索单号 / 工单号 / 领料人"
          className="px-3 py-1.5 text-xs rounded border border-gray-200 w-56 focus:outline-none focus:border-blue-400"
        />
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="px-2 py-1 text-xs rounded border border-gray-200 focus:outline-none focus:border-blue-400"
        />
        <span className="text-xs text-gray-400">至</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="px-2 py-1 text-xs rounded border border-gray-200 focus:outline-none focus:border-blue-400"
        />
      </div>

      {filteredOrders.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          暂无领料单
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">领料单号</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">关联工单</th>
                  <th className="px-6 py-3 text-right font-medium text-gray-500">总数量</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">领料人</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">操作人</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">日期</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pagedOrders.map((o) => (
                  <tr key={o.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-blue-600">
                      <Link href={`/picking-orders/${o.id}`} className="hover:text-blue-700">
                        {o.picking_no}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {o.work_orders ? (
                        <Link
                          href={`/work-orders/${o.work_orders.id}`}
                          className="text-blue-600 hover:text-blue-700"
                        >
                          {o.work_orders.order_no}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-6 py-4 text-right text-gray-900">{o.total_quantity}</td>
                    <td className="px-6 py-4 text-gray-600">{o.receiver_name || "-"}</td>
                    <td className="px-6 py-4 text-gray-600">{o.profiles?.full_name || "-"}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          o.status === "confirmed"
                            ? "bg-green-50 text-green-700"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {o.status === "confirmed" ? "已出库" : "已作废"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-500 text-xs">
                      {new Date(o.created_at).toLocaleDateString("zh-CN")}
                    </td>
                    <td className="px-6 py-4">
                      <Link
                        href={`/picking-orders/${o.id}`}
                        className="text-xs text-blue-600 hover:text-blue-700"
                      >
                        查看/打印
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100">
              <span className="text-xs text-gray-500">
                共 {filteredOrders.length} 条，第 {page}/{totalPages} 页
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage(page - 1)}
                  disabled={page === 1}
                  className="px-2 py-1 text-xs rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                >
                  上一页
                </button>
                <button
                  type="button"
                  onClick={() => setPage(page + 1)}
                  disabled={page === totalPages}
                  className="px-2 py-1 text-xs rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

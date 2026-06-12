"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface InboundOrder {
  id: string;
  inbound_no: string;
  supplier_name: string | null;
  total_quantity: number;
  total_amount: number | null;
  freight_amount: number | null;
  status: string;
  notes: string | null;
  created_at: string;
  purchase_orders: { order_no: string | null } | null;
}

const PAGE_SIZE = 15;

export default function InboundOrdersContent({ initialRecords }: { initialRecords: InboundOrder[] }) {
  const [orders] = useState<InboundOrder[]>(initialRecords);
  const [loading] = useState(false);
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const supplierOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      if (o.supplier_name) set.add(o.supplier_name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh"));
  }, [orders]);

  const filteredOrders = useMemo(() => {
    let list = orders;

    // 按供应商筛选
    if (supplierFilter) {
      list = list.filter((o) => o.supplier_name === supplierFilter);
    }

    // 按日期范围筛选
    if (dateFrom) {
      list = list.filter((o) => o.created_at >= `${dateFrom}T00:00:00`);
    }
    if (dateTo) {
      list = list.filter((o) => o.created_at <= `${dateTo}T23:59:59`);
    }

    return list;
  }, [orders, supplierFilter, dateFrom, dateTo]);

  // 筛选条件变化时重置页码
  useEffect(() => {
    setPage(1);
  }, [supplierFilter, dateFrom, dateTo]);

  const totalPages = Math.ceil(filteredOrders.length / PAGE_SIZE) || 1;
  const pagedOrders = filteredOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">入库单列表</h1>
        <div className="flex items-center gap-2">
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
      </div>

      {supplierOptions.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap mb-4">
          <span className="text-xs text-gray-500">供应商:</span>
          <button
            type="button"
            onClick={() => setSupplierFilter(null)}
            className={`px-2 py-1 text-xs rounded border transition-colors ${
              supplierFilter === null
                ? "bg-blue-600 border-blue-600 text-white"
                : "bg-white border-gray-200 text-gray-600 hover:border-blue-400"
            }`}
          >
            全部
          </button>
          {supplierOptions.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setSupplierFilter(name)}
              className={`px-2 py-1 text-xs rounded border transition-colors ${
                supplierFilter === name
                  ? "bg-blue-600 border-blue-600 text-white"
                  : "bg-white border-gray-200 text-gray-600 hover:border-blue-400"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          加载中...
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          暂无入库单
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">入库单号</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">关联采购单</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">供应商</th>
                  <th className="px-6 py-3 text-right font-medium text-gray-500">总数量</th>
                  <th className="px-6 py-3 text-right font-medium text-gray-500">总金额</th>
                  <th className="px-6 py-3 text-right font-medium text-gray-500">运费</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">日期</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pagedOrders.map((o) => (
                  <tr key={o.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-blue-600">
                      <Link href={`/inbound-orders/${o.id}`} className="hover:text-blue-700">
                        {o.inbound_no}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {o.purchase_orders?.order_no || "-"}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{o.supplier_name || "-"}</td>
                    <td className="px-6 py-4 text-right text-gray-900">{o.total_quantity}</td>
                    <td className="px-6 py-4 text-right text-gray-900">
                      {o.total_amount != null ? `¥${o.total_amount.toFixed(2)}` : "-"}
                    </td>
                    <td className="px-6 py-4 text-right text-gray-600">
                      {o.freight_amount != null ? `¥${o.freight_amount.toFixed(2)}` : "-"}
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700">
                        {o.status === "completed" ? "已完成" : o.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-500 text-xs">
                      {new Date(o.created_at).toLocaleDateString("zh-CN")}
                    </td>
                    <td className="px-6 py-4">
                      <Link
                        href={`/inbound-orders/${o.id}`}
                        className="text-xs text-blue-600 hover:text-blue-700"
                      >
                        查看详情
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

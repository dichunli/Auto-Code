"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

interface ReturnOrder {
  id: string;
  return_no: string;
  supplier_name: string | null;
  total_quantity: number;
  status: string;
  logistics_company: string | null;
  tracking_no: string | null;
  return_shipping_fee: number | null;
  shipping_fee_payer: string | null;
  notes: string | null;
  created_at: string;
}

const PAGE_SIZE = 15;

export default function ReturnOrdersPage() {
  const supabase = createClient();
  const [orders, setOrders] = useState<ReturnOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  async function loadData() {
    setLoading(true);
    let query = supabase
      .from("purchase_return_orders")
      .select("id, return_no, supplier_name, total_quantity, status, logistics_company, tracking_no, return_shipping_fee, shipping_fee_payer, notes, created_at")
      .order("created_at", { ascending: false });

    if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00`);
    if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59`);

    const { data, error } = await query;
    if (error) {
      console.error("加载采退单失败:", error);
      setLoading(false);
      return;
    }
    setOrders((data || []) as unknown as ReturnOrder[]);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const supplierOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      if (o.supplier_name) set.add(o.supplier_name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh"));
  }, [orders]);

  const filteredOrders = useMemo(() => {
    let list = orders;
    if (supplierFilter) {
      list = list.filter((o) => o.supplier_name === supplierFilter);
    }
    return list;
  }, [orders, supplierFilter]);

  useEffect(() => {
    setPage(1);
  }, [supplierFilter]);

  const totalPages = Math.ceil(filteredOrders.length / PAGE_SIZE) || 1;
  const pagedOrders = filteredOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">采退单列表</h1>
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
          <button
            type="button"
            onClick={loadData}
            className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
          >
            查询
          </button>
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
          暂无采退单
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">采退单号</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">供应商</th>
                  <th className="px-6 py-3 text-right font-medium text-gray-500">总数量</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">物流信息</th>
                  <th className="px-6 py-3 text-right font-medium text-gray-500">退货运费</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">运费支付方</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">日期</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pagedOrders.map((o) => (
                  <tr key={o.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-blue-600">
                      <Link href={`/return-orders/${o.id}`} className="hover:text-blue-700">
                        {o.return_no}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{o.supplier_name || "-"}</td>
                    <td className="px-6 py-4 text-right text-gray-900">{o.total_quantity}</td>
                    <td className="px-6 py-4 text-gray-500 text-xs">
                      {o.logistics_company && o.tracking_no ? (
                        <div>
                          <div>{o.logistics_company}</div>
                          <div className="text-gray-400">{o.tracking_no}</div>
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-6 py-4 text-right text-gray-900">
                      {o.return_shipping_fee != null ? `¥${o.return_shipping_fee.toFixed(2)}` : "-"}
                    </td>
                    <td className="px-6 py-4 text-gray-600 text-xs">
                      {o.shipping_fee_payer === "self"
                        ? "我方承担"
                        : o.shipping_fee_payer === "supplier"
                        ? "供应商承担"
                        : "-"}
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
                        href={`/return-orders/${o.id}`}
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

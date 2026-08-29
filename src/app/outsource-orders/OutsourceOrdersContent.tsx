"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDebounce } from "@/lib/useDebounce";
import { 清理搜索词 } from "@/lib/sanitizeQuery";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";

interface OutsourceOrderItem {
  id: string;
  service_name: string;
  amount: number;
}

interface OutsourceOrder {
  id: string;
  order_no: string;
  work_order_id: string;
  supplier_id: string;
  total_amount: number;
  is_paid: boolean;
  payment_method: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  work_orders: { order_no: string } | null;
  suppliers: { name: string } | null;
  outsource_order_items: OutsourceOrderItem[] | null;
}

const PAYMENT_STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "unpaid", label: "未支付" },
  { value: "paid", label: "已支付" },
];

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "现金",
  wechat: "微信",
  alipay: "支付宝",
  bank_transfer: "银行转账",
};

export default function OutsourceOrdersContent({ initialOrders, initialCount }: { initialOrders: OutsourceOrder[]; initialCount: number }) {
  const supabase = useMemo(() => createClient(), []);
  const [orders, setOrders] = useState<OutsourceOrder[]>(initialOrders);
  const [query, setQuery] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  /* 分页状态：首屏数据由服务端给（第 1 页），后续搜索/筛选/翻页走 loadOrders */
  const [total, setTotal] = useState(initialCount);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const debouncedQuery = useDebounce(query, 300);
  const mounted = useRef(false);

  async function loadOrders(search: string, status: string, 目标页: number) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setLoading(true);
    const from = (目标页 - 1) * pageSize;
    const 关键词 = 清理搜索词(search);
    /* 有搜索词时关联表用 !inner 才能按工单号/供应商/项目名过滤主表；
       work_order_id、supplier_id 必填，inner 不丢单；仅「无项目的外包单」在搜索时查不到 */
    const select串 = 关键词
      ? "*, work_orders!inner(order_no), suppliers!inner(name), outsource_order_items!inner(id, service_name, amount)"
      : "*, work_orders(order_no), suppliers(name), outsource_order_items(id, service_name, amount)";
    let q = supabase
      .from("outsource_orders")
      .select(select串, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (status === "unpaid") {
      q = q.eq("is_paid", false);
    } else if (status === "paid") {
      q = q.eq("is_paid", true);
    }
    if (关键词) {
      q = q.or(`order_no.ilike.%${关键词}%,work_orders.order_no.ilike.%${关键词}%,suppliers.name.ilike.%${关键词}%,outsource_order_items.service_name.ilike.%${关键词}%`);
    }

    const { data, count, error } = await q;
    if (error) {
      alert("加载失败: " + error.message);
      setLoading(false);
      return;
    }
    setOrders((data as unknown as OutsourceOrder[]) || []);
    setTotal(count || 0);
    setPage(目标页);
    setLoading(false);
  }

  // 支付状态/搜索词变化时重新拉取（跳过首次挂载），回到第 1 页
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    loadOrders(debouncedQuery, paymentStatus, 1);
  }, [debouncedQuery, paymentStatus]);

  /* 分页后拿不到全量数据，合计口径为当前页 */
  const totalAmount = useMemo(() => {
    return orders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
  }, [orders]);

  return (
    <div>
      <PageHeader
        title="外包服务单"
        description="按工单查看外包记录，每个工单一张外包单，可包含多个项目"
      />

      {/* 筛选区域 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="搜索外包单号、工单号、供应商或项目名称..."
          className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          value={paymentStatus}
          onChange={(e) => setPaymentStatus(e.target.value)}
        >
          {PAYMENT_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {(query || paymentStatus) && (
          <button
            onClick={() => {
              setQuery("");
              setPaymentStatus("");
            }}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            清空筛选
          </button>
        )}
      </div>

      {/* 统计 */}
      <div className="mb-4 text-sm text-gray-600">
        共 <span className="font-medium text-gray-900">{total}</span> 张外包单
        {orders.length > 0 && (
          <span className="ml-4">
            本页合计：<span className="font-medium text-gray-900">¥{totalAmount.toFixed(2)}</span>
          </span>
        )}
      </div>

      {/* 表格 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">外包单号</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">关联工单</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">外包项目</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">总金额</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">供应商</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">支付状态</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">支付方式</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">创建时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orders?.map((o: OutsourceOrder) => {
                const items = o.outsource_order_items || [];
                return (
                  <tr key={o.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">
                      {o.order_no}
                    </td>
                    <td className="px-6 py-4">
                      <Link
                        href={`/work-orders/${o.work_order_id}`}
                        className="text-blue-600 hover:text-blue-700 hover:underline"
                      >
                        {o.work_orders?.order_no || o.work_order_id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {items.length === 0 ? (
                        <span className="text-gray-400">-</span>
                      ) : (
                        <div className="space-y-0.5">
                          {items.slice(0, 3).map((it) => (
                            <div key={it.id} className="text-xs">
                              <span>{it.service_name}</span>
                              <span className="text-gray-400 ml-1">¥{it.amount}</span>
                            </div>
                          ))}
                          {items.length > 3 && (
                            <div className="text-xs text-gray-400">
                              等 {items.length} 项
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-900 font-medium">
                      ¥{(o.total_amount || 0).toFixed(2)}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {o.suppliers?.name || "-"}
                    </td>
                    <td className="px-6 py-4">
                      {o.is_paid ? (
                        <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700">
                          已支付
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded bg-yellow-50 text-yellow-700">
                          未支付
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {o.payment_method
                        ? PAYMENT_METHOD_LABELS[o.payment_method] || o.payment_method
                        : "-"}
                    </td>
                    <td className="px-6 py-4 text-gray-500">
                      {new Date(o.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
              {(!orders || orders.length === 0) && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-400">
                    {loading ? "加载中..." : "暂无外包单数据"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 分页导航：客户端翻页，保留当前搜索/筛选条件 */}
      {totalPages > 1 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-gray-500">
            共 {total} 条，第 {page}/{totalPages} 页
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadOrders(debouncedQuery, paymentStatus, page - 1)}
              disabled={page <= 1 || loading}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              上一页
            </button>
            <button
              onClick={() => loadOrders(debouncedQuery, paymentStatus, page + 1)}
              disabled={page >= totalPages || loading}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

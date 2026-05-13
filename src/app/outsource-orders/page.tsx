"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
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

export default function OutsourceOrdersPage() {
  const supabase = createClient();
  const [orders, setOrders] = useState<OutsourceOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  async function loadOrders() {
    setLoading(true);
    let q = supabase
      .from("outsource_orders")
      .select(
        "*, work_orders(order_no), suppliers(name), outsource_order_items(id, service_name, amount)"
      )
      .order("created_at", { ascending: false });

    if (paymentStatus === "unpaid") {
      q = q.eq("is_paid", false);
    } else if (paymentStatus === "paid") {
      q = q.eq("is_paid", true);
    }

    const { data, error } = await q;
    if (error) {
      console.error("外包单加载失败:", error);
      alert("加载失败: " + error.message);
    }
    setOrders((data as OutsourceOrder[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    loadOrders();
  }, [supabase, paymentStatus]);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      loadOrders();
    }, 300);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [query]);

  const filteredOrders = useMemo(() => {
    if (!query.trim()) return orders;
    const kw = query.trim().toLowerCase();
    return orders.filter((o) => {
      const itemHits = (o.outsource_order_items || []).some((it) =>
        (it.service_name || "").toLowerCase().includes(kw)
      );
      return (
        (o.order_no || "").toLowerCase().includes(kw) ||
        (o.work_orders?.order_no || "").toLowerCase().includes(kw) ||
        (o.suppliers?.name || "").toLowerCase().includes(kw) ||
        itemHits
      );
    });
  }, [orders, query]);

  const totalAmount = useMemo(() => {
    return filteredOrders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
  }, [filteredOrders]);

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
        共 <span className="font-medium text-gray-900">{filteredOrders.length}</span> 张外包单
        {filteredOrders.length > 0 && (
          <span className="ml-4">
            合计金额：<span className="font-medium text-gray-900">¥{totalAmount.toFixed(2)}</span>
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
              {filteredOrders?.map((o: OutsourceOrder) => {
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
              {(!filteredOrders || filteredOrders.length === 0) && (
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
    </div>
  );
}

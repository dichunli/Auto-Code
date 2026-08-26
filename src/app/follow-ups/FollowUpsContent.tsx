"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { formatDate } from "@/lib/utils";
import Link from "next/link";

export interface 回访记录 {
  id: string;
  completed_at: string | null;
  scheduled_at: string;
  work_order_id: string;
  work_orders: {
    order_no: string;
    customers: { name: string; phone: string } | null;
    vehicles: { plate_number: string; brand: string; model: string } | null;
  } | null;
  method: string | null;
  result: string | null;
}

const statusFilters = [
  { value: "", label: "全部" },
  { value: "pending", label: "待回访" },
  { value: "overdue", label: "已逾期" },
  { value: "completed", label: "已完成" },
];

export default function FollowUpsContent({ status, initialFollowUps, initialCount }: { status: string; initialFollowUps: 回访记录[]; initialCount: number }) {
  const supabase = useMemo(() => createClient(), []);
  const [followUps, setFollowUps] = useState<回访记录[]>(initialFollowUps);
  /* 分页状态：首屏数据由服务端给（第 1 页），翻页走 loadFollowUps；
     切换状态筛选靠 URL 导航，page.tsx 用 key 强制重挂载回到第 1 页 */
  const [total, setTotal] = useState(initialCount);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  /* 状态徽标的逾期判定以渲染时刻为准 */
  const now = new Date().toISOString();

  async function loadFollowUps(目标页: number) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setLoading(true);
    /* 待回访/已逾期的筛选以查询时刻为准，与原服务端口径一致 */
    const 查询时刻 = new Date().toISOString();
    const from = (目标页 - 1) * pageSize;
    let q = supabase
      .from("follow_ups")
      .select("*, work_orders(id, order_no, vehicles(plate_number, brand, model), customers(name, phone))", { count: "exact" })
      .order("scheduled_at", { ascending: true });

    if (status === "pending") {
      q = q.is("completed_at", null).gt("scheduled_at", 查询时刻);
    } else if (status === "overdue") {
      q = q.is("completed_at", null).lte("scheduled_at", 查询时刻);
    } else if (status === "completed") {
      q = q.not("completed_at", "is", null);
    }

    const { data, count, error } = await q.range(from, from + pageSize - 1);
    if (error) {
      console.error("回访记录加载失败:", error);
      alert("加载失败: " + error.message);
    } else {
      setFollowUps((data || []) as unknown as 回访记录[]);
      setTotal(count || 0);
      setPage(目标页);
    }
    setLoading(false);
  }

  function getStatus(fu: 回访记录) {
    if (fu.completed_at) return { label: "已完成", color: "text-green-600 bg-green-50" };
    if (fu.scheduled_at <= now) return { label: "已逾期", color: "text-red-600 bg-red-50" };
    return { label: "待回访", color: "text-blue-600 bg-blue-50" };
  }

  return (
    <div>
      <PageHeader title="售后回访" description="跟踪工单结算后的客户回访情况" />

      <div className="flex flex-wrap gap-2 mb-6">
        {statusFilters.map((f) => (
          <Link
            key={f.value}
            href={f.value ? `?status=${f.value}` : "/follow-ups"}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              (status || "") === f.value
                ? "bg-blue-600 text-white"
                : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">工单号</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">客户</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">车辆</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">计划时间</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">回访方式</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">结果</th>
                <th className="px-6 py-3 text-right font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {followUps?.map((fu: 回访记录) => {
                const s = getStatus(fu);
                return (
                  <tr key={fu.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">
                      <Link href={`/work-orders/${fu.work_order_id}`} className="hover:text-blue-600 hover:underline">
                        {fu.work_orders?.order_no}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-gray-700">
                      {fu.work_orders?.customers?.name || "-"}
                      {fu.work_orders?.customers?.phone && (
                        <span className="text-gray-400 ml-1">({fu.work_orders.customers.phone})</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {fu.work_orders?.vehicles?.plate_number || "-"}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{formatDate(fu.scheduled_at)}</td>
                    <td className="px-6 py-4">
                      <span className={`text-xs font-medium px-2 py-1 rounded ${s.color}`}>{s.label}</span>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {fu.method
                        ? fu.method === "phone"
                          ? "电话"
                          : fu.method === "sms"
                          ? "短信"
                          : fu.method === "wechat"
                          ? "微信"
                          : fu.method
                        : "-"}
                    </td>
                    <td className="px-6 py-4 text-gray-600 max-w-xs truncate">{fu.result || "-"}</td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        href={`/follow-ups/${fu.id}`}
                        className="text-sm text-blue-600 hover:text-blue-700"
                      >
                        {fu.completed_at ? "查看" : "回访登记"}
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {(!followUps || followUps.length === 0) && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-400">
                    {loading ? "加载中..." : "暂无回访记录"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 分页导航：客户端翻页，保留当前状态筛选 */}
      {totalPages > 1 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-gray-500">
            共 {total} 条，第 {page}/{totalPages} 页
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadFollowUps(page - 1)}
              disabled={page <= 1 || loading}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              上一页
            </button>
            <button
              onClick={() => loadFollowUps(page + 1)}
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

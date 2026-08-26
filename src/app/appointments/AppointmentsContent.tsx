"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";

interface Appointment {
  id: string;
  customer_name: string;
  customer_phone: string;
  plate_number?: string;
  vehicle_brand?: string;
  vehicle_model?: string;
  appointment_date: string;
  appointment_time?: string;
  service_type?: string;
  status: string;
}

const dateFilters = [
  { value: "today", label: "今日" },
  { value: "tomorrow", label: "明日" },
  { value: "week", label: "近7天" },
  { value: "", label: "全部" },
];

const statusMap: Record<string, { label: string; color: string }> = {
  pending: { label: "待到店", color: "text-blue-600 bg-blue-50" },
  arrived: { label: "已到店", color: "text-green-600 bg-green-50" },
  cancelled: { label: "已取消", color: "text-gray-600 bg-gray-50" },
  no_show: { label: "爽约", color: "text-red-600 bg-red-50" },
};

export default function AppointmentsContent({ initialAppointments, initialCount, dateFilter }: { initialAppointments: Appointment[]; initialCount: number; dateFilter: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [appointments, setAppointments] = useState<Appointment[]>(initialAppointments);
  /* 分页状态：首屏数据由服务端给（第 1 页），后续翻页走 loadAppointments */
  const [total, setTotal] = useState(initialCount);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function loadAppointments(目标页: number) {
    /* 客户端 session 丢失时不查询，避免空结果覆盖服务端数据 */
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setLoading(true);
    const from = (目标页 - 1) * pageSize;
    const today = new Date().toISOString().split("T")[0];

    /* 与服务端 page.tsx 保持一致的日期筛选逻辑 */
    let q = supabase
      .from("appointments")
      .select("*", { count: "exact" })
      .order("appointment_date", { ascending: true })
      .order("appointment_time", { ascending: true })
      .range(from, from + pageSize - 1);

    if (dateFilter === "today") {
      q = q.eq("appointment_date", today);
    } else if (dateFilter === "tomorrow") {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      q = q.eq("appointment_date", tomorrow.toISOString().split("T")[0]);
    } else if (dateFilter === "week") {
      const weekLater = new Date();
      weekLater.setDate(weekLater.getDate() + 7);
      q = q.gte("appointment_date", today).lte("appointment_date", weekLater.toISOString().split("T")[0]);
    }

    const { data, count, error } = await q;
    if (error) {
      console.error("预约加载失败:", error);
      alert("加载失败: " + error.message);
    } else {
      setAppointments((data as unknown as Appointment[]) || []);
      setTotal(count || 0);
      setPage(目标页);
    }
    setLoading(false);
  }

  return (
    <div>
      <PageHeader title="客户预约" description="管理客户到店预约" action={{ href: "/appointments/new", label: "新增预约" }} />

      {/* 日期筛选：URL 导航，服务端重新取第 1 页（组件按 key 重挂载回到第 1 页） */}
      <div className="flex flex-wrap gap-2 mb-6">
        {dateFilters.map((f) => (
          <Link
            key={f.value}
            href={f.value ? `?date=${f.value}` : "/appointments"}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              dateFilter === f.value
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
                <th className="px-6 py-3 text-left font-medium text-gray-500">客户</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">电话</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">车辆</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">预约日期</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">时间</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">服务项目</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-6 py-3 text-right font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {appointments?.map((a) => {
                const s = statusMap[a.status];
                return (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">{a.customer_name}</td>
                    <td className="px-6 py-4 text-gray-600">{a.customer_phone}</td>
                    <td className="px-6 py-4 text-gray-600">
                      {a.plate_number ? `${a.plate_number} ${a.vehicle_brand || ""} ${a.vehicle_model || ""}` : "-"}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{a.appointment_date}</td>
                    <td className="px-6 py-4 text-gray-600">{a.appointment_time || "-"}</td>
                    <td className="px-6 py-4 text-gray-600">{a.service_type || "-"}</td>
                    <td className="px-6 py-4">
                      <span className={`text-xs font-medium px-2 py-1 rounded ${s.color}`}>{s.label}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link href={`/appointments/${a.id}`} className="text-sm text-blue-600 hover:text-blue-700">
                        查看
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {(!appointments || appointments.length === 0) && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-400">
                    {loading ? "加载中..." : "暂无预约记录"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 分页导航：客户端翻页，保留当前日期筛选 */}
      {totalPages > 1 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-gray-500">
            共 {total} 条，第 {page}/{totalPages} 页
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadAppointments(page - 1)}
              disabled={page <= 1 || loading}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              上一页
            </button>
            <button
              onClick={() => loadAppointments(page + 1)}
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

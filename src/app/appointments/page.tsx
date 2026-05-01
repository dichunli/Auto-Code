import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatDate } from "@/lib/utils";
import Link from "next/link";

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const supabase = await createClient();
  const { date } = await searchParams;

  const today = new Date().toISOString().split("T")[0];

  let query = supabase
    .from("appointments")
    .select("*")
    .order("appointment_date", { ascending: true })
    .order("appointment_time", { ascending: true });

  if (date === "today") {
    query = query.eq("appointment_date", today);
  } else if (date === "tomorrow") {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    query = query.eq("appointment_date", tomorrow.toISOString().split("T")[0]);
  } else if (date === "week") {
    const weekLater = new Date();
    weekLater.setDate(weekLater.getDate() + 7);
    query = query.gte("appointment_date", today).lte("appointment_date", weekLater.toISOString().split("T")[0]);
  }

  const { data: appointments } = await query;

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

  return (
    <div>
      <PageHeader title="客户预约" description="管理客户到店预约" action={{ href: "/appointments/new", label: "新增预约" }} />

      <div className="flex flex-wrap gap-2 mb-6">
        {dateFilters.map((f) => (
          <Link
            key={f.value}
            href={f.value ? `?date=${f.value}` : "/appointments"}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              (date || "") === f.value
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
              {appointments?.map((a: any) => {
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
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-400">暂无预约记录</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

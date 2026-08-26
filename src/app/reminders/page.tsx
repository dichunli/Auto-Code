import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";

export default async function RemindersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const supabase = await createClient();
  const { status, page: pageParam } = await searchParams;
  const today = new Date().toISOString().split("T")[0];

  /* 分页：URL 参数驱动（?page=N），与服务端筛选（?status=）保持一致风格 */
  const pageSize = 20;
  const page = Math.max(1, parseInt(pageParam || "1", 10) || 1);
  const from = (page - 1) * pageSize;

  let query = supabase
    .from("maintenance_reminders")
    .select("*, vehicles(plate_number, brand, model, mileage), customers(name, phone)", { count: "exact" })
    .order("due_date", { ascending: true });

  if (status) {
    query = query.eq("status", status);
  }

  const { data: reminders, count } = await query.range(from, from + pageSize - 1);
  const total = count || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  /* 翻页链接保留当前状态筛选 */
  const 翻页链接 = (p: number) => (status ? `?status=${status}&page=${p}` : `?page=${p}`);

  const statusFilters = [
    { value: "", label: "全部" },
    { value: "pending", label: "待提醒" },
    { value: "notified", label: "已通知" },
    { value: "completed", label: "已完成" },
  ];

  const statusMap: Record<string, { label: string; color: string }> = {
    pending: { label: "待提醒", color: "text-blue-600 bg-blue-50" },
    notified: { label: "已通知", color: "text-amber-600 bg-amber-50" },
    completed: { label: "已完成", color: "text-green-600 bg-green-50" },
    cancelled: { label: "已取消", color: "text-gray-600 bg-gray-50" },
  };

  return (
    <div>
      <PageHeader title="保养提醒" description="基于时间或里程的保养到期提醒" />

      <div className="flex flex-wrap gap-2 mb-6">
        {statusFilters.map((f) => (
          <Link
            key={f.value}
            href={f.value ? `?status=${f.value}` : "/reminders"}
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
                <th className="px-6 py-3 text-left font-medium text-gray-500">客户</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">车辆</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">提醒类型</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">到期条件</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">关联工单</th>
                <th className="px-6 py-3 text-right font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reminders?.map((r) => {
                const s = statusMap[r.status];
                const isOverdue =
                  r.status === "pending" &&
                  ((r.reminder_type === "time" && r.due_date < today) ||
                    (r.reminder_type === "mileage" && r.vehicles?.mileage != null && r.vehicles.mileage >= r.due_mileage));
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-gray-900">
                      {r.customers?.name || "-"}
                      {r.customers?.phone && (
                        <span className="text-gray-400 text-xs ml-1">({r.customers.phone})</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {r.vehicles?.plate_number || "-"} {r.vehicles?.brand || ""} {r.vehicles?.model || ""}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {r.reminder_type === "time" ? "时间" : "里程"}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {r.reminder_type === "time"
                        ? r.due_date
                        : `${r.due_mileage} km`}
                      {isOverdue && (
                        <span className="ml-2 text-xs text-red-600 bg-red-50 px-1.5 py-0.5 rounded">已到期</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-xs font-medium px-2 py-1 rounded ${s.color}`}>{s.label}</span>
                    </td>
                    <td className="px-6 py-4">
                      {r.work_order_id ? (
                        <Link
                          href={`/work-orders/${r.work_order_id}`}
                          className="text-blue-600 hover:text-blue-700"
                        >
                          查看
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {r.status === "pending" && (
                        <Link href={`/reminders/${r.id}`} className="text-sm text-blue-600 hover:text-blue-700">
                          处理
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
              {(!reminders || reminders.length === 0) && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-400">
                    暂无保养提醒
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 分页导航：URL 驱动，翻页保留状态筛选 */}
      {totalPages > 1 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-gray-500">
            共 {total} 条，第 {page}/{totalPages} 页
          </div>
          <div className="flex items-center gap-2">
            {page > 1 ? (
              <Link
                href={翻页链接(page - 1)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
              >
                上一页
              </Link>
            ) : (
              <span className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-400 opacity-40 cursor-not-allowed">
                上一页
              </span>
            )}
            {page < totalPages ? (
              <Link
                href={翻页链接(page + 1)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
              >
                下一页
              </Link>
            ) : (
              <span className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-400 opacity-40 cursor-not-allowed">
                下一页
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

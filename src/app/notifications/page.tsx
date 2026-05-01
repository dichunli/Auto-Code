import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatDate } from "@/lib/utils";
import Link from "next/link";

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; status?: string }>;
}) {
  const supabase = await createClient();
  const { type, status } = await searchParams;

  let query = supabase
    .from("notifications")
    .select("*, customers(name, phone), members(card_no, name)")
    .order("created_at", { ascending: false });

  if (type) query = query.eq("type", type);
  if (status) query = query.eq("status", status);

  const { data: notifications } = await query;

  const typeFilters = [
    { value: "", label: "全部类型" },
    { value: "work_order_status", label: "工单状态" },
    { value: "maintenance_due", label: "保养提醒" },
    { value: "birthday", label: "生日祝福" },
    { value: "marketing", label: "营销活动" },
    { value: "appointment", label: "预约提醒" },
  ];

  const statusFilters = [
    { value: "", label: "全部状态" },
    { value: "pending", label: "待发送" },
    { value: "sent", label: "已发送" },
    { value: "failed", label: "发送失败" },
  ];

  const typeMap: Record<string, string> = {
    work_order_status: "工单状态",
    maintenance_due: "保养提醒",
    birthday: "生日祝福",
    marketing: "营销活动",
    appointment: "预约提醒",
  };

  const statusMap: Record<string, { label: string; color: string }> = {
    pending: { label: "待发送", color: "text-blue-600 bg-blue-50" },
    sent: { label: "已发送", color: "text-green-600 bg-green-50" },
    failed: { label: "失败", color: "text-red-600 bg-red-50" },
    read: { label: "已读", color: "text-gray-600 bg-gray-50" },
  };

  return (
    <div>
      <PageHeader title="客户通知" description="查看和管理客户触达记录" />

      <div className="flex flex-wrap gap-2 mb-6">
        {typeFilters.map((f) => (
          <Link
            key={f.value}
            href={f.value ? `?type=${f.value}${status ? `&status=${status}` : ""}` : `?${status ? `status=${status}` : ""}`}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              (type || "") === f.value
                ? "bg-blue-600 text-white"
                : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {statusFilters.map((f) => (
          <Link
            key={f.value}
            href={f.value ? `?${type ? `type=${type}&` : ""}status=${f.value}` : `?${type ? `type=${type}` : ""}`}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              (status || "") === f.value
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
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
                <th className="px-6 py-3 text-left font-medium text-gray-500">类型</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">客户/会员</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">标题</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">内容</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">发送时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {notifications?.map((n: any) => {
                const s = statusMap[n.status];
                return (
                  <tr key={n.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-gray-600">{typeMap[n.type] || n.type}</td>
                    <td className="px-6 py-4 text-gray-900">
                      {n.customers?.name || n.members?.name || "-"}
                      {n.members?.card_no && (
                        <span className="text-gray-400 text-xs ml-1">({n.members.card_no})</span>
                      )}
                    </td>
                    <td className="px-6 py-4 font-medium text-gray-900">{n.title}</td>
                    <td className="px-6 py-4 text-gray-600 max-w-xs truncate">{n.content || "-"}</td>
                    <td className="px-6 py-4">
                      <span className={`text-xs font-medium px-2 py-1 rounded ${s.color}`}>{s.label}</span>
                    </td>
                    <td className="px-6 py-4 text-gray-500">{n.sent_at ? formatDate(n.sent_at) : "-"}</td>
                  </tr>
                );
              })}
              {(!notifications || notifications.length === 0) && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                    暂无通知记录
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

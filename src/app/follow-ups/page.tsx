import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatDate } from "@/lib/utils";
import Link from "next/link";

export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const supabase = await createClient();
  const { status } = await searchParams;

  const now = new Date().toISOString();

  let query = supabase
    .from("follow_ups")
    .select("*, work_orders(id, order_no, vehicles(plate_number, brand, model), customers(name, phone))")
    .order("scheduled_at", { ascending: true });

  if (status === "pending") {
    query = query.is("completed_at", null).gt("scheduled_at", now);
  } else if (status === "overdue") {
    query = query.is("completed_at", null).lte("scheduled_at", now);
  } else if (status === "completed") {
    query = query.not("completed_at", "is", null);
  }

  const { data: followUps } = await query;

  const statusFilters = [
    { value: "", label: "全部" },
    { value: "pending", label: "待回访" },
    { value: "overdue", label: "已逾期" },
    { value: "completed", label: "已完成" },
  ];

  function getStatus(fu: any) {
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
              {followUps?.map((fu: any) => {
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
                    暂无回访记录
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

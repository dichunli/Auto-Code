import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";

export default async function WorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("work_orders")
    .select("id, order_no, status, total_cost, created_at, vehicles(plate_number, brand, model), customers(name, phone)")
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data: orders } = await query;

  const statusFilters = [
    { value: "", label: "全部" },
    { value: "received", label: "已接车" },
    { value: "repairing", label: "维修中" },
    { value: "quality_check", label: "质检中" },
    { value: "completed", label: "待结算" },
    { value: "settled", label: "已结算" },
  ];

  return (
    <div>
      <PageHeader
        title="工单管理"
        description="管理维修工单的全生命周期"
        action={{ href: "/work-orders/new", label: "新建工单" }}
      />

      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {statusFilters.map((filter) => (
          <Link
            key={filter.value}
            href={filter.value ? `?status=${filter.value}` : "/work-orders"}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              (status || "") === filter.value
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            {filter.label}
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
                <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">金额</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">创建时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orders?.map((order: any) => (
                <tr key={order.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">
                    <Link href={`/work-orders/${order.id}`} className="hover:text-blue-600">
                      {order.order_no}
                    </Link>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-gray-900">{order.customers?.name}</div>
                    <div className="text-gray-500 text-xs">{order.customers?.phone}</div>
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {order.vehicles?.plate_number}
                    <div className="text-gray-400 text-xs">{order.vehicles?.brand} {order.vehicles?.model}</div>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={order.status} />
                  </td>
                  <td className="px-6 py-4 text-gray-900">{formatCurrency(order.total_cost)}</td>
                  <td className="px-6 py-4 text-gray-500">{formatDate(order.created_at)}</td>
                </tr>
              ))}
              {(!orders || orders.length === 0) && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                    暂无工单数据
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

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppointmentActions } from "./AppointmentActions";

export default async function AppointmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: appt } = await supabase
    .from("appointments")
    .select("*, work_orders(id, order_no)")
    .eq("id", id)
    .single();

  if (!appt) notFound();

  const statusMap: Record<string, { label: string; color: string }> = {
    pending: { label: "待到店", color: "text-blue-600 bg-blue-50" },
    arrived: { label: "已到店", color: "text-green-600 bg-green-50" },
    cancelled: { label: "已取消", color: "text-gray-600 bg-gray-50" },
    no_show: { label: "爽约", color: "text-red-600 bg-red-50" },
  };

  const s = statusMap[appt.status];

  return (
    <div>
      <PageHeader
        title={`预约详情: ${appt.customer_name}`}
        description={`${appt.plate_number || "无车牌"} · ${appt.appointment_date}`}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">预约信息</h2>
              <span className={`text-xs font-medium px-2 py-1 rounded ${s.color}`}>{s.label}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">客户姓名：</span><span className="font-medium text-gray-900">{appt.customer_name}</span></div>
              <div><span className="text-gray-500">联系电话：</span><span className="text-gray-700">{appt.customer_phone}</span></div>
              <div><span className="text-gray-500">车牌号码：</span><span className="text-gray-700">{appt.plate_number || "-"}</span></div>
              <div><span className="text-gray-500">车辆品牌：</span><span className="text-gray-700">{appt.vehicle_brand || "-"} {appt.vehicle_model || ""}</span></div>
              <div><span className="text-gray-500">预约日期：</span><span className="text-gray-700">{appt.appointment_date}</span></div>
              <div><span className="text-gray-500">预约时间：</span><span className="text-gray-700">{appt.appointment_time || "-"}</span></div>
              <div className="sm:col-span-2"><span className="text-gray-500">服务项目：</span><span className="text-gray-700">{appt.service_type || "-"}</span></div>
              {appt.notes && (
                <div className="sm:col-span-2"><span className="text-gray-500">备注：</span><span className="text-gray-700">{appt.notes}</span></div>
              )}
            </div>

            {appt.work_order_id && appt.work_orders && (
              <div className="border-t border-gray-100 pt-4">
                <span className="text-gray-500 text-sm">已关联工单：</span>
                <Link href={`/work-orders/${appt.work_order_id}`} className="text-sm text-blue-600 hover:text-blue-700 ml-1">
                  {appt.work_orders.order_no}
                </Link>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <AppointmentActions appointment={appt} />
        </div>
      </div>
    </div>
  );
}

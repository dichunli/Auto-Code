import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReminderActions } from "./ReminderActions";

export default async function ReminderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: reminder } = await supabase
    .from("maintenance_reminders")
    .select("*, vehicles(plate_number, brand, model, mileage), customers(name, phone), work_orders(order_no)")
    .eq("id", id)
    .single();

  if (!reminder) notFound();

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader
        title="保养提醒处理"
        description={`${reminder.customers?.name} · ${reminder.vehicles?.plate_number}`}
      />

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">客户：</span>
            <span className="font-medium text-gray-900">{reminder.customers?.name || "-"}</span>
          </div>
          <div>
            <span className="text-gray-500">电话：</span>
            <span className="text-gray-700">{reminder.customers?.phone || "-"}</span>
          </div>
          <div>
            <span className="text-gray-500">车辆：</span>
            <span className="text-gray-700">
              {reminder.vehicles?.plate_number || "-"} {reminder.vehicles?.brand || ""} {reminder.vehicles?.model || ""}
            </span>
          </div>
          <div>
            <span className="text-gray-500">当前里程：</span>
            <span className="text-gray-700">{reminder.vehicles?.mileage || "-"}</span>
          </div>
          <div>
            <span className="text-gray-500">提醒类型：</span>
            <span className="text-gray-700">{reminder.reminder_type === "time" ? "时间" : "里程"}</span>
          </div>
          <div>
            <span className="text-gray-500">到期条件：</span>
            <span className="text-gray-700">
              {reminder.reminder_type === "time" ? reminder.due_date : `${reminder.due_mileage} km`}
            </span>
          </div>
          {reminder.work_orders && (
            <div className="sm:col-span-2">
              <span className="text-gray-500">关联工单：</span>
              <Link href={`/work-orders/${reminder.work_order_id}`} className="text-blue-600 hover:text-blue-700 ml-1">
                {reminder.work_orders.order_no}
              </Link>
            </div>
          )}
        </div>

        <ReminderActions reminder={reminder} />

        <div className="pt-4 border-t border-gray-100">
          <Link href="/reminders" className="text-sm text-blue-600 hover:text-blue-700">
            ← 返回保养提醒列表
          </Link>
        </div>
      </div>
    </div>
  );
}

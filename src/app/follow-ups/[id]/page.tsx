import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FollowUpForm } from "./FollowUpForm";

export default async function FollowUpDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: fu } = await supabase
    .from("follow_ups")
    .select("*, work_orders(id, order_no, vehicles(plate_number, brand, model), customers(name, phone))")
    .eq("id", id)
    .single();

  if (!fu) notFound();

  const isCompleted = !!fu.completed_at;
  const isOverdue = !isCompleted && fu.scheduled_at <= new Date().toISOString();

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader
        title={isCompleted ? "回访详情" : "回访登记"}
        description={`工单 ${fu.work_orders?.order_no}`}
      />

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">客户：</span>
            <span className="font-medium text-gray-900 ml-1">{fu.work_orders?.customers?.name || "-"}</span>
          </div>
          <div>
            <span className="text-gray-500">电话：</span>
            <span className="text-gray-700 ml-1">{fu.work_orders?.customers?.phone || "-"}</span>
          </div>
          <div>
            <span className="text-gray-500">车辆：</span>
            <span className="text-gray-700 ml-1">{fu.work_orders?.vehicles?.plate_number || "-"}</span>
          </div>
          <div>
            <span className="text-gray-500">计划回访时间：</span>
            <span className="text-gray-700 ml-1">{formatDate(fu.scheduled_at)}</span>
          </div>
        </div>

        {!isCompleted && isOverdue && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            该回访已逾期，请尽快联系客户。
          </div>
        )}

        {isCompleted ? (
          <div className="space-y-4 border-t border-gray-100 pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">回访方式：</span>
                <span className="text-gray-700 ml-1">
                  {fu.method === "phone" ? "电话" : fu.method === "sms" ? "短信" : fu.method === "wechat" ? "微信" : "-"}
                </span>
              </div>
              <div>
                <span className="text-gray-500">完成时间：</span>
                <span className="text-gray-700 ml-1">{formatDate(fu.completed_at)}</span>
              </div>
            </div>
            <div>
              <span className="text-gray-500 text-sm">回访结果：</span>
              <p className="text-gray-900 text-sm mt-1">{fu.result || "-"}</p>
            </div>
            {fu.notes && (
              <div>
                <span className="text-gray-500 text-sm">备注：</span>
                <p className="text-gray-900 text-sm mt-1">{fu.notes}</p>
              </div>
            )}
          </div>
        ) : (
          <FollowUpForm followUpId={fu.id} />
        )}

        <div className="pt-4 border-t border-gray-100">
          <Link
            href={`/work-orders/${fu.work_order_id}`}
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            ← 返回工单详情
          </Link>
        </div>
      </div>
    </div>
  );
}

"use client";

import {useState} from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ConfirmDialog";
import { 更新预约状态, 预约转工单 } from "../actions";
import Link from "next/link";

interface Appointment {
  id: string;
  customer_phone: string | null;
  customer_name: string;
  plate_number: string | null;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  service_type: string | null;
  notes: string | null;
  status: string;
  work_order_id: string | null;
}

export function AppointmentActions({ appointment }: { appointment: Appointment }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const { 请求确认, 确认弹窗 } = useConfirm();

  async function updateStatus(status: string) {
    setLoading(true);
    /* 写库走 Server Action */
    try {
      const result = await 更新预约状态({ appointmentId: appointment.id, status });
      if (!result.success) {
        alert("操作失败: " + (result.error || "未知错误"));
      }
    } catch {
      alert("操作失败：网络异常，请重试");
    }
    router.refresh();
    setLoading(false);
  }

  async function convertToWorkOrder() {
    setLoading(true);
    /* 转工单（找/建客户/车辆 + 建工单 + 改预约状态）走 Server Action，服务端一次完成 */
    try {
      const result = await 预约转工单({ appointmentId: appointment.id });
      if (!result.success || !result.workOrderId) {
        alert("转工单失败: " + (result.error || "未知错误"));
        setLoading(false);
        return;
      }
      router.push(`/work-orders/${result.workOrderId}`);
      router.refresh();
    } catch {
      alert("转工单失败：网络异常，请重试");
      setLoading(false);
    }
  }

  const isPending = appointment.status === "pending";

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
      <h2 className="text-base font-semibold text-gray-900">操作</h2>

      {isPending && (
        <>
          <button
            onClick={convertToWorkOrder}
            disabled={loading}
            className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {loading ? "处理中..." : "转为工单"}
          </button>
          <button
            onClick={() => updateStatus("arrived")}
            disabled={loading}
            className="w-full py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            标记已到店
          </button>
          <button
            onClick={async () => {
              if (await 请求确认("确定标记为爽约吗？")) updateStatus("no_show");
            }}
            disabled={loading}
            className="w-full py-2.5 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50"
          >
            标记爽约
          </button>
          <button
            onClick={async () => {
              if (await 请求确认("确定取消此预约吗？")) updateStatus("cancelled");
            }}
            disabled={loading}
            className="w-full py-2.5 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            取消预约
          </button>
        </>
      )}

      {appointment.status === "arrived" && appointment.work_order_id && (
        <Link
          href={`/work-orders/${appointment.work_order_id}`}
          className="block w-full py-2.5 text-center bg-gray-50 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-100 transition-colors"
        >
          查看关联工单
        </Link>
      )}

      {!isPending && !appointment.work_order_id && (
        <p className="text-sm text-gray-400 text-center py-2">该预约已结束</p>
      )}

      <div className="pt-3 border-t border-gray-100">
        <Link
          href="/appointments"
          className="block w-full py-2 text-center text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          ← 返回预约列表
        </Link>
      </div>

      {确认弹窗}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

export function AppointmentActions({ appointment }: { appointment: any }) {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);

  async function updateStatus(status: string) {
    setLoading(true);
    const { error } = await supabase
      .from("appointments")
      .update({ status })
      .eq("id", appointment.id);
    if (error) {
      alert("操作失败: " + error.message);
    }
    router.refresh();
    setLoading(false);
  }

  async function convertToWorkOrder() {
    setLoading(true);
    try {
      // 1. 查找或创建客户
      let customerId: string | null = null;
      const { data: existingCustomer } = await supabase
        .from("customers")
        .select("id")
        .eq("phone", appointment.customer_phone)
        .maybeSingle();

      if (existingCustomer) {
        customerId = existingCustomer.id;
      } else {
        const { data: newCustomer, error: cErr } = await supabase
          .from("customers")
          .insert({ name: appointment.customer_name, phone: appointment.customer_phone })
          .select("id")
          .single();
        if (cErr) throw cErr;
        customerId = newCustomer.id;
      }

      // 2. 查找或创建车辆
      let vehicleId: string | null = null;
      if (appointment.plate_number) {
        const { data: existingVehicle } = await supabase
          .from("vehicles")
          .select("id")
          .eq("plate_number", appointment.plate_number)
          .maybeSingle();

        if (existingVehicle) {
          vehicleId = existingVehicle.id;
        } else {
          const { data: newVehicle, error: vErr } = await supabase
            .from("vehicles")
            .insert({
              customer_id: customerId,
              plate_number: appointment.plate_number,
              brand: appointment.vehicle_brand || null,
              model: appointment.vehicle_model || null,
            })
            .select("id")
            .single();
          if (vErr) throw vErr;
          vehicleId = newVehicle.id;
        }
      }

      // 3. 创建工单
      const orderNo = `WO${Date.now().toString().slice(-8)}`;
      const { data: workOrder, error: woErr } = await supabase
        .from("work_orders")
        .insert({
          order_no: orderNo,
          customer_id: customerId,
          vehicle_id: vehicleId,
          status: "received",
          notes: `由预约转化: ${appointment.service_type || ""}。${appointment.notes || ""}`,
        })
        .select("id")
        .single();
      if (woErr) throw woErr;

      // 4. 更新预约状态
      const { error: aErr } = await supabase
        .from("appointments")
        .update({ status: "arrived", work_order_id: workOrder.id })
        .eq("id", appointment.id);
      if (aErr) throw aErr;

      router.push(`/work-orders/${workOrder.id}`);
      router.refresh();
    } catch (err: any) {
      alert("转工单失败: " + err.message);
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
            onClick={() => {
              if (confirm("确定标记为爽约吗？")) updateStatus("no_show");
            }}
            disabled={loading}
            className="w-full py-2.5 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50"
          >
            标记爽约
          </button>
          <button
            onClick={() => {
              if (confirm("确定取消此预约吗？")) updateStatus("cancelled");
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
    </div>
  );
}

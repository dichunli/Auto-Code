"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 预约 Server Action ═══
 * 预约状态变更、预约转工单从客户端直写收口到服务端，
 * 避免客户端 session 异常导致 401 / 被 RLS 拦截。 */

/* ─── 新建预约 ─── */
export async function 新建预约(参数: {
  customer_name: string;
  customer_phone: string;
  plate_number: string;
  vehicle_brand: string;
  vehicle_model: string;
  appointment_date: string;
  appointment_time: string;
  service_type: string;
  notes: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  if (!参数.customer_name.trim() || !参数.customer_phone.trim() || !参数.appointment_date) {
    return { success: false, error: "请填写客户姓名、电话和预约日期" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("appointments").insert({
    customer_name: 参数.customer_name.trim(),
    customer_phone: 参数.customer_phone.trim(),
    plate_number: 参数.plate_number.trim() || null,
    vehicle_brand: 参数.vehicle_brand.trim() || null,
    vehicle_model: 参数.vehicle_model.trim() || null,
    appointment_date: 参数.appointment_date,
    appointment_time: 参数.appointment_time || null,
    service_type: 参数.service_type.trim() || null,
    notes: 参数.notes.trim() || null,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/appointments");
  return { success: true };
}

export async function 更新预约状态(参数: {
  appointmentId: string;
  status: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("appointments")
    .update({ status: 参数.status })
    .eq("id", 参数.appointmentId);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/appointments");
  revalidatePath(`/appointments/${参数.appointmentId}`);
  return { success: true };
}

/* ═══ 预约转工单（找/建客户 → 找/建车辆 → 建工单 → 改预约状态） ═══
 * 原来是客户端 4 步连写，中途失败留半成品；收编到服务端一次完成。
 * 工单用 create_work_order RPC 创建（单号/接待人由 RPC 统一处理）。 */
export async function 预约转工单(参数: {
  appointmentId: string;
}): Promise<{ success: boolean; workOrderId?: string; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();

  /* 读预约信息（服务端取最新，不信客户端传入） */
  const { data: appointment, error: 读预约错误 } = await supabase
    .from("appointments")
    .select("id, customer_phone, customer_name, plate_number, vehicle_brand, vehicle_model, service_type, notes, status")
    .eq("id", 参数.appointmentId)
    .single();
  if (读预约错误 || !appointment) {
    return { success: false, error: "预约不存在" };
  }
  if (appointment.status !== "pending") {
    return { success: false, error: "该预约已处理过，请刷新页面" };
  }

  /* 1. 查找或创建客户 */
  let customerId: string | null = null;
  if (appointment.customer_phone) {
    const { data: existingCustomer } = await supabase
      .from("customers")
      .select("id")
      .eq("phone", appointment.customer_phone)
      .maybeSingle();
    customerId = existingCustomer?.id || null;
  }
  if (!customerId) {
    const { data: newCustomer, error: cErr } = await supabase
      .from("customers")
      .insert({
        name: appointment.customer_name,
        phone: appointment.customer_phone || null,
      })
      .select("id")
      .single();
    if (cErr || !newCustomer) {
      return { success: false, error: cErr?.message || "创建客户失败" };
    }
    customerId = newCustomer.id;
  }

  /* 2. 查找或创建车辆 */
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
      if (vErr || !newVehicle) {
        return { success: false, error: vErr?.message || "创建车辆失败" };
      }
      vehicleId = newVehicle.id;
    }
  }

  /* 3. 创建工单（RPC 统一生成单号，接待人取服务端登录用户） */
  const { data: result, error: rpcErr } = await supabase.rpc("create_work_order", {
    p_customer_id: customerId,
    p_vehicle_id: vehicleId,
    p_mileage_in: 0,
    p_fuel_level: null,
    p_customer_complaint: `由预约转化: ${appointment.service_type || ""}。${appointment.notes || ""}`,
    p_inspection_notes: "",
    p_receptionist_id: user.id,
    p_requirements: [],
    p_sender_name: null,
    p_sender_phone: null,
  });
  if (rpcErr) {
    return { success: false, error: rpcErr.message };
  }
  const rpcResult = result as { success: boolean; error?: string; order_id?: string };
  if (!rpcResult?.success || !rpcResult.order_id) {
    return { success: false, error: rpcResult?.error || "创建工单失败" };
  }

  /* 4. 更新预约状态 */
  const { error: aErr } = await supabase
    .from("appointments")
    .update({ status: "arrived", work_order_id: rpcResult.order_id })
    .eq("id", 参数.appointmentId);
  if (aErr) {
    return { success: false, error: aErr.message };
  }

  revalidatePath("/appointments");
  revalidatePath("/work-orders");
  return { success: true, workOrderId: rpcResult.order_id };
}

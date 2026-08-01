"use server";

import { revalidatePath } from "next/cache";
import { clearWorkOrderDataCache, 清基础数据缓存 } from "@/lib/workOrderData";
import { createClient, 验证用户已登录 } from "@/lib/supabase/server";

/**
 * 清除指定工单的详情页缓存。
 * 编辑需求/项目等媒体后调用，确保 router.refresh() 能拿到最新数据，
 * 避免 30 秒缓存导致刚上传的视频/图片下次打开不显示。
 */
export async function 清除工单缓存(orderId: string): Promise<void> {
  clearWorkOrderDataCache(orderId);
}

/**
 * 清除基础数据缓存（员工/员工分组/供应商/物流公司）。
 * 在对应管理页面新增/编辑/删除后调用，详情页立即拿到最新基础数据，
 * 不用等 30 分钟缓存自然过期。
 */
export async function 刷新基础数据缓存(): Promise<void> {
  清基础数据缓存();
}

/* ═════════════════════════════════════════════════════════════════
 * 工单详情刷新 Server Action
 *
 * 客户端组件（如添加需求弹窗）保存数据后调用本函数，
 * 让工单详情页真正显示最新数据，而不是停留在旧缓存上。
 *
 * 为什么需要它：
 * - workOrderData.ts 有 30 秒内存缓存。客户端单纯调 router.refresh()
 *   会让服务端重新渲染，但 getWorkOrderData 仍命中旧缓存 → 看起来「没更新」。
 * - 这里先清掉该工单的缓存，再 revalidatePath 让 Next.js 重新拉取并渲染。
 * ═════════════════════════════════════════════════════════════════ */
export async function 刷新工单详情(工单id: string) {
  /* 1. 清掉该工单的服务端数据缓存，确保下次查询取最新数据 */
  clearWorkOrderDataCache(工单id);
  /* 2. 让工单详情页路径失效并重新验证，客户端 router.refresh() 时会拿到新数据 */
  revalidatePath(`/work-orders/${工单id}`);
}

/* ═══ 创建工单（新建工单页提交）═══
 * 客户/车辆创建 + create_work_order RPC 都挪到服务端，
 * 避免客户端 session 异常导致开单失败。
 * 重复开单检查、主管授权码验证仍在客户端（只读），提交才走这里。 */
export async function 创建工单(参数: {
  /* 场景1：选择了已有车辆 */
  selectedVehicleId: string | null;
  selectedVehicleCustomerId: string | null;
  /* 场景2：新建车辆（可关联已有客户或现场新建客户） */
  isNewVehicle: boolean;
  newVehicle: { plate_number: string; brand: string; model: string; vin: string };
  selectedCustomerId: string | null;
  isNewCustomer: boolean;
  newCustomer: { name: string; phone: string; company: string };
  /* 工单信息 */
  mileageIn: string;
  senderName: string;
  senderPhone: string;
}): Promise<{ success: boolean; orderId?: string; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const {
    selectedVehicleId,
    selectedVehicleCustomerId,
    isNewVehicle,
    newVehicle,
    selectedCustomerId,
    isNewCustomer,
    newCustomer,
    mileageIn,
    senderName,
    senderPhone,
  } = 参数;

  const supabase = await createClient();

  let customerId = "";
  let vehicleId = "";

  /* 场景1：已有车辆 */
  if (selectedVehicleId) {
    vehicleId = selectedVehicleId;
    customerId = selectedVehicleCustomerId || "";
  }

  /* 场景2：新建车辆 — 先保存客户和车辆 */
  if (isNewVehicle) {
    if (!newVehicle.plate_number.trim()) {
      return { success: false, error: "请输入车牌号" };
    }

    /* 2a. 确保客户存在 */
    if (selectedCustomerId) {
      customerId = selectedCustomerId;
    } else if (isNewCustomer) {
      if (!newCustomer.name.trim()) {
        return { success: false, error: "请输入客户姓名" };
      }
      const { data: cData, error: cError } = await supabase
        .from("customers")
        .insert({
          name: newCustomer.name.trim(),
          phone: newCustomer.phone.trim() || null,
          company: newCustomer.company.trim() || null,
        })
        .select("id")
        .single();
      if (cError) return { success: false, error: cError.message };
      if (!cData?.id) return { success: false, error: "创建客户失败" };
      customerId = cData.id;
    } else {
      return { success: false, error: "请搜索并选择客户，或填写新客户信息" };
    }

    /* 2b. 创建车辆 */
    const 接车里程 = mileageIn.trim() ? parseInt(mileageIn, 10) : null;
    const { data: vData, error: vError } = await supabase
      .from("vehicles")
      .insert({
        customer_id: customerId,
        plate_number: newVehicle.plate_number.trim(),
        brand: newVehicle.brand.trim() || null,
        model: newVehicle.model.trim() || null,
        vin: newVehicle.vin.trim() || null,
        mileage: 接车里程 != null && !isNaN(接车里程) ? 接车里程 : null,
      })
      .select("id")
      .single();
    if (vError) return { success: false, error: vError.message };
    if (!vData?.id) return { success: false, error: "创建车辆失败" };
    vehicleId = vData.id;
  }

  let mileageInNum = 0;
  if (mileageIn.trim()) {
    const parsed = parseInt(mileageIn, 10);
    mileageInNum = isNaN(parsed) ? 0 : parsed;
  }

  const { data: result, error: rpcErr } = await supabase.rpc("create_work_order", {
    p_customer_id: customerId,
    p_vehicle_id: vehicleId,
    p_mileage_in: mileageInNum,
    p_fuel_level: null,
    p_customer_complaint: "",
    p_inspection_notes: "",
    /* 接待人取服务端验证过的登录用户，比客户端传来的更可靠 */
    p_receptionist_id: user.id,
    p_requirements: [],
    p_sender_name: senderName.trim() || null,
    p_sender_phone: senderPhone.trim() || null,
  });

  if (rpcErr) return { success: false, error: rpcErr.message };

  const rpcResult = result as { success: boolean; error?: string; order_id?: string };
  if (!rpcResult?.success || !rpcResult.order_id) {
    return { success: false, error: rpcResult?.error || "创建工单失败" };
  }

  revalidatePath("/work-orders");
  return { success: true, orderId: rpcResult.order_id };
}

/* ═══ 结算工单（收银页提交）═══
 * settle_work_order 原子结算 RPC + 结算后的提醒/通知/回访写入，
 * 全部挪到服务端。结算涉及金额，必须等服务端确认后再更新 UI。 */
export async function 结算工单(参数: {
  orderId: string;
  discountAmount: number;
  payments: { method: string; amount: number; member_id: string | null }[];
  accountId: string | null;
  notes: string | null;
}): Promise<{ success: boolean; totalCost?: number; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const { orderId, discountAmount, payments, accountId, notes } = 参数;
  const supabase = await createClient();

  /* 调用原子结算 RPC */
  const { data: result, error: rpcError } = await supabase.rpc("settle_work_order", {
    p_order_id: orderId,
    p_discount_amount: discountAmount,
    p_payments: payments,
    p_account_id: accountId,
    p_notes: notes,
  });

  if (rpcError) return { success: false, error: rpcError.message };

  const rpcResult = result as { success: boolean; error?: string; total_cost?: number };
  if (!rpcResult?.success) {
    return { success: false, error: rpcResult?.error || "结算失败" };
  }

  /* ── 非关键后续操作：提醒、通知、回访（失败不阻断，仅记录日志） ── */
  try {
    const { data: order } = await supabase
      .from("work_orders")
      .select("vehicle_id, customer_id, mileage_in, vehicles(plate_number)")
      .eq("id", orderId)
      .single();

    if (order?.vehicle_id && order?.customer_id) {
      const now = new Date();
      const nextDate = new Date(now);
      nextDate.setMonth(nextDate.getMonth() + 6);

      const 车牌 =
        (Array.isArray(order.vehicles) ? order.vehicles[0]?.plate_number : null) || "";

      const reminderPromises = [
        supabase.from("maintenance_reminders").insert({
          vehicle_id: order.vehicle_id,
          customer_id: order.customer_id,
          reminder_type: "time",
          title: "常规保养提醒",
          due_date: nextDate.toISOString().split("T")[0],
          current_mileage: order.mileage_in || 0,
          work_order_id: orderId,
        }),
        supabase.from("maintenance_reminders").insert({
          vehicle_id: order.vehicle_id,
          customer_id: order.customer_id,
          reminder_type: "mileage",
          title: "里程保养提醒",
          due_mileage: (order.mileage_in || 0) + 5000,
          current_mileage: order.mileage_in || 0,
          work_order_id: orderId,
        }),
        supabase.from("notifications").insert({
          customer_id: order.customer_id,
          type: "work_order_status",
          title: "维修结算完成",
          content: `您的车辆 (${车牌}) 已完成维修结算，欢迎再次光临。`,
          related_type: "work_order",
          related_id: orderId,
        }),
      ];

      const results = await Promise.allSettled(reminderPromises);
      results.forEach((r, idx) => {
        if (r.status === "rejected" || (r.value && r.value.error)) {
          const names = ["时间保养提醒", "里程保养提醒", "客户通知"];
          console.error(`创建${names[idx]}失败:`,
            r.status === "rejected" ? r.reason : r.value?.error?.message);
        }
      });

      /* 售后回访：3 天后 */
      const scheduledDate = new Date(now);
      scheduledDate.setDate(scheduledDate.getDate() + 3);
      const { error: fuErr } = await supabase.from("follow_ups").insert({
        work_order_id: orderId,
        scheduled_at: scheduledDate.toISOString(),
      });
      if (fuErr) console.error("创建回访任务失败:", fuErr.message);
    }
  } catch (后续错误) {
    /* 后续步骤失败不影响结算结果 */
    console.error("结算后续步骤异常:", 后续错误);
  }

  clearWorkOrderDataCache(orderId);
  revalidatePath(`/work-orders/${orderId}`);
  revalidatePath("/work-orders");
  return { success: true, totalCost: rpcResult.total_cost };
}

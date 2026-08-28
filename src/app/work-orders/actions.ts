"use server";

import { revalidatePath } from "next/cache";
import { clearWorkOrderDataCache, 清基础数据缓存 } from "@/lib/workOrderData";
import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { logAction } from "@/lib/operationLog";

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

/* ═══ 工单需求页：保存需求 + 维修项目 + 配件 ═══
 * NewRequirementContent 的 7 处写库（需求、需求媒体、项目、项目配件）
 * 全部挪到服务端。提交人取服务端验证的登录用户。 */

export interface 提交配件行 {
  part_name_id: string;
  part_id: string;
  quantity: string;
  notes: string;
  part_number: string;
  name: string;
  alias_name: string;
  unit: string;
  brand: string;
  specification: string;
  unit_cost: string;
  unit_price: string;
  customer_opinion: string;
  is_purchased: boolean;
  is_arrived: boolean;
  supplier_name: string;
  logistics_agreement: string;
}

export interface 提交项目行 {
  service_item_id: string;
  name: string;
  alias_name: string;
  item_type: string;
  description: string;
  quantity: string;
  unit_price: string;
  mechanic_id: string;
  submitter_id: string;
  inspector_id: string;
  customer_opinion: string;
  is_outsourced: boolean;
  is_customer_part: boolean;
  outsourced_supplier_id: string;
  business_type: string;
  rework_source_item_id: string;
  rework_reason: string;
  rework_loss_amount: string;
  parts: 提交配件行[];
}

export async function 保存工单需求(参数: {
  orderId: string;
  existingRequirementId: string | null;
  requirement: { description: string; diagnosis: string; remarks: string };
  requirementImages: string[];
  requirementVideos: string[];
  items: 提交项目行[];
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const { orderId, existingRequirementId, requirement, requirementImages, requirementVideos, items } = 参数;
  const supabase = await createClient();

  let reqId: string;

  if (existingRequirementId) {
    /* 为已有需求添加项目，不创建新需求 */
    reqId = existingRequirementId;
  } else {
    const description = requirement.description.trim();
    const diagnosis = requirement.diagnosis.trim();
    const remarks = requirement.remarks.trim();
    if (!description) {
      return { success: false, error: "客户需求不能为空" };
    }
    const { data: req, error: reqError } = await supabase
      .from("work_order_requirements")
      .insert({
        work_order_id: orderId,
        description,
        diagnosis: diagnosis || null,
        remarks: remarks || null,
        submitted_by: user.id,
        diagnosis_submitter_id: diagnosis ? user.id : null,
        remarks_submitter_id: remarks ? user.id : null,
      })
      .select("id")
      .single();

    if (reqError || !req) {
      return { success: false, error: reqError?.message || "创建需求失败" };
    }
    reqId = (req as { id: string }).id;

    /* 保存需求图片 */
    if (requirementImages.length > 0) {
      await supabase.from("work_order_requirement_media").insert(
        requirementImages.map((path) => ({
          requirement_id: reqId,
          media_type: "image" as const,
          storage_path: path,
        }))
      );
    }

    /* 保存需求视频 */
    if (requirementVideos.length > 0) {
      await supabase.from("work_order_requirement_media").insert(
        requirementVideos.map((path) => ({
          requirement_id: reqId,
          media_type: "video" as const,
          storage_path: path,
        }))
      );
    }
  }

  /* 查询当前工单已有项目名称，防止重复 */
  const { data: existingItems } = await supabase
    .from("work_order_items")
    .select("name")
    .eq("work_order_id", orderId);
  const existingNames = new Set((existingItems as { name: string }[] | null)?.map((i) => i.name) || []);

  /* 检查本次添加的项目之间是否有重复 */
  const newNames = new Set<string>();
  for (const item of items) {
    if (!item.name) continue;
    if (newNames.has(item.name)) {
      return { success: false, error: `项目名称 "${item.name}" 在当前表单中重复，请检查` };
    }
    newNames.add(item.name);
  }

  for (const item of items) {
    if (!item.name) continue;
    if (existingNames.has(item.name)) {
      return { success: false, error: `项目名称 "${item.name}" 已在工单中存在，不能重复添加` };
    }
    const { data: createdItem, error: itemError } = await supabase
      .from("work_order_items")
      .insert({
        work_order_id: orderId,
        requirement_id: reqId,
        service_item_id: item.service_item_id || null,
        name: item.name,
        alias_name: item.alias_name || null,
        item_type: item.item_type,
        description: item.description || null,
        quantity: parseFloat(item.quantity) || 1,
        unit_price: parseFloat(item.unit_price) || 0,
        mechanic_id: item.mechanic_id || null,
        submitter_id: item.submitter_id || user.id,
        inspector_id: item.inspector_id || null,
        customer_opinion: item.customer_opinion || "pending",
        is_outsourced: item.is_outsourced || false,
        is_customer_part: item.is_customer_part || false,
        outsourced_supplier_id: item.outsourced_supplier_id || null,
        business_type: item.business_type || "normal",
        rework_source_item_id: item.rework_source_item_id || null,
        rework_reason: item.rework_reason || null,
        rework_loss_amount: item.rework_loss_amount ? parseFloat(item.rework_loss_amount) : null,
      })
      .select("id")
      .single();

    if (itemError || !createdItem) {
      return { success: false, error: itemError?.message || "创建项目失败" };
    }

    /* 创建项目配件 */
    for (const part of item.parts) {
      if (!part.part_name_id) continue;
      const { error: partError } = await supabase.from("work_order_item_parts").insert({
        work_order_item_id: (createdItem as { id: string }).id,
        part_name_id: part.part_name_id,
        part_id: part.part_id || null,
        quantity: parseInt(part.quantity) || 1,
        notes: part.notes || null,
        part_number: part.part_number || null,
        name: part.name || null,
        alias_name: part.alias_name || null,
        unit: part.unit || null,
        brand: part.brand || null,
        specification: part.specification || null,
        unit_cost: parseFloat(part.unit_cost) || null,
        unit_price: parseFloat(part.unit_price) || null,
        customer_opinion: part.customer_opinion || "pending",
        is_purchased: part.is_purchased || false,
        is_arrived: part.is_arrived || false,
        supplier_name: part.supplier_name || null,
        logistics_agreement: part.logistics_agreement || null,
        /* 新增配件各自成为独立目录(branch_group_id 由数据库默认生成)，
         * 是该目录唯一分支即选中分支，否则整组0选中会导致小计¥0 */
        is_selected: true,
      });
      if (partError) {
        return { success: false, error: partError.message };
      }
    }
  }

  clearWorkOrderDataCache(orderId);
  revalidatePath(`/work-orders/${orderId}`);
  return { success: true };
}

/* ═══ 工单需求页：现场新建标准维修项目 ═══ */
export async function 新建维修项目(参数: {
  name: string;
  category_id: string;
  description: string;
  default_price: string;
  vip_price: string;
  customer_parts_price: string;
  standard_hours: string;
  sales_type: string;
  sales_value: string;
  diagnosis_type: string;
  diagnosis_value: string;
  repair_type: string;
  repair_value: string;
  qc_type: string;
  qc_value: string;
}): Promise<{ success: boolean; item?: Record<string, unknown>; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const m = 参数;
  if (!m.name.trim()) {
    return { success: false, error: "请输入项目名称" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("service_items")
    .insert({
      name: m.name.trim(),
      category_id: m.category_id || null,
      description: m.description || null,
      default_price: parseFloat(m.default_price) || 0,
      vip_price: m.vip_price ? parseFloat(m.vip_price) : null,
      customer_parts_price: m.customer_parts_price ? parseFloat(m.customer_parts_price) : null,
      standard_hours: m.standard_hours ? parseFloat(m.standard_hours) : null,
      sales_commission_type: m.sales_type || null,
      sales_commission_value: m.sales_value ? parseFloat(m.sales_value) : null,
      diagnosis_commission_type: m.diagnosis_type || null,
      diagnosis_commission_value: m.diagnosis_value ? parseFloat(m.diagnosis_value) : null,
      repair_commission_type: m.repair_type || null,
      repair_commission_value: m.repair_value ? parseFloat(m.repair_value) : null,
      qc_commission_type: m.qc_type || null,
      qc_commission_value: m.qc_value ? parseFloat(m.qc_value) : null,
    })
    .select("*, service_categories(name)")
    .single();

  if (error || !data) {
    return { success: false, error: "新建项目失败: " + (error?.message || "未知错误") };
  }

  return { success: true, item: data as Record<string, unknown> };
}

/* ═══ 工单需求页：返工解锁原工单（settled → pending_settlement）═══ */
export async function 解锁工单(工单id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("work_orders")
    .update({ status: "pending_settlement" })
    .eq("id", 工单id);

  if (error) {
    return { success: false, error: error.message };
  }

  clearWorkOrderDataCache(工单id);
  revalidatePath(`/work-orders/${工单id}`);
  return { success: true };
}

/* ═══ 删除工单 Server Action ═══
 * 删除操作从客户端直写收口到服务端。
 * 数据库层已有删除权限门禁（仅 admin 且工单已取消才可删），此处由 RLS 兜底。 */
export async function 删除工单(工单id: string, 工单号: string, 删除原因: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!删除原因 || !删除原因.trim()) {
    return { success: false, error: "请填写删除原因" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("work_orders").delete().eq("id", 工单id);
  if (error) {
    return { success: false, error: error.message };
  }

  /* 记录操作日志（含删除原因，便于审计） */
  await logAction({
    actionType: "work_order_delete",
    targetTable: "work_orders",
    targetId: 工单id,
    targetName: 工单号,
    description: `删除工单 ${工单号}，原因: ${删除原因.trim()}`,
  });

  revalidatePath("/work-orders");
  return { success: true };
}

/* ═══ 删除工单项目行（维修项目） ═══ */
export async function 删除工单项目(itemId: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("work_order_items").delete().eq("id", itemId);
  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/* ═══ 删除工单项目分配的施工人 ═══ */
export async function 删除项目施工人(itemId: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("work_order_item_mechanics")
    .delete()
    .eq("work_order_item_id", itemId);
  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/* ═══ 单人领单（施工人=当前登录用户 100%，身份取服务端 user.id） ═══ */
export async function 单人领单(itemId: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error: delErr } = await supabase
    .from("work_order_item_mechanics")
    .delete()
    .eq("work_order_item_id", itemId);
  if (delErr) {
    return { success: false, error: delErr.message };
  }

  const { error } = await supabase.from("work_order_item_mechanics").insert({
    work_order_item_id: itemId,
    mechanic_id: user.id,
    share_pct: 100,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/* ═══ 保存施工指派（删旧 + 插新，分成比例由前端按规则算好后传入） ═══ */
export async function 保存施工指派(参数: {
  itemId: string;
  records: { mechanicId: string; sharePct: number }[];
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (参数.records.length === 0) {
    return { success: false, error: "请选择施工人" };
  }

  const supabase = await createClient();
  const { error: delErr } = await supabase
    .from("work_order_item_mechanics")
    .delete()
    .eq("work_order_item_id", 参数.itemId);
  if (delErr) {
    return { success: false, error: delErr.message };
  }

  const rows = 参数.records.map((r) => ({
    work_order_item_id: 参数.itemId,
    mechanic_id: r.mechanicId,
    share_pct: r.sharePct,
  }));
  const { error } = await supabase.from("work_order_item_mechanics").insert(rows);
  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/* ═══ 领取质检（质检人=当前登录用户，身份取服务端 user.id） ═══ */
export async function 领取质检(itemId: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("work_order_items")
    .update({ inspector_id: user.id })
    .eq("id", itemId);
  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/* ═══ 保存质检人（inspectorId 传 null 表示取消指派） ═══ */
export async function 保存质检人(参数: {
  itemId: string;
  inspectorId: string | null;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("work_order_items")
    .update({ inspector_id: 参数.inspectorId })
    .eq("id", 参数.itemId);
  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/* ═══ 批量修改工单项目/配件分支（批量修改弹窗） ═══
 * 只更新客户端明确传了的字段，未传字段不动。 */
export async function 批量修改工单明细(参数: {
  itemIds: string[];
  itemUpdates: {
    customer_opinion?: string;
    business_type?: string;
    alias_name?: string;
  };
  partIds: string[];
  partUpdates: {
    customer_opinion?: string;
    is_purchased?: boolean;
    is_arrived?: boolean;
    supplier_name?: string;
    logistics_agreement?: string;
    alias_name?: string;
  };
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();

  if (参数.itemIds.length > 0 && Object.keys(参数.itemUpdates).length > 0) {
    const { error } = await supabase
      .from("work_order_items")
      .update(参数.itemUpdates)
      .in("id", 参数.itemIds);
    if (error) {
      return { success: false, error: error.message };
    }
  }

  if (参数.partIds.length > 0 && Object.keys(参数.partUpdates).length > 0) {
    const { error } = await supabase
      .from("work_order_item_parts")
      .update(参数.partUpdates)
      .in("id", 参数.partIds);
    if (error) {
      return { success: false, error: error.message };
    }
  }

  return { success: true };
}

/* ═══ 切换项目标记（自带配件开关，可能同步带价格） ═══ */
export async function 切换项目标记(参数: {
  itemId: string;
  updates: { is_customer_part?: boolean; unit_price?: number | null };
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("work_order_items")
    .update(参数.updates)
    .eq("id", 参数.itemId);
  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/* ═══ 保存需求（新增/编辑 + 媒体增删，身份字段取服务端 user.id） ═══
 * 原来是 RequirementBatchModal 客户端多步直写。
 * changes 里只传客户端实际要改的字段；诊断/备注有改动时提交人自动记为当前登录用户。 */
export async function 保存需求(参数: {
  orderId: string;
  requirementId: string | null;
  description?: string;
  diagnosis?: string | null;
  remarks?: string | null;
  deletedMediaIds: string[];
  newMedia: { media_type: "image" | "video"; storage_path: string }[];
}): Promise<{ success: boolean; id?: string; seq?: number; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  let 需求ID = 参数.requirementId;

  if (需求ID) {
    /* ── 编辑模式 ── */
    const updateData: Record<string, string | null> = {};
    if (参数.description !== undefined) updateData.description = 参数.description;
    if (参数.diagnosis !== undefined) {
      updateData.diagnosis = 参数.diagnosis;
      updateData.diagnosis_submitter_id = 参数.diagnosis ? user.id : null;
    }
    if (参数.remarks !== undefined) {
      updateData.remarks = 参数.remarks;
      updateData.remarks_submitter_id = 参数.remarks ? user.id : null;
    }

    if (Object.keys(updateData).length > 0) {
      const { error } = await supabase
        .from("work_order_requirements")
        .update(updateData)
        .eq("id", 需求ID);
      if (error) return { success: false, error: error.message };
    }

    if (参数.deletedMediaIds.length > 0) {
      const { error } = await supabase
        .from("work_order_requirement_media")
        .delete()
        .in("id", 参数.deletedMediaIds);
      if (error) return { success: false, error: error.message };
    }
  } else {
    /* ── 新增模式：序号在服务端取（防并发重号） ── */
    const { data: existing } = await supabase
      .from("work_order_requirements")
      .select("seq")
      .eq("work_order_id", 参数.orderId)
      .order("seq", { ascending: false })
      .limit(1);
    const nextSeq = (existing && existing[0]?.seq ? existing[0].seq : 0) + 1;

    const { data: req, error: reqError } = await supabase
      .from("work_order_requirements")
      .insert({
        work_order_id: 参数.orderId,
        seq: nextSeq,
        description: 参数.description ?? "",
        submitted_by: user.id,
        diagnosis: 参数.diagnosis || null,
        remarks: 参数.remarks || null,
        diagnosis_submitter_id: 参数.diagnosis ? user.id : null,
        remarks_submitter_id: 参数.remarks ? user.id : null,
      })
      .select("id")
      .single();
    if (reqError || !req) {
      return { success: false, error: reqError?.message || "创建需求失败" };
    }
    需求ID = req.id;

    if (参数.newMedia.length > 0) {
      const mediaRecords = 参数.newMedia.map((m) => ({
        requirement_id: 需求ID,
        media_type: m.media_type,
        storage_path: m.storage_path,
      }));
      const { error: mediaError } = await supabase
        .from("work_order_requirement_media")
        .insert(mediaRecords);
      if (mediaError) return { success: false, error: mediaError.message };
    }

    return { success: true, id: 需求ID, seq: nextSeq };
  }

  /* 编辑模式的媒体新增 */
  if (参数.newMedia.length > 0 && 需求ID) {
    const mediaRecords = 参数.newMedia.map((m) => ({
      requirement_id: 需求ID,
      media_type: m.media_type,
      storage_path: m.storage_path,
    }));
    const { error: mediaError } = await supabase
      .from("work_order_requirement_media")
      .insert(mediaRecords);
    if (mediaError) return { success: false, error: mediaError.message };
  }

  return { success: true, id: 需求ID };
}

/* ═══ 指派需求给某人（指派人取服务端 user.id） ═══ */
export async function 指派需求(参数: {
  requirementId: string;
  assigneeId: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("work_order_requirements")
    .update({
      assigned_to: 参数.assigneeId,
      assignment_type: "assigned",
      dispatcher_id: user.id,
    })
    .eq("id", 参数.requirementId);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

/* ═══ 领取需求（领单人=当前登录用户，取服务端 user.id） ═══ */
export async function 领取需求(requirementId: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("work_order_requirements")
    .update({
      assigned_to: user.id,
      assignment_type: "claimed",
      dispatcher_id: null,
    })
    .eq("id", requirementId);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

/* ═══ 取消需求指派 ═══ */
export async function 取消需求指派(requirementId: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("work_order_requirements")
    .update({ assigned_to: null, assignment_type: null, dispatcher_id: null })
    .eq("id", requirementId);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

/* ═══ 删除需求（服务端先查是否挂有维修项目，有则拒绝） ═══ */
export async function 删除需求(requirementId: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { count, error: 查询错误 } = await supabase
    .from("work_order_items")
    .select("id", { count: "exact", head: true })
    .eq("requirement_id", requirementId);
  if (查询错误) return { success: false, error: "检查项目失败: " + 查询错误.message };
  if ((count ?? 0) > 0) {
    return { success: false, error: `该需求下有 ${count} 个维修项目，无法删除。请先删除这些维修项目，再删除需求。` };
  }

  const { error } = await supabase
    .from("work_order_requirements")
    .delete()
    .eq("id", requirementId);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

/* ═══ 保存检查单（车况检查/接车检查：建/改记录 + 工单里程照片 + 媒体） ═══
 * 原来是检查页客户端 4 步连写（改/建记录 → 删旧媒体 → 改工单 → 插媒体），
 * 收编到服务端一次完成；提交人取服务端 user.id（仅车况检查，与原有口径一致）。 */
export interface 检查单数据 {
  front_brake_pad_thickness?: number | null;
  rear_brake_pad_thickness?: number | null;
  exhaust_hc?: number | null;
  exhaust_co?: number | null;
  exhaust_no?: number | null;
  exhaust_co2?: number | null;
  exhaust_o2?: number | null;
  light_checks?: Record<string, string> | null;
  engine_oil_before_level?: number | null;
  engine_oil_after_level?: number | null;
  coolant_ph?: number | null;
  brake_fluid_water?: number | null;
  battery_health?: number | null;
  battery_voltage?: number | null;
  drive_belt_status?: string | null;
  tire_checks?: Record<string, unknown> | null;
  inspection_mileage?: number | null;
  notes?: string | null;
}

export async function 保存检查单(参数: {
  orderId: string;
  inspectionType: "inspection" | "reception";
  inspectionId: string | null;
  data: 检查单数据;
  mileage: number | null;
  dashboardPaths: string[];
  media: { media_type: string; storage_path: string; annotations?: unknown }[];
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  let inspectionId = 参数.inspectionId;

  if (inspectionId) {
    /* 更新已有记录（车况检查编辑模式） */
    const { error: updateError } = await supabase
      .from("work_order_inspections")
      .update(参数.data)
      .eq("id", inspectionId);
    if (updateError) return { success: false, error: updateError.message };

    /* 删除旧媒体 */
    const { error: delErr } = await supabase
      .from("work_order_inspection_media")
      .delete()
      .eq("inspection_id", inspectionId);
    if (delErr) return { success: false, error: delErr.message };
  } else {
    /* 新建记录（提交人：仅车况检查记录，与原有口径一致） */
    const { data: inspection, error: inspectionError } = await supabase
      .from("work_order_inspections")
      .insert({
        work_order_id: 参数.orderId,
        inspection_type: 参数.inspectionType,
        submitter_id: 参数.inspectionType === "inspection" ? user.id : null,
        ...参数.data,
      })
      .select("id")
      .single();
    if (inspectionError || !inspection) {
      return { success: false, error: inspectionError?.message || "创建检查记录失败" };
    }
    inspectionId = inspection.id;
  }

  /* 统一更新工单里程和共享仪表照片 */
  const orderUpdate: Record<string, number | string[] | null> = {};
  if (参数.mileage) orderUpdate.mileage_in = 参数.mileage;
  orderUpdate.dashboard_photos = 参数.dashboardPaths.length > 0 ? 参数.dashboardPaths : null;
  const { error: orderErr } = await supabase
    .from("work_orders")
    .update(orderUpdate)
    .eq("id", 参数.orderId);
  if (orderErr) return { success: false, error: orderErr.message };

  /* 插入检查媒体 */
  if (参数.media.length > 0) {
    const mediaRecords = 参数.media.map((m) => ({
      inspection_id: inspectionId,
      media_type: m.media_type,
      storage_path: m.storage_path,
      ...(m.annotations !== undefined ? { annotations: m.annotations } : {}),
    }));
    const { error: mediaError } = await supabase
      .from("work_order_inspection_media")
      .insert(mediaRecords);
    if (mediaError) return { success: false, error: mediaError.message };
  }

  clearWorkOrderDataCache(参数.orderId);
  revalidatePath(`/work-orders/${参数.orderId}`);
  return { success: true };
}

/* ═══ 批量保存分支编辑（采购看板行内编辑，多行不同字段） ═══ */
export async function 批量保存分支编辑(参数: {
  updates: { id: string; data: 配件分支更新 }[];
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (参数.updates.length === 0) {
    return { success: true };
  }

  const supabase = await createClient();
  for (const u of 参数.updates) {
    const { error } = await supabase
      .from("work_order_item_parts")
      .update(u.data)
      .eq("id", u.id);
    if (error) {
      return { success: false, error: error.message };
    }
  }

  return { success: true };
}

/* ═══ 撤销分支价格（待报价撤销→清进价 / 待确认撤销→清销售价） ═══ */
export async function 撤销分支价格(参数: {
  ids: string[];
  field: "unit_cost" | "unit_price";
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (参数.ids.length === 0) {
    return { success: true };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("work_order_item_parts")
    .update({ [参数.field]: null })
    .in("id", 参数.ids);
  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/* ═══ 分支关联库存配件并同步采购明细（两张表一起写，服务端一次完成） ═══
 * 分支行写入配件快照信息；关联的采购明细行同步换配件。 */
export async function 分支关联配件并同步采购(参数: {
  branchId: string;
  partId: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data: part } = await supabase
    .from("parts")
    .select("part_number, name, unit, part_categories(name), part_brands(name), part_specifications(name), purchase_price, notes, document_name")
    .eq("id", 参数.partId)
    .single();

  interface 配件详情 {
    part_number: string | null;
    name: string | null;
    unit: string | null;
    purchase_price: number | null;
    notes: string | null;
    document_name: string | null;
    part_brands: { name: string | null } | { name: string | null }[] | null;
    part_specifications: { name: string | null } | { name: string | null }[] | null;
    part_categories: { name: string | null } | { name: string | null }[] | null;
  }
  const p = part as unknown as 配件详情 | null;
  const 取名 = (v: { name: string | null } | { name: string | null }[] | null | undefined): string | null =>
    !v ? null : Array.isArray(v) ? v[0]?.name ?? null : v.name ?? null;

  /* 1. 分支行写入快照 */
  const updates: 配件分支更新 = { part_id: 参数.partId };
  if (p) {
    if (p.part_number != null) updates.part_number = p.part_number;
    if (p.name != null) updates.name = p.name;
    if (p.unit != null) updates.unit = p.unit;
    const brandName = 取名(p.part_brands);
    const specName = 取名(p.part_specifications);
    if (brandName != null) updates.brand = brandName;
    if (specName != null) updates.specification = specName;
    if (p.purchase_price != null) updates.unit_cost = p.purchase_price;
    if (p.notes != null) updates.notes = p.notes;
    if (p.document_name != null) updates.document_name = p.document_name;
  }

  const { error } = await supabase
    .from("work_order_item_parts")
    .update(updates)
    .eq("id", 参数.branchId);
  if (error) {
    return { success: false, error: error.message };
  }

  /* 2. 同步更新关联的采购明细（失败仅告警不阻断，与原逻辑一致） */
  const { error: poiErr } = await supabase
    .from("purchase_order_items")
    .update({
      part_id: 参数.partId,
      part_number: p?.part_number || updates.part_number || null,
      name: p?.name || updates.name || null,
      unit: p?.unit || updates.unit || null,
      brand: 取名(p?.part_brands) || updates.brand || null,
      specification: 取名(p?.part_specifications) || updates.specification || null,
      category: 取名(p?.part_categories) || null,
    })
    .eq("work_order_item_part_id", 参数.branchId);
  if (poiErr) console.warn("同步采购单配件信息失败:", poiErr);

  return { success: true };
}

/* ═══ 更新配件分支字段（PartBranchEditor 各类单字段保存） ═══
 * 只更新传了的字段；原来是客户端直写 work_order_item_parts。 */
export interface 配件分支更新 {
  part_number?: string | null;
  brand?: string | null;
  specification?: string | null;
  unit_cost?: number | null;
  unit_price?: number | null;
  cost_price?: number | null;
  document_name?: string | null;
  part_id?: string | null;
  part_name_id?: string | null;
  branch_group_id?: string | null;
  is_selected?: boolean;
  quantity?: number | null;
  customer_opinion?: string | null;
  supplier_name?: string | null;
  name?: string | null;
  unit?: string | null;
  notes?: string | null;
}

/* ═══ 批量更新配件分支字段（同组多分支一起改：数量/名称替换/关联库存配件） ═══ */
export async function 批量更新配件分支(参数: {
  partIds: string[];
  updates: 配件分支更新;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (参数.partIds.length === 0 || Object.keys(参数.updates).length === 0) {
    return { success: true };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("work_order_item_parts")
    .update(参数.updates)
    .in("id", 参数.partIds);
  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/* ═══ 配件分支图片记录 增/删（上传成功后写记录 / 删除时清记录） ═══ */
export async function 添加配件图片记录(参数: {
  partBranchId: string;
  paths: string[];
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (参数.paths.length === 0) {
    return { success: true };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("work_order_item_part_media").insert(
    参数.paths.map((path) => ({
      work_order_item_part_id: 参数.partBranchId,
      media_type: "image",
      storage_path: path,
    }))
  );
  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function 删除配件图片记录(参数: {
  partBranchId: string;
  path: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("work_order_item_part_media")
    .delete()
    .eq("work_order_item_part_id", 参数.partBranchId)
    .eq("storage_path", 参数.path);
  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function 更新配件分支(参数: {
  partId: string;
  updates: 配件分支更新;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (Object.keys(参数.updates).length === 0) {
    return { success: true };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("work_order_item_parts")
    .update(参数.updates)
    .eq("id", 参数.partId);
  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/* ═══ 按组更新配件分支目录（替换分组名：同组所有分支一起改） ═══ */
export async function 按组更新分支目录(参数: {
  branchGroupId: string;
  partNameId: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("work_order_item_parts")
    .update({ part_name_id: 参数.partNameId })
    .eq("branch_group_id", 参数.branchGroupId);
  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/* ═══ 分支图片同步到配件信息图片（新建配件保存后调用） ═══
 * 把分支里的图片按路径去重写入 part_images（用户拍板 2026-08-06：
 * 通过分支信息新建配件时，分支里的图片就是这个配件信息中的图片）。
 * 整个"读分支图 → 读已有 → 插缺"链路挪到服务端一次完成。 */
export async function 同步分支图片到配件(参数: {
  partId: string;
  workOrderItemPartId: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data: 分支图片 } = await supabase
    .from("work_order_item_part_media")
    .select("storage_path")
    .eq("work_order_item_part_id", 参数.workOrderItemPartId)
    .eq("media_type", "image");
  const 图片路径 = ((分支图片 || []) as { storage_path: string | null }[])
    .map((r) => r.storage_path)
    .filter((p): p is string => !!p);
  if (图片路径.length === 0) {
    return { success: true };
  }

  const { data: 已有 } = await supabase
    .from("part_images")
    .select("storage_path, sort_order")
    .eq("part_id", 参数.partId);
  const 已有路径 = new Set(((已有 || []) as { storage_path: string | null }[]).map((r) => r.storage_path));
  const 新图 = 图片路径.filter((p) => !已有路径.has(p));
  if (新图.length === 0) {
    return { success: true };
  }

  const 起始 = ((已有 || []) as { sort_order: number | null }[]).reduce((s, r) => Math.max(s, r.sort_order || 0), 0);
  const { error } = await supabase.from("part_images").insert(
    新图.map((p, i) => ({ part_id: 参数.partId, storage_path: p, sort_order: 起始 + i + 1 }))
  );
  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/* ═══ 保存工单项目字段（手机端编辑：客户意见/自带件/描述/数量/单价） ═══ */
export async function 保存工单项目字段(参数: {
  itemId: string;
  updates: {
    customer_opinion?: string | null;
    is_customer_part?: boolean;
    description?: string | null;
    unit_price?: number;
    quantity?: number;
  };
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("work_order_items")
    .update(参数.updates)
    .eq("id", 参数.itemId);
  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/* ═══ 放弃领单（删掉自己 + 剩余施工人重摊为均分） ═══
 * 剩余名单在服务端读最新值，避免用客户端旧名单重摊。 */
export async function 放弃领单(itemId: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error: delErr } = await supabase
    .from("work_order_item_mechanics")
    .delete()
    .eq("work_order_item_id", itemId)
    .eq("mechanic_id", user.id);
  if (delErr) {
    return { success: false, error: delErr.message };
  }

  const { data: remaining } = await supabase
    .from("work_order_item_mechanics")
    .select("mechanic_id")
    .eq("work_order_item_id", itemId);

  if (remaining && remaining.length > 0) {
    const ratio = Math.round((100 / remaining.length) * 100) / 100;
    for (const r of remaining as { mechanic_id: string }[]) {
      const { error } = await supabase
        .from("work_order_item_mechanics")
        .update({ share_pct: ratio })
        .eq("work_order_item_id", itemId)
        .eq("mechanic_id", r.mechanic_id);
      if (error) {
        return { success: false, error: error.message };
      }
    }
  }

  return { success: true };
}

/* ═══ 转换工单类型（正常/预约/报价/作废/保养） ═══ */
export async function 转换工单类型(参数: {
  workOrderId: string;
  type: "normal" | "appointment" | "quote" | "cancelled" | "maintenance";
  cancelledReason?: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const updates: Record<string, string | null> = { order_type: 参数.type };
  if (参数.type === "appointment") {
    updates.appointment_at = new Date().toISOString();
  }
  if (参数.type === "cancelled") {
    const reason = (参数.cancelledReason || "").trim();
    if (!reason) {
      return { success: false, error: "请填写作废原因" };
    }
    updates.cancelled_reason = reason;
  }

  const supabase = await createClient();
  const { error } = await supabase.from("work_orders").update(updates).eq("id", 参数.workOrderId);
  if (error) {
    return { success: false, error: error.message };
  }

  clearWorkOrderDataCache(参数.workOrderId);
  revalidatePath(`/work-orders/${参数.workOrderId}`);
  return { success: true };
}

/* ═══ 删除报销项（保存报销单时先删旧） ═══ */
export async function 删除报销项(reimbursementId: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("work_order_reimbursement_items")
    .delete()
    .eq("reimbursement_id", reimbursementId);
  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/* ═══ 保存报销单（建/改头 + 删旧明细 + 插新明细，服务端一次完成） ═══
 * 原来是客户端三步连写，收编到服务端避免 session 异常中途断档。
 * 报销单只用于打印，不影响利润/绩效/库存（页面原有口径）。 */
export async function 保存报销单(参数: {
  orderId: string;
  reimbursementId: string | null;
  title: string;
  companyName: string;
  notes: string;
  items: { name: string; spec: string; quantity: number; unit_price: number; total_price: number }[];
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const validItems = 参数.items.filter((it) => it.name.trim() !== "");
  if (validItems.length === 0) {
    return { success: false, error: "请至少填写一条项目" };
  }

  const supabase = await createClient();
  let rid = 参数.reimbursementId;

  if (!rid) {
    const { data: created, error: createErr } = await supabase
      .from("work_order_reimbursements")
      .insert({
        work_order_id: 参数.orderId,
        title: 参数.title || "维修费用报销单",
        company_name: 参数.companyName.trim() || null,
        notes: 参数.notes.trim() || null,
      })
      .select("id")
      .single();
    if (createErr || !created) {
      return { success: false, error: createErr?.message || "创建报销单失败" };
    }
    rid = created.id;
  } else {
    const { error: updErr } = await supabase
      .from("work_order_reimbursements")
      .update({
        title: 参数.title || "维修费用报销单",
        company_name: 参数.companyName.trim() || null,
        notes: 参数.notes.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rid);
    if (updErr) {
      return { success: false, error: updErr.message };
    }

    const { error: delErr } = await supabase
      .from("work_order_reimbursement_items")
      .delete()
      .eq("reimbursement_id", rid);
    if (delErr) {
      return { success: false, error: delErr.message };
    }
  }

  const rows = validItems.map((it, idx) => ({
    reimbursement_id: rid,
    name: it.name.trim(),
    spec: it.spec.trim() || null,
    quantity: it.quantity,
    unit_price: it.unit_price,
    total_price: it.total_price,
    sort_order: idx,
  }));
  const { error: itemErr } = await supabase.from("work_order_reimbursement_items").insert(rows);
  if (itemErr) {
    return { success: false, error: itemErr.message };
  }

  return { success: true };
}

/* ═══ 删除检查媒体（保存检查单时先删旧） ═══ */
export async function 删除检查媒体(inspectionId: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("work_order_inspection_media")
    .delete()
    .eq("inspection_id", inspectionId);
  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/* ═══ 登记预收款（涉钱，走原子事务 RPC） ═══
 * 原来是客户端"插记录 + 改工单预收额"两步直写，网络闪断会钱对不上。
 * 收编为 register_advance_payment RPC 一个事务；收款人 id 取服务端 user.id。 */
export async function 登记预收款(参数: {
  orderId: string;
  amount: number;
  method: string;
  collectorName: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data: result, error: rpcError } = await supabase.rpc("register_advance_payment", {
    p_work_order_id: 参数.orderId,
    p_amount: 参数.amount,
    p_method: 参数.method,
    p_collector_name: 参数.collectorName,
  });

  if (rpcError) return { success: false, error: rpcError.message };
  const rpcResult = result as { success: boolean; error?: string };
  if (!rpcResult?.success) {
    return { success: false, error: rpcResult?.error || "保存失败" };
  }

  /* 清工单缓存，让详情页立即显示最新预收额 */
  clearWorkOrderDataCache(参数.orderId);
  revalidatePath(`/work-orders/${参数.orderId}`);
  return { success: true };
}

/* ═══ 预收款退款（涉钱，走原子事务 RPC） ═══
 * 原来是客户端"改记录已退额 + 改工单预收额"两步直写。
 * 收编为 refund_advance_payment RPC 一个事务，行锁防并发超退。 */
export async function 预收款退款(参数: {
  orderId: string;
  recordId: string;
  amount: number;
  refundMethod: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data: result, error: rpcError } = await supabase.rpc("refund_advance_payment", {
    p_record_id: 参数.recordId,
    p_amount: 参数.amount,
    p_refund_method: 参数.refundMethod,
  });

  if (rpcError) return { success: false, error: rpcError.message };
  const rpcResult = result as { success: boolean; error?: string };
  if (!rpcResult?.success) {
    return { success: false, error: rpcResult?.error || "退款失败" };
  }

  clearWorkOrderDataCache(参数.orderId);
  revalidatePath(`/work-orders/${参数.orderId}`);
  return { success: true };
}

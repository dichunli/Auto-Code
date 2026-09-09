"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* 退料明细输入（快照字段由前端从工单配件分支/领料记录带入） */
export interface 退料明细输入 {
  work_order_item_part_id: string;
  picking_record_id: string;
  part_id: string | null;
  batch_id: string | null;
  quantity: number;
  return_type?: string | null;
  part_number?: string | null;
  name?: string | null;
  brand?: string | null;
  specification?: string | null;
  unit?: string | null;
  batch_no?: string | null;
  unit_cost?: number | null;
}

interface 开单结果 {
  success: boolean;
  data?: { id: string; no: string };
  error?: string;
}

interface RPC返回 {
  success: boolean;
  error?: string;
  return_order_id?: string;
  return_no?: string;
}

/**
 * 创建退料单（原子操作：建单 + 逐条退回库存 + 写明细，任一步失败整体回滚）
 * 可退数量由数据库触发器校验（不超过该领料记录的净领量）
 */
export async function 创建退料单(
  工单id: string | null,
  领料单id: string | null,
  明细: 退料明细输入[],
  退料类型: string,
  原因: string,
  备注: string
): Promise<开单结果> {
  if (!明细 || 明细.length === 0) {
    return { success: false, error: "退料明细不能为空" };
  }
  for (const m of 明细) {
    if (!m.picking_record_id || !m.work_order_item_part_id) {
      return { success: false, error: "退料明细缺少领料记录或配件分支信息" };
    }
    if (!Number.isInteger(m.quantity) || m.quantity <= 0) {
      return { success: false, error: "退料数量必须是大于 0 的整数" };
    }
  }

  const supabase = await createClient();
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "登录已失效，请重新登录" };
  }

  const { data, error } = await supabase.rpc("create_material_return_order", {
    p_work_order_id: 工单id,
    p_picking_order_id: 领料单id,
    p_items: 明细,
    p_return_type: 退料类型,
    p_reason: 原因,
    p_notes: 备注,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "创建退料单失败" };
  }

  revalidatePath("/material-returns");
  revalidatePath("/picking");
  if (工单id) {
    revalidatePath(`/work-orders/${工单id}`);
  }
  return {
    success: true,
    data: { id: 结果.return_order_id!, no: 结果.return_no! },
  };
}

/* ═══ 退料申请（师傅手机端发起，只记意向不动库存；库管确认后才开退料单） ═══ */

interface 申请结果 {
  success: boolean;
  error?: string;
}

const 允许退料类型 = ["excess", "wrong_pick", "wrong_ship", "damaged"];

/**
 * 发起退料申请（师傅手机端）
 * 只写 part_return_requests 申请表，不动库存；库管确认后才生成退料单
 */
export async function 申请退料(
  领料记录id: string,
  数量: number,
  类型: string,
  原因: string
): Promise<申请结果> {
  if (!Number.isInteger(数量) || 数量 <= 0) {
    return { success: false, error: "退料数量必须是大于 0 的整数" };
  }
  if (!允许退料类型.includes(类型)) {
    return { success: false, error: "退料类型不正确" };
  }
  const supabase = await createClient();
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "登录已失效，请重新登录" };
  }

  /* 服务端校验可退数量：已领 - 已退 - 申请中（防止与库管确认并发超退） */
  const { data: 领料记录 } = await supabase
    .from("part_picking_records")
    .select("id, work_order_item_part_id, quantity")
    .eq("id", 领料记录id)
    .single();
  if (!领料记录) {
    return { success: false, error: "领料记录不存在" };
  }
  const [{ data: 已退记录 }, { data: 申请中记录 }] = await Promise.all([
    supabase.from("part_return_records").select("quantity").eq("picking_record_id", 领料记录id),
    supabase.from("part_return_requests").select("quantity").eq("picking_record_id", 领料记录id).eq("status", "pending"),
  ]);
  const 已退 = (已退记录 || []).reduce((s, r) => s + (r.quantity || 0), 0);
  const 申请中 = (申请中记录 || []).reduce((s, r) => s + (r.quantity || 0), 0);
  if (已退 + 申请中 + 数量 > 领料记录.quantity) {
    return {
      success: false,
      error: `超出可退数量：该笔已领 ${领料记录.quantity} 件，已退 ${已退} 件，申请中 ${申请中} 件`,
    };
  }

  const { error } = await supabase.from("part_return_requests").insert({
    work_order_item_part_id: 领料记录.work_order_item_part_id,
    picking_record_id: 领料记录id,
    quantity: 数量,
    return_type: 类型,
    reason: 原因.trim() || null,
    requested_by: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}

/* 取消退料申请（仅待确认的可取消，对称"取消申领"） */
export async function 取消退料申请(申请id: string): Promise<申请结果> {
  const supabase = await createClient();
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "登录已失效，请重新登录" };
  }
  const { error } = await supabase
    .from("part_return_requests")
    .update({ status: "cancelled" })
    .eq("id", 申请id)
    .eq("status", "pending");
  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}

/* 退料申请关联查询的返回形状 */
interface 申请联查行 {
  id: string;
  work_order_item_part_id: string;
  picking_record_id: string;
  quantity: number;
  return_type: string;
  reason: string | null;
  work_order_item_parts: {
    part_id: string | null;
    part_number: string | null;
    name: string | null;
    brand: string | null;
    specification: string | null;
    unit: string | null;
    unit_cost: number | null;
    work_order_items: { work_order_id: string } | null;
  } | null;
  part_picking_records: {
    batch_id: string | null;
    picking_order_id: string | null;
    part_batches: { batch_no: string | null } | null;
  } | null;
}

/**
 * 库管确认退料申请：按工单分组，每组生成一张退料单（TL-，触发器加回库存），
 * 成功后把申请标记 done 并记录退料单 id
 */
export async function 确认退料申请(申请ids: string[]): Promise<申请结果 & { 退料单号?: string[] }> {
  if (!申请ids || 申请ids.length === 0) {
    return { success: false, error: "请先勾选要确认的退料申请" };
  }
  const supabase = await createClient();
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "登录已失效，请重新登录" };
  }

  const { data: 申请数据, error: 查询错误 } = await supabase
    .from("part_return_requests")
    .select(`
      id, work_order_item_part_id, picking_record_id, quantity, return_type, reason,
      work_order_item_parts(
        part_id, part_number, name, brand, specification, unit, unit_cost,
        work_order_items(work_order_id)
      ),
      part_picking_records(batch_id, picking_order_id, part_batches(batch_no))
    `)
    .in("id", 申请ids)
    .eq("status", "pending");
  if (查询错误) {
    return { success: false, error: 查询错误.message };
  }
  const 申请列表 = (申请数据 || []) as unknown as 申请联查行[];
  if (申请列表.length === 0) {
    return { success: false, error: "没有待确认的退料申请（可能已被其他人处理）" };
  }

  /* 按工单分组：一张退料单只能挂一个工单 */
  const 按工单 = new Map<string, 申请联查行[]>();
  for (const r of 申请列表) {
    const 工单id = r.work_order_item_parts?.work_order_items?.work_order_id;
    if (!工单id) {
      return { success: false, error: "申请数据异常：找不到关联工单" };
    }
    const 组 = 按工单.get(工单id) || [];
    组.push(r);
    按工单.set(工单id, 组);
  }

  const 生成单号: string[] = [];
  for (const [工单id, 组内申请] of 按工单) {
    const 明细: 退料明细输入[] = 组内申请.map((r) => ({
      work_order_item_part_id: r.work_order_item_part_id,
      picking_record_id: r.picking_record_id,
      part_id: r.work_order_item_parts?.part_id || null,
      batch_id: r.part_picking_records?.batch_id || null,
      quantity: r.quantity,
      return_type: r.return_type,
      part_number: r.work_order_item_parts?.part_number,
      name: r.work_order_item_parts?.name,
      brand: r.work_order_item_parts?.brand,
      specification: r.work_order_item_parts?.specification,
      unit: r.work_order_item_parts?.unit,
      batch_no: r.part_picking_records?.part_batches?.batch_no,
      unit_cost: r.work_order_item_parts?.unit_cost,
    }));
    /* 退料单原因：汇总各申请的原因；类型走明细行自带类型 */
    const 原因汇总 = [...new Set(组内申请.map((r) => r.reason).filter(Boolean))].join("；");
    const { data, error } = await supabase.rpc("create_material_return_order", {
      p_work_order_id: 工单id,
      p_picking_order_id: 组内申请[0]?.part_picking_records?.picking_order_id || null,
      p_items: 明细,
      p_return_type: "",
      p_reason: 原因汇总,
      p_notes: "退料申请确认生成",
      p_operator_id: user.id,
    });
    if (error) {
      return { success: false, error: `已生成 ${生成单号.join("、") || "无"}；本组失败：${error.message}` };
    }
    const 结果 = data as unknown as RPC返回;
    if (!结果?.success) {
      return { success: false, error: `已生成 ${生成单号.join("、") || "无"}；本组失败：${结果?.error || "创建退料单失败"}` };
    }
    生成单号.push(结果.return_no!);

    /* 核销：申请标 done 并记录退料单 id */
    await supabase
      .from("part_return_requests")
      .update({ status: "done", done_at: new Date().toISOString(), done_by: user.id, return_order_id: 结果.return_order_id })
      .in("id", 组内申请.map((r) => r.id));

    revalidatePath(`/work-orders/${工单id}`);
  }

  revalidatePath("/material-returns");
  revalidatePath("/picking");
  return { success: true, 退料单号: 生成单号 };
}

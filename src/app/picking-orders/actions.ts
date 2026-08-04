"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* 领料明细输入（快照字段由前端从工单配件分支带入） */
export interface 领料明细输入 {
  work_order_item_part_id: string;
  part_id: string | null;
  batch_id: string;
  quantity: number;
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
  picking_order_id?: string;
  picking_no?: string;
}

/**
 * 创建领料单（原子操作：建单 + 逐条扣库存 + 写明细，任一步失败整体回滚）
 * 库存扣减由数据库触发器完成，批次剩余不足或总库存不足会直接报错
 */
export async function 创建领料单(
  工单id: string | null,
  明细: 领料明细输入[],
  领料人: string,
  备注: string
): Promise<开单结果> {
  if (!明细 || 明细.length === 0) {
    return { success: false, error: "领料明细不能为空" };
  }
  for (const m of 明细) {
    if (!m.batch_id || !m.work_order_item_part_id) {
      return { success: false, error: "领料明细缺少批次或配件分支信息" };
    }
    if (!Number.isInteger(m.quantity) || m.quantity <= 0) {
      return { success: false, error: "领料数量必须是大于 0 的整数" };
    }
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "登录已失效，请重新登录" };
  }

  const { data, error } = await supabase.rpc("create_picking_order", {
    p_work_order_id: 工单id,
    p_items: 明细,
    p_receiver_name: 领料人,
    p_notes: 备注,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "创建领料单失败" };
  }

  /* 实领后自动核销申领：按分支"剩余实领额度 = 累计实领 - 已核销申领"，
   * 从最早开始逐条覆盖，能盖住就标记 done（退库导致的倒挂不在此处理） */
  const 分支ids = [...new Set(明细.map((m) => m.work_order_item_part_id))];
  for (const 分支id of 分支ids) {
    const [{ data: 实领记录 }, { data: 全部申领 }] = await Promise.all([
      supabase.from("part_picking_records").select("quantity").eq("work_order_item_part_id", 分支id),
      supabase.from("part_pick_requests").select("id, quantity, status").eq("work_order_item_part_id", 分支id).order("created_at", { ascending: true }),
    ]);
    const 待核销 = (全部申领 || []).filter((r) => r.status === "pending");
    if (待核销.length === 0) continue;
    const 实领总数 = (实领记录 || []).reduce((s, r) => s + (r.quantity || 0), 0);
    let 剩余额度 = 实领总数 - (全部申领 || []).filter((r) => r.status === "done").reduce((s, r) => s + (r.quantity || 0), 0);
    const 核销ids: string[] = [];
    for (const r of 待核销) {
      if (剩余额度 >= r.quantity) {
        核销ids.push(r.id);
        剩余额度 -= r.quantity;
      }
    }
    if (核销ids.length > 0) {
      await supabase
        .from("part_pick_requests")
        .update({ status: "done", done_at: new Date().toISOString(), done_by: user.id })
        .in("id", 核销ids);
    }
  }

  revalidatePath("/picking-orders");
  if (工单id) {
    revalidatePath(`/work-orders/${工单id}`);
  }
  return {
    success: true,
    data: { id: 结果.picking_order_id!, no: 结果.picking_no! },
  };
}

/* ═══ 配件申领（师傅手机端发起，只记需求不动库存；库管实领后自动核销） ═══ */

interface 申领结果 {
  success: boolean;
  error?: string;
}

/* 发起申领 */
export async function 申领配件(分支id: string, 数量: number, 备注: string): Promise<申领结果> {
  if (!Number.isInteger(数量) || 数量 <= 0) {
    return { success: false, error: "申领数量必须是大于 0 的整数" };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "登录已失效，请重新登录" };
  }
  const { error } = await supabase.from("part_pick_requests").insert({
    work_order_item_part_id: 分支id,
    quantity: 数量,
    notes: 备注.trim() || null,
    requested_by: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}

/* 取消申领（仅待出库的可取消） */
export async function 取消申领(申领id: string): Promise<申领结果> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "登录已失效，请重新登录" };
  }
  const { error } = await supabase
    .from("part_pick_requests")
    .update({ status: "cancelled" })
    .eq("id", 申领id)
    .eq("status", "pending");
  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}

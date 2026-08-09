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
  if (工单id) {
    revalidatePath(`/work-orders/${工单id}`);
  }
  return {
    success: true,
    data: { id: 结果.return_order_id!, no: 结果.return_no! },
  };
}

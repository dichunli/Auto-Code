"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 工单配件行（woip）写操作 Server Action（2026-08-19 批次5B 阶段1） ═══
 * 这些写操作收编为 RPC 事务函数（SECURITY DEFINER + 五角色门禁），
 * 为阶段 2 的表策略收紧（DELETE/INSERT 角色化）做准备——表收紧后客户端直写会被拦，
 * 全部改走这里的函数通道。 */

interface 操作结果 {
  success: boolean;
  error?: string;
}

interface RPC返回 extends 操作结果 {
  new_selected_id?: string;
  deleted?: number;
  ids?: string[];
  id?: string;
}

async function 调配件函数(函数名: string, 参数: Record<string, unknown>): Promise<RPC返回> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(函数名, 参数);
  if (error) {
    return { success: false, error: error.message };
  }
  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "操作失败" };
  }
  return 结果;
}

/* ─── 删除配件分支（同目录至少保留一个；已采购/已到货拒删；删选中自动递补） ─── */
export async function 删除配件分支(分支id: string): Promise<RPC返回> {
  const 结果 = await 调配件函数("delete_part_branch", { p_part_id: 分支id });
  if (结果.success) revalidatePath("/work-orders");
  return 结果;
}

/* ─── 删除整个配件目录（组内有已采购/已到货分支则整组拒删） ─── */
export async function 删除配件目录(组内任一分支id: string): Promise<RPC返回> {
  const 结果 = await 调配件函数("delete_part_group", { p_part_id: 组内任一分支id });
  if (结果.success) revalidatePath("/work-orders");
  return 结果;
}

/* ─── 工单项目批量添加配件行 ─── */
export async function 添加工单配件(
  项目id: string,
  配件列表: Record<string, unknown>[]
): Promise<RPC返回> {
  const 结果 = await 调配件函数("add_work_order_item_parts", { p_item_id: 项目id, p_parts: 配件列表 });
  if (结果.success) revalidatePath("/work-orders");
  return 结果;
}

/* ─── 给已有目录加分支（沿用源行 branch_group_id；新分支固定不选中） ─── */
export async function 添加配件分支(源分支id: string): Promise<RPC返回> {
  const 结果 = await 调配件函数("add_part_branch", { p_source_part_id: 源分支id });
  if (结果.success) revalidatePath("/work-orders");
  return 结果;
}

/* ─── 组内原子切换选中分支（替代前端两步写，防 0 选中中间态） ─── */
export async function 选中配件分支(分支id: string): Promise<RPC返回> {
  const 结果 = await 调配件函数("select_part_branch", { p_part_id: 分支id });
  if (结果.success) revalidatePath("/work-orders");
  return 结果;
}

/* ─── 手动标记已采购/已到货（兜底；守卫内置在函数里） ─── */
export async function 标记采购到货(
  分支id: string,
  标记: "is_purchased" | "is_arrived",
  值: boolean
): Promise<RPC返回> {
  const 结果 = await 调配件函数("set_part_purchase_flag", {
    p_part_id: 分支id,
    p_flag: 标记,
    p_value: 值,
  });
  if (结果.success) revalidatePath("/work-orders");
  return 结果;
}

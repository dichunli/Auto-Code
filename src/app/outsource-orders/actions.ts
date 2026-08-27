"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 外包单 Server Action ═══ */

interface 操作结果 {
  success: boolean;
  error?: string;
}

/* ─── 重置外包财务记录(2026-08-16 批次3 破口修复) ───
 * supplier_transactions/accounts_payable 写已角色化,客户端直写会被 RLS 拦,
 * 改由 RPC reset_outsource_finance 一个事务完成"清旧+建新"。
 * 调用方：外包弹窗(改供应商/付款状态)、手机端移除外包项目。 */
export async function 重置外包财务记录(参数: {
  单号: string;
  供应商id: string | null;
  金额: number;
  已付: boolean;
}): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reset_outsource_finance", {
    p_order_no: 参数.单号,
    p_supplier_id: 参数.供应商id,
    p_amount: 参数.金额 || 0,
    p_paid: 参数.已付,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as 操作结果;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "财务记录更新失败" };
  }

  revalidatePath("/supplier-transactions");
  revalidatePath("/finance/payable");
  return { success: true };
}

/* ─── 保存外包单(创建/更新,涉钱,走原子事务 RPC) ───
 * 原来是 OutsourceModal 客户端 6 步连写,中途失败财务和单据会对不上。
 * 收编为 save_outsource_order RPC 一个事务;单号在服务端生成。 */
export async function 保存外包单(参数: {
  workOrderId: string;
  workOrderItemId: string;
  serviceItemId: string;
  serviceName: string;
  amount: number;
  supplierId: string;
  isPaid: boolean;
  paymentMethod: string;
  notes: string;
  existingOrderId?: string | null;
  existingItemId?: string | null;
}): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_outsource_order", {
    p_work_order_id: 参数.workOrderId,
    p_work_order_item_id: 参数.workOrderItemId,
    p_service_item_id: 参数.serviceItemId,
    p_service_name: 参数.serviceName,
    p_amount: 参数.amount,
    p_supplier_id: 参数.supplierId,
    p_is_paid: 参数.isPaid,
    p_payment_method: 参数.paymentMethod || null,
    p_notes: 参数.notes || null,
    p_existing_order_id: 参数.existingOrderId || null,
    p_existing_item_id: 参数.existingItemId || null,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as 操作结果;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "保存失败" };
  }

  revalidatePath("/outsource-orders");
  revalidatePath(`/work-orders/${参数.workOrderId}`);
  return { success: true };
}

/* ─── 移除外包明细(末项时整单删除,涉钱,走原子事务 RPC) ─── */
export async function 移除外包明细(参数: {
  workOrderId: string;
  orderId: string;
  itemId: string;
  workOrderItemId: string;
}): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("remove_outsource_order_item", {
    p_order_id: 参数.orderId,
    p_item_id: 参数.itemId,
    p_work_order_item_id: 参数.workOrderItemId,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as 操作结果;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "操作失败" };
  }

  revalidatePath("/outsource-orders");
  revalidatePath(`/work-orders/${参数.workOrderId}`);
  return { success: true };
}

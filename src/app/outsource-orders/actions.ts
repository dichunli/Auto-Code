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

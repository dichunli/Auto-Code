"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 财务「记一笔」Server Action ═══
 * 原来是客户端直插 finance_transactions，session 异常时会 401/被 RLS 拦截。
 * 收编到服务端；记录人 created_by 取服务端验证的 user.id，不接受客户端传入。
 * 角色门禁（admin/boss/accountant）由表 RLS 兜底。 */
export async function 记一笔(参数: {
  accountId: string;
  categoryId: string;
  type: string;
  amount: number;
  description: string;
  transactionDate: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  /* 服务端兜底校验（前端已校验） */
  if (!参数.accountId) {
    return { success: false, error: "请选择账户" };
  }
  if (!参数.amount || 参数.amount <= 0) {
    return { success: false, error: "请输入有效金额" };
  }
  if (参数.type !== "income" && 参数.type !== "expense") {
    return { success: false, error: "类型无效" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("finance_transactions").insert({
    account_id: 参数.accountId,
    category_id: 参数.categoryId || null,
    type: 参数.type,
    amount: 参数.amount,
    description: 参数.description.trim() || null,
    transaction_date: 参数.transactionDate,
    created_by: user.id,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/finance/transactions");
  return { success: true };
}

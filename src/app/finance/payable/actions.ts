"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 外包应付付款 Server Action（2026-09-16 往来账销账闭环 第二部分） ═══
 * 写操作全部落到 RPC 事务（create_ap_payment / void_ap_payment），
 * 角色门禁（admin/boss/accountant）在 RPC 内校验，这里只做登录验证和参数清洗。 */

interface RPC结果 {
  success: boolean;
  error?: string;
  record_id?: string;
}

/* ─── 登记外包付款 ─── */
export async function 登记外包付款(参数: {
  payable_id: string;
  amount: number;
  account_id: string;
  payment_method?: string;
  paid_at?: string;
  note?: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  if (!参数.payable_id) {
    return { success: false, error: "缺少应付记录" };
  }
  if (!Number.isFinite(参数.amount) || 参数.amount <= 0) {
    return { success: false, error: "付款金额必须大于 0" };
  }
  if (!参数.account_id) {
    return { success: false, error: "请选择付款账户" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_ap_payment", {
    p_payable_id: 参数.payable_id,
    p_amount: Math.round(参数.amount * 100) / 100,
    p_account_id: 参数.account_id,
    p_payment_method: 参数.payment_method?.trim() || null,
    p_paid_at: 参数.paid_at || null,
    p_note: 参数.note?.trim() || null,
  });

  if (error) {
    return { success: false, error: error.message };
  }
  const 结果 = data as RPC结果 | null;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "付款登记失败" };
  }

  revalidatePath("/finance/payable");
  revalidatePath("/finance/transactions");
  return { success: true };
}

/* ─── 作废外包付款记录 ─── */
export async function 作废外包付款(
  recordId: string
): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!recordId) {
    return { success: false, error: "缺少付款记录 id" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("void_ap_payment", {
    p_record_id: recordId,
  });

  if (error) {
    return { success: false, error: error.message };
  }
  const 结果 = data as RPC结果 | null;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "作废失败" };
  }

  revalidatePath("/finance/payable");
  revalidatePath("/finance/transactions");
  return { success: true };
}

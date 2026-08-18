"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 供应商往来账 Server Action ═══ */

const 合法类型 = ["payment", "refund", "credit", "debit"] as const;
type 账目类型 = (typeof 合法类型)[number];

/* ─── 手工记一笔（2026-08-19 收编：原为客户端直插） ───
 * supplier_transactions 写已收紧到 admin/boss/warehouse（RLS），
 * 此 action 服务端验证登录后写入，操作人取服务端 user.id。 */
export async function 记供应商往来账(参数: {
  supplier_id: string;
  transaction_type: 账目类型;
  amount: number;
  description: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  if (!参数.supplier_id) {
    return { success: false, error: "请选择供应商" };
  }
  if (!合法类型.includes(参数.transaction_type)) {
    return { success: false, error: "账目类型无效" };
  }
  if (!Number.isFinite(参数.amount) || 参数.amount <= 0) {
    return { success: false, error: "金额必须大于 0" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("supplier_transactions").insert({
    supplier_id: 参数.supplier_id,
    transaction_type: 参数.transaction_type,
    amount: 参数.amount,
    description: 参数.description.trim() || null,
    created_by: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/supplier-transactions");
  return { success: true };
}

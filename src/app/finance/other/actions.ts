"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 其它收支删除 Server Action ═══
 * 删除操作从客户端直写收口到服务端，避免客户端 session 异常导致 401 / 被 RLS 拦截。
 * 数据库层已有角色门禁（仅 管理员/老板/会计 可删），此处由 RLS 兜底。 */
export async function 删除其它收支(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("other_transactions").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/finance/other");
  return { success: true };
}

/* ═══ 其它收支 新建/编辑 Server Action ═══
 * 涉钱写操作收口到服务端；经办人 operator_id 取服务端验证的 user.id。
 * 角色门禁（admin/boss/accountant）由表 RLS 兜底。 */
export interface 其它收支表单 {
  type: string;
  amount: number;
  counterparty: string;
  accountId: string;
  categoryId: string;
  transactionDate: string;
  notes: string;
  images: string[];
}

function 校验其它收支表单(表单: 其它收支表单): string | null {
  if (表单.type !== "income" && 表单.type !== "expense") return "类型无效";
  if (!表单.amount || 表单.amount <= 0) return "请填写金额";
  if (!表单.accountId) return "请选择账户";
  if (!表单.categoryId) return "请选择分类";
  return null;
}

export async function 新增其它收支(表单: 其它收支表单): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const 校验错误 = 校验其它收支表单(表单);
  if (校验错误) return { success: false, error: 校验错误 };

  const supabase = await createClient();
  const { error } = await supabase.from("other_transactions").insert({
    type: 表单.type,
    amount: 表单.amount,
    name: null,
    counterparty: 表单.counterparty.trim() || null,
    operator_id: user.id,
    account_id: 表单.accountId,
    category_id: 表单.categoryId,
    transaction_date: 表单.transactionDate,
    notes: 表单.notes.trim() || null,
    images: 表单.images.length > 0 ? 表单.images : null,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/finance/other");
  return { success: true };
}

export async function 更新其它收支(id: string, 表单: 其它收支表单): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const 校验错误 = 校验其它收支表单(表单);
  if (校验错误) return { success: false, error: 校验错误 };

  const supabase = await createClient();
  const { error } = await supabase
    .from("other_transactions")
    .update({
      type: 表单.type,
      amount: 表单.amount,
      counterparty: 表单.counterparty.trim() || null,
      account_id: 表单.accountId,
      category_id: 表单.categoryId,
      transaction_date: 表单.transactionDate,
      notes: 表单.notes.trim() || null,
      images: 表单.images.length > 0 ? 表单.images : null,
    })
    .eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/finance/other");
  return { success: true };
}

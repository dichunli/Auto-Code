"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 其它收支收款方式 Server Action ═══
 * 新建/编辑/删除/拖拽排序从客户端直写收口到服务端，
 * 避免客户端 session 异常导致 401 / 被 RLS 拦截。
 * 角色门禁由表 RLS 兜底。 */

export async function 新建收款方式(参数: {
  name: string;
  operatorId: string;
  sortOrder: number;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const name = 参数.name.trim();
  if (!name) {
    return { success: false, error: "请输入收款方式名称" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("other_payment_methods").insert({
    name,
    operator_id: 参数.operatorId || null,
    sort_order: 参数.sortOrder,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/finance/other/payment-methods");
  return { success: true };
}

export async function 更新收款方式(参数: {
  id: string;
  name: string;
  operatorId: string;
  isActive: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const name = 参数.name.trim();
  if (!name) {
    return { success: false, error: "请输入名称" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("other_payment_methods")
    .update({
      name,
      operator_id: 参数.operatorId || null,
      is_active: 参数.isActive,
    })
    .eq("id", 参数.id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/finance/other/payment-methods");
  return { success: true };
}

/* 删除前检查是否被其它收支记录引用（检查也在服务端做，防并发误删） */
export async function 删除收款方式(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { count } = await supabase
    .from("other_transactions")
    .select("id", { count: "exact", head: true })
    .eq("account_id", id);

  if ((count || 0) > 0) {
    return { success: false, error: "该收款方式已被使用，不能删除" };
  }

  const { error } = await supabase.from("other_payment_methods").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/finance/other/payment-methods");
  return { success: true };
}

/* 拖拽排序批量保存 */
export async function 保存收款方式排序(参数: {
  items: { id: string; sort_order: number }[];
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  for (const item of 参数.items) {
    const { error } = await supabase
      .from("other_payment_methods")
      .update({ sort_order: item.sort_order })
      .eq("id", item.id);
    if (error) {
      return { success: false, error: "排序保存失败：" + error.message };
    }
  }

  revalidatePath("/finance/other/payment-methods");
  return { success: true };
}

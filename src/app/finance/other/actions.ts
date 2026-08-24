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

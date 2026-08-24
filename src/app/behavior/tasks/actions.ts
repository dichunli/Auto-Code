"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 行为考核任务删除 Server Action ═══
 * 删除操作从客户端直写收口到服务端，避免客户端 session 异常导致 401 / 被 RLS 拦截。 */
export async function 删除考核任务(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("behavior_check_tasks").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/behavior/tasks");
  return { success: true };
}

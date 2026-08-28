"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 售后回访 Server Action ═══
 * 回访完成写库从客户端直写收口到服务端，
 * 避免客户端 session 异常导致 401 / 被 RLS 拦截。 */
export async function 完成回访(参数: {
  followUpId: string;
  method: string;
  result: string;
  notes: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  if (!参数.result.trim()) {
    return { success: false, error: "请填写回访结果" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("follow_ups")
    .update({
      completed_at: new Date().toISOString(),
      method: 参数.method,
      result: 参数.result.trim(),
      notes: 参数.notes.trim() || null,
    })
    .eq("id", 参数.followUpId);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/follow-ups");
  return { success: true };
}

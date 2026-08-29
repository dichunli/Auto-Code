"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 主管授权码保存 Server Action ═══
 * 写操作从客户端直写收口到服务端，避免客户端 session 异常导致 401 / 被 RLS 拦截。 */
export async function 保存主管授权码(授权码: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const 码 = 授权码.trim();
  if (!码) {
    return { success: false, error: "授权码不能为空" };
  }
  if (!/^\d{4,8}$/.test(码)) {
    return { success: false, error: "授权码必须是 4~8 位数字" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("system_settings")
    .update({ value: 码, updated_at: new Date().toISOString() })
    .eq("key", "supervisor_code");
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/settings");
  return { success: true };
}

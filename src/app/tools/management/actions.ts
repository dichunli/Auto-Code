"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 工具删除 Server Action ═══
 * 删除操作从客户端直写收口到服务端。
 * 数据库层已有删除权限门禁（仅管理员可删工具），此处由 RLS 兜底。 */
export async function 删除工具(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("tools").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/tools/management");
  return { success: true };
}

"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 标签删除 Server Action ═══
 * 删除操作从客户端直写收口到服务端，避免客户端 session 异常导致 401 / 被 RLS 拦截。 */
export async function 删除标签(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("tags").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/tags");
  return { success: true };
}

/* ═══ 新建标签 Server Action ═══
 * 插入从客户端直写收口到服务端，避免客户端 session 异常导致 401 / 被 RLS 拦截。 */
export async function 新建标签(参数: {
  name: string;
  color: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  if (!参数.name.trim()) {
    return { success: false, error: "请输入标签名称" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("tags").insert({
    name: 参数.name.trim(),
    color: 参数.color,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/tags");
  return { success: true };
}

/* ═══ 更新标签 Server Action（列表行内编辑） ═══ */
export async function 更新标签(参数: {
  id: string;
  name: string;
  color: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  if (!参数.name.trim()) {
    return { success: false, error: "请输入标签名称" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("tags")
    .update({ name: 参数.name.trim(), color: 参数.color })
    .eq("id", 参数.id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/tags");
  return { success: true };
}

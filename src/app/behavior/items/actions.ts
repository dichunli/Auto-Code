"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 行为考核配置 Server Action ═══
 * 项目/分类/明细的删除操作从客户端直写收口到服务端，
 * 避免客户端 session 异常导致 401 / 被 RLS 拦截。 */

/* ─── 删除行为项目（数据库级联清理关联任务/记录/评论） ─── */
export async function 删除行为项目(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("behavior_score_items").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/behavior/items");
  return { success: true };
}

/* ─── 删除行为分类（删除前检查分类下是否有项目） ─── */
export async function 删除行为分类(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();

  /* 服务端重新检查：分类下是否还有行为项目 */
  const { count } = await supabase
    .from("behavior_score_items")
    .select("id", { count: "exact", head: true })
    .eq("category_id", id);
  if (count && count > 0) {
    return { success: false, error: `该分类下还有 ${count} 个行为项目，删除后这些项目会变成"未分类"。` };
  }

  const { error } = await supabase.from("behavior_categories").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/behavior/items");
  return { success: true };
}

/* ─── 批量删除行为明细（保存弹窗内删除已移除的明细行） ─── */
export async function 批量删除行为明细(deletedIds: string[]): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("behavior_item_details").delete().in("id", deletedIds);
  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

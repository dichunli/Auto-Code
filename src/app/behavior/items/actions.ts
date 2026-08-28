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

/* ─── 保存行为项目（新建/编辑） ─── */
export async function 保存行为项目(参数: {
  id: string | null;
  payload: {
    name: string;
    score_type: string;
    score_value: number;
    description: string | null;
    category_id: string | null;
    responsible_ids: string[];
    checker_ids: string[];
    guide_images: string[];
    is_active: boolean;
  };
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!参数.payload.name.trim()) {
    return { success: false, error: "请输入项目名称" };
  }
  if (!参数.payload.score_value || 参数.payload.score_value <= 0) {
    return { success: false, error: "请输入有效分值" };
  }

  const supabase = await createClient();
  const { error } = 参数.id
    ? await supabase.from("behavior_score_items").update(参数.payload).eq("id", 参数.id)
    : await supabase.from("behavior_score_items").insert(参数.payload);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/behavior/items");
  return { success: true };
}

/* ─── 新建行为分类（重名由数据库唯一约束兜底，23505 转友好提示） ─── */
export async function 新建行为分类(name: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!name.trim()) {
    return { success: false, error: "请输入分类名称" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("behavior_categories").insert({ name: name.trim() });
  if (error) {
    return { success: false, error: error.code === "23505" ? "分类名称已存在" : error.message };
  }

  revalidatePath("/behavior/items");
  return { success: true };
}

/* ─── 更新行为分类（行内编辑名称/排序） ─── */
export async function 更新行为分类(参数: {
  id: string;
  name: string;
  sortOrder: number;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!参数.name.trim()) {
    return { success: false, error: "分类名称不能为空" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("behavior_categories")
    .update({ name: 参数.name.trim(), sort_order: 参数.sortOrder })
    .eq("id", 参数.id);
  if (error) {
    return { success: false, error: error.code === "23505" ? "分类名称已存在" : error.message };
  }

  revalidatePath("/behavior/items");
  return { success: true };
}

/* ─── 切换行为分类启用状态 ─── */
export async function 切换行为分类启用(参数: {
  id: string;
  isActive: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("behavior_categories")
    .update({ is_active: 参数.isActive })
    .eq("id", 参数.id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/behavior/items");
  return { success: true };
}

/* ─── 保存行为明细（删旧 + 逐条新增/修改，服务端一次完成） ─── */
export async function 保存行为明细(参数: {
  itemId: string;
  deletedIds: string[];
  details: {
    id: string | null;
    name: string;
    description: string | null;
    score_value: number;
    guide_images: string[];
    sort_order: number;
  }[];
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();

  if (参数.deletedIds.length > 0) {
    const { error } = await supabase.from("behavior_item_details").delete().in("id", 参数.deletedIds);
    if (error) {
      return { success: false, error: error.message };
    }
  }

  for (const d of 参数.details) {
    const payload = {
      item_id: 参数.itemId,
      name: d.name.trim(),
      description: d.description?.trim() || null,
      score_value: d.score_value,
      guide_images: d.guide_images,
      sort_order: d.sort_order,
    };
    const { error } = d.id
      ? await supabase.from("behavior_item_details").update(payload).eq("id", d.id)
      : await supabase.from("behavior_item_details").insert(payload);
    if (error) {
      return { success: false, error: error.message };
    }
  }

  revalidatePath("/behavior/items");
  return { success: true };
}

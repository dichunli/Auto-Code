"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 配件品牌删除 Server Action ═══
 * 删除操作从客户端直写收口到服务端，删除前检查关联数据防止误删。 */
export async function 删除配件品牌(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();

  /* 删除前检查：是否被配件名称或库存配件引用 */
  const [{ count: linkCount }, { count: partCount }] = await Promise.all([
    supabase.from("part_name_brands").select("id", { count: "exact", head: true }).eq("brand_id", id),
    supabase.from("parts").select("id", { count: "exact", head: true }).eq("brand_id", id),
  ]);

  if ((linkCount ?? 0) > 0 || (partCount ?? 0) > 0) {
    return { success: false, error: "该品牌已被使用（存在关联配件名称或库存配件），不允许删除" };
  }

  const { error } = await supabase.from("part_brands").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/part-brands");
  return { success: true };
}

/* ─── 新建品牌并关联配件名称（列表页/新建页共用） ─── */
export async function 新建品牌并关联(参数: {
  name: string;
  partNameIds: string[];
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!参数.name.trim()) {
    return { success: false, error: "请输入品牌名称" };
  }

  const supabase = await createClient();
  const { data: brandData, error: brandError } = await supabase
    .from("part_brands")
    .insert({ name: 参数.name.trim() })
    .select("id")
    .single();
  if (brandError || !brandData) {
    return { success: false, error: brandError?.message || "保存失败" };
  }

  if (参数.partNameIds.length > 0) {
    const { error: linkError } = await supabase.from("part_name_brands").insert(
      参数.partNameIds.map((pid) => ({ brand_id: brandData.id, part_name_id: pid }))
    );
    if (linkError) {
      return { success: false, error: "品牌创建成功，但关联配件名称失败: " + linkError.message };
    }
  }

  revalidatePath("/part-brands");
  return { success: true, id: brandData.id };
}

/* ─── 更新配件品牌（改名 + 配件名称关联差量同步，服务端一次完成） ─── */
export async function 更新配件品牌(参数: {
  id: string;
  name: string;
  linkedPartNameIds: string[];
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!参数.name.trim()) {
    return { success: false, error: "请输入品牌名称" };
  }

  const supabase = await createClient();
  const { error: updateError } = await supabase
    .from("part_brands")
    .update({ name: 参数.name.trim() })
    .eq("id", 参数.id);
  if (updateError) {
    return { success: false, error: updateError.message };
  }

  /* 关联差量同步（服务端读最新再 diff） */
  const { data: existing } = await supabase
    .from("part_name_brands")
    .select("part_name_id")
    .eq("brand_id", 参数.id);
  const existingIds = new Set(((existing || []) as { part_name_id: string }[]).map((r) => r.part_name_id));
  const newIds = new Set(参数.linkedPartNameIds);
  const toDelete = [...existingIds].filter((pid) => !newIds.has(pid));
  const toInsert = [...newIds].filter((pid) => !existingIds.has(pid));
  if (toDelete.length > 0) {
    const { error } = await supabase.from("part_name_brands").delete().eq("brand_id", 参数.id).in("part_name_id", toDelete);
    if (error) return { success: false, error: error.message };
  }
  if (toInsert.length > 0) {
    const { error } = await supabase.from("part_name_brands").insert(
      toInsert.map((pid) => ({ brand_id: 参数.id, part_name_id: pid }))
    );
    if (error) return { success: false, error: error.message };
  }

  revalidatePath("/part-brands");
  return { success: true };
}

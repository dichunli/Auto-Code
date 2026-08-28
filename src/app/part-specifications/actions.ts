"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 配件规格删除 Server Action ═══
 * 删除操作从客户端直写收口到服务端，删除前检查关联数据防止误删。 */
export async function 删除配件规格(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();

  /* 删除前检查：是否被配件名称或库存配件引用 */
  const [{ count: linkCount }, { count: partCount }] = await Promise.all([
    supabase.from("part_name_specifications").select("id", { count: "exact", head: true }).eq("specification_id", id),
    supabase.from("parts").select("id", { count: "exact", head: true }).eq("specification_id", id),
  ]);

  if ((linkCount ?? 0) > 0 || (partCount ?? 0) > 0) {
    return { success: false, error: "该规格已被使用（存在关联配件名称或库存配件），不允许删除" };
  }

  const { error } = await supabase.from("part_specifications").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/part-specifications");
  return { success: true };
}

/* ─── 新建规格并关联配件名称（列表页新建弹窗） ─── */
export async function 新建规格并关联(参数: {
  name: string;
  partNameIds: string[];
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!参数.name.trim()) {
    return { success: false, error: "请输入规格名称" };
  }

  const supabase = await createClient();
  const { data: specData, error: specError } = await supabase
    .from("part_specifications")
    .insert({ name: 参数.name.trim() })
    .select("id")
    .single();
  if (specError || !specData) {
    return { success: false, error: specError?.message || "保存失败" };
  }

  if (参数.partNameIds.length > 0) {
    const { error: linkError } = await supabase.from("part_name_specifications").insert(
      参数.partNameIds.map((pid) => ({ specification_id: specData.id, part_name_id: pid }))
    );
    if (linkError) {
      return { success: false, error: "规格创建成功，但关联配件名称失败: " + linkError.message };
    }
  }

  revalidatePath("/part-specifications");
  return { success: true, id: specData.id };
}

/* ─── 更新配件规格（改名 + 配件名称关联差量同步，服务端一次完成） ─── */
export async function 更新配件规格(参数: {
  id: string;
  name: string;
  linkedPartNameIds: string[];
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!参数.name.trim()) {
    return { success: false, error: "请输入规格名称" };
  }

  const supabase = await createClient();
  const { error: updateError } = await supabase
    .from("part_specifications")
    .update({ name: 参数.name.trim() })
    .eq("id", 参数.id);
  if (updateError) {
    return { success: false, error: updateError.message };
  }

  /* 关联差量同步（服务端读最新再 diff） */
  const { data: existing } = await supabase
    .from("part_name_specifications")
    .select("part_name_id")
    .eq("specification_id", 参数.id);
  const existingIds = new Set(((existing || []) as { part_name_id: string }[]).map((r) => r.part_name_id));
  const newIds = new Set(参数.linkedPartNameIds);
  const toDelete = [...existingIds].filter((pid) => !newIds.has(pid));
  const toInsert = [...newIds].filter((pid) => !existingIds.has(pid));
  if (toDelete.length > 0) {
    const { error } = await supabase.from("part_name_specifications").delete().eq("specification_id", 参数.id).in("part_name_id", toDelete);
    if (error) return { success: false, error: error.message };
  }
  if (toInsert.length > 0) {
    const { error } = await supabase.from("part_name_specifications").insert(
      toInsert.map((pid) => ({ specification_id: 参数.id, part_name_id: pid }))
    );
    if (error) return { success: false, error: error.message };
  }

  revalidatePath("/part-specifications");
  return { success: true };
}

/* ─── CSV 批量导入规格（逐条插入，允许部分失败，与原逻辑一致） ─── */
export async function 批量导入配件规格(参数: {
  names: string[];
}): Promise<{ success: boolean; 成功?: number; 失败?: number; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!参数.names || 参数.names.length === 0) {
    return { success: false, error: "没有可导入的数据" };
  }

  const supabase = await createClient();
  let 成功 = 0;
  let 失败 = 0;
  for (const n of 参数.names) {
    const { error } = await supabase.from("part_specifications").insert({ name: n });
    if (error) 失败++;
    else 成功++;
  }

  revalidatePath("/part-specifications");
  return { success: true, 成功, 失败 };
}

/* ─── 批量关联配件名称到多个规格（规格域 BatchLinkDialog） ───
 * 逐条 upsert，允许重复跳过/部分失败，与原逻辑一致。 */
export async function 批量关联规格到名称(参数: {
  specIds: string[];
  partNameIds: string[];
}): Promise<{ success: boolean; 成功?: number; 跳过?: number; 失败?: number; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  let 成功 = 0;
  let 跳过 = 0;
  let 失败 = 0;
  for (const specId of 参数.specIds) {
    for (const partNameId of 参数.partNameIds) {
      const { error } = await supabase
        .from("part_name_specifications")
        .upsert({ part_name_id: partNameId, specification_id: specId }, { onConflict: "part_name_id,specification_id" });
      if (error) {
        if (error.message.includes("duplicate")) 跳过++;
        else 失败++;
      } else {
        成功++;
      }
    }
  }

  revalidatePath("/part-specifications");
  return { success: true, 成功, 跳过, 失败 };
}

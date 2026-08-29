"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* 同义词记录形状（新增成功后返回给客户端就地更新列表） */
export interface 同义词记录 {
  id: string;
  term: string;
  synonyms: string[];
}

/* ═══ 同义词删除 Server Action ═══
 * 删除操作从客户端直写收口到服务端，避免客户端 session 异常导致 401 / 被 RLS 拦截。 */
export async function 删除同义词(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("synonym_mapping").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/settings/synonyms");
  return { success: true };
}

/* ═══ 同义词新增 Server Action ═══
 * 新增操作从客户端直写收口到服务端；返回新行供客户端就地更新列表。 */
export async function 新增同义词(
  原词: string,
  同义词组: string[]
): Promise<{ success: boolean; data?: 同义词记录; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("synonym_mapping")
    .insert({ term: 原词, synonyms: 同义词组 })
    .select("id, term, synonyms")
    .single();
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/settings/synonyms");
  return {
    success: true,
    data: data
      ? {
          id: String(data.id),
          term: String(data.term),
          synonyms: Array.isArray(data.synonyms) ? (data.synonyms as string[]) : [],
        }
      : undefined,
  };
}

/* ═══ 同义词更新 Server Action ═══
 * 更新操作从客户端直写收口到服务端。 */
export async function 更新同义词(
  id: string,
  原词: string,
  同义词组: string[]
): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("synonym_mapping")
    .update({ term: 原词, synonyms: 同义词组, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/settings/synonyms");
  return { success: true };
}

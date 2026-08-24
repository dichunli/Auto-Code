"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 配件分类删除 Server Action ═══
 * 删除操作从客户端直写收口到服务端，删除前检查关联数据防止误删。 */
export async function 删除配件分类(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();

  /* 删除前检查：分类下是否还有配件名称、库存配件，或已被供应商引用 */
  const checks = await Promise.all([
    supabase.from("part_names").select("id", { count: "exact", head: true }).eq("category_id", id),
    supabase.from("parts").select("id", { count: "exact", head: true }).eq("category_id", id),
    supabase.from("supplier_part_categories").select("id", { count: "exact", head: true }).eq("part_category_id", id),
  ]);

  const used = checks.some((c) => (c.count ?? 0) > 0);
  if (used) {
    return { success: false, error: "该分类下已有配件名称、库存配件或已被供应商引用，不允许删除" };
  }

  const { error } = await supabase.from("part_categories").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/part-categories");
  return { success: true };
}

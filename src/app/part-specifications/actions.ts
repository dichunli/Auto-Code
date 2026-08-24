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

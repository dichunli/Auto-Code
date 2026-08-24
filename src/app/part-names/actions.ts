"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 配件名称删除 Server Action ═══
 * 删除操作从客户端直写收口到服务端，删除前检查关联数据防止误删。 */
export async function 删除配件名称(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();

  /* 删除前检查：是否被库存、工单、采购、单位定价等引用 */
  const checks = await Promise.all([
    supabase.from("parts").select("id", { count: "exact", head: true }).eq("part_name_id", id),
    supabase.from("part_name_brands").select("id", { count: "exact", head: true }).eq("part_name_id", id),
    supabase.from("work_order_parts").select("id", { count: "exact", head: true }).eq("part_name_id", id),
    supabase.from("company_part_prices").select("id", { count: "exact", head: true }).eq("part_name_id", id),
    supabase.from("purchase_order_items").select("id", { count: "exact", head: true }).eq("part_name_id", id),
  ]);

  const used = checks.some((c) => (c.count ?? 0) > 0);
  if (used) {
    return { success: false, error: "该配件名称已被使用（存在库存、工单、采购等关联），不允许删除，但可以进行合并" };
  }

  const { error } = await supabase.from("part_names").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/part-names");
  return { success: true };
}

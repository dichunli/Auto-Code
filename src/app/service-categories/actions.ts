"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 服务分类删除 Server Action ═══
 * 删除操作从客户端直写收口到服务端，删除前检查关联数据防止误删。 */
export async function 删除服务分类(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();

  /* 删除前检查：分类下是否还有维修项目 */
  const { count: itemCount } = await supabase
    .from("service_items")
    .select("id", { count: "exact", head: true })
    .eq("category_id", id);
  if (itemCount && itemCount > 0) {
    return { success: false, error: "该分类下还有维修项目，不允许删除" };
  }

  const { error } = await supabase.from("service_categories").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/service-categories");
  return { success: true };
}

"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 单位删除 Server Action ═══
 * 删除操作从客户端直写收口到服务端，删除前检查关联客户防止误删。 */
export async function 删除单位(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();

  /* 删除前检查：该单位下是否还有客户 */
  const { count: customerCount } = await supabase
    .from("customers")
    .select("*", { count: "exact", head: true })
    .eq("company_id", id);
  if (customerCount && customerCount > 0) {
    return { success: false, error: `无法删除：该单位下还有 ${customerCount} 个客户，请先处理。` };
  }

  const { error } = await supabase.from("companies").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/companies");
  return { success: true };
}

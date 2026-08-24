"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 员工分组删除 Server Action ═══
 * 删除操作从客户端直写收口到服务端，删除前服务端重新检查成员数防止误删。 */
export async function 删除员工分组(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();

  /* 服务端重新检查：该分组下是否还有员工 */
  const { count: memberCount } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("group_id", id);
  if (memberCount && memberCount > 0) {
    return { success: false, error: `该分组下还有 ${memberCount} 名员工，请先移走员工再删除分组。` };
  }

  const { error } = await supabase.from("employee_groups").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/employee-groups");
  return { success: true };
}

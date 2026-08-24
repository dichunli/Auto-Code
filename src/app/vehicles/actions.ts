"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 车辆删除 Server Action ═══
 * 删除操作从客户端直写收口到服务端，删除前检查关联工单防止误删。 */
export async function 删除车辆(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();

  /* 删除前检查：该车辆是否还有工单记录 */
  const { count: orderCount } = await supabase
    .from("work_orders")
    .select("*", { count: "exact", head: true })
    .eq("vehicle_id", id);
  if (orderCount && orderCount > 0) {
    return { success: false, error: `无法删除：该车辆还有 ${orderCount} 条工单记录。` };
  }

  const { error } = await supabase.from("vehicles").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/vehicles");
  return { success: true };
}

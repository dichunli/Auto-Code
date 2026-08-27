"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 合并维修项目（多表迁移，走原子事务 RPC merge_service_items） ═══
 * 原来是客户端逐表循环写（4 张价格表 + 4 张引用表 + 主表），
 * 中途失败留半成品；收编后一个事务要么全成要么全败。 */
export async function 合并维修项目(参数: {
  targetId: string;
  sourceIds: string[];
  name: string;
  strategy: "keep_target" | "override";
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("merge_service_items", {
    p_target_id: 参数.targetId,
    p_source_ids: 参数.sourceIds,
    p_name: 参数.name,
    p_strategy: 参数.strategy,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as { success: boolean; error?: string };
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "合并失败" };
  }

  revalidatePath("/service-items");
  return { success: true };
}

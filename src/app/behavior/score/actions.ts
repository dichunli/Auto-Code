"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 行为记分 Server Action ═══
 * 手动打分从客户端直写收口到服务端，避免客户端 session 异常导致记分失败。 */
export async function 提交行为记分(参数: {
  employeeId: string;
  itemId: string;
  score: number;
  notes: string;
  eventTime: string;
  mediaUrls: string[];
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!参数.employeeId) {
    return { success: false, error: "请选择员工" };
  }
  if (!参数.itemId) {
    return { success: false, error: "请选择评分项目" };
  }
  if (!参数.score) {
    return { success: false, error: "请输入有效分数" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("behavior_score_records").insert({
    employee_id: 参数.employeeId,
    item_id: 参数.itemId,
    score: 参数.score,
    notes: 参数.notes.trim() || null,
    event_time: 参数.eventTime,
    media_urls: 参数.mediaUrls.length > 0 ? 参数.mediaUrls : null,
    scored_by: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/behavior/score");
  return { success: true };
}

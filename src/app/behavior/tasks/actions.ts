"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 行为考核任务删除 Server Action ═══
 * 删除操作从客户端直写收口到服务端，避免客户端 session 异常导致 401 / 被 RLS 拦截。 */
export async function 删除考核任务(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("behavior_check_tasks").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/behavior/tasks");
  return { success: true };
}

/* ═══ 保存考核任务（新建/编辑） ═══ */
export async function 保存考核任务(参数: {
  id: string | null;
  payload: {
    name: string;
    item_id: string;
    frequency: string;
    execute_time: string;
    end_time: string;
    execute_weekday: number | null;
    execute_day: number | null;
    employee_ids: string[] | null;
    is_active: boolean;
  };
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!参数.payload.name.trim()) {
    return { success: false, error: "请输入任务名称" };
  }
  if (!参数.payload.item_id) {
    return { success: false, error: "请选择关联的行为项目" };
  }

  const supabase = await createClient();
  const { error } = 参数.id
    ? await supabase.from("behavior_check_tasks").update(参数.payload).eq("id", 参数.id)
    : await supabase.from("behavior_check_tasks").insert(参数.payload);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/behavior/tasks");
  return { success: true };
}

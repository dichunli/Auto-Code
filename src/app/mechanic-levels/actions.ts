"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 技师等级删除 Server Action ═══
 * 删除操作从客户端直写收口到服务端，避免客户端 session 异常导致 401 / 被 RLS 拦截。 */
export async function 删除技师等级(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("mechanic_levels").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/mechanic-levels");
  return { success: true };
}

/* ─── 新建/更新技师等级 ─── */
export async function 保存技师等级(参数: {
  id: string | null;
  name: string;
  levelCode: string;
  shareCoefficient: number;
  commissionWeight: number;
  sortOrder?: number;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!参数.name.trim()) {
    return { success: false, error: "请填写等级名称" };
  }
  if (isNaN(参数.commissionWeight) || 参数.commissionWeight < 0) {
    return { success: false, error: "团队分配权重不能为负数" };
  }

  const supabase = await createClient();
  if (参数.id) {
    const { error } = await supabase
      .from("mechanic_levels")
      .update({
        name: 参数.name.trim(),
        level_code: 参数.levelCode || null,
        share_coefficient: 参数.shareCoefficient,
        commission_weight: 参数.commissionWeight,
        sort_order: 参数.sortOrder ?? 0,
      })
      .eq("id", 参数.id);
    if (error) return { success: false, error: error.message };
  } else {
    /* 新建不写 sort_order（用数据库默认值，与原客户端口径一致） */
    const { data, error } = await supabase
      .from("mechanic_levels")
      .insert({
        name: 参数.name.trim(),
        level_code: 参数.levelCode || null,
        share_coefficient: 参数.shareCoefficient,
        commission_weight: 参数.commissionWeight,
      })
      .select("id")
      .single();
    if (error || !data) return { success: false, error: error?.message || "保存失败" };
    revalidatePath("/mechanic-levels");
    return { success: true, id: data.id as string };
  }

  revalidatePath("/mechanic-levels");
  return { success: true };
}

/* ─── 技师等级排序交换（上移/下移，两条交换 sort_order） ─── */
export async function 交换等级排序(参数: {
  idA: string;
  sortA: number;
  idB: string;
  sortB: number;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error: e1 } = await supabase.from("mechanic_levels").update({ sort_order: 参数.sortB }).eq("id", 参数.idA);
  if (e1) return { success: false, error: e1.message };
  const { error: e2 } = await supabase.from("mechanic_levels").update({ sort_order: 参数.sortA }).eq("id", 参数.idB);
  if (e2) return { success: false, error: e2.message };

  revalidatePath("/mechanic-levels");
  return { success: true };
}

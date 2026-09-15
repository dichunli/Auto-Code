"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* 技师等级属组织架构管理：仅 admin / boss 可写，
 * 与数据库 RLS 策略 has_role('admin','boss') 口径一致（migrations_20260916_b） */
const 可管等级角色 = ["admin", "boss"];

/* 检查指定用户是否有等级管理角色 */
async function 是等级管理员(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profile_roles")
    .select("roles(name)")
    .eq("profile_id", userId);
  return ((data || []) as unknown as { roles?: { name?: string } | null }[]).some(
    (d) => d.roles?.name != null && 可管等级角色.includes(d.roles.name)
  );
}

/* 统一校验：返回 null 表示通过，否则返回错误响应 */
async function 校验等级管理权限(): Promise<{ success: false; error: string } | null> {
  const { user, error } = await 验证用户已登录();
  if (!user) return { success: false, error: error || "未登录或登录已过期，请重新登录" };
  if (!(await 是等级管理员(user.id))) {
    return { success: false, error: "只有管理员或老板能维护技师等级" };
  }
  return null;
}

/* ═══ 技师等级删除 Server Action ═══
 * 删除操作从客户端直写收口到服务端，避免客户端 session 异常导致 401 / 被 RLS 拦截。 */
export async function 删除技师等级(id: string): Promise<{ success: boolean; error?: string }> {
  const 拒绝 = await 校验等级管理权限();
  if (拒绝) return 拒绝;

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
  const 拒绝 = await 校验等级管理权限();
  if (拒绝) return 拒绝;
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
  const 拒绝 = await 校验等级管理权限();
  if (拒绝) return 拒绝;

  const supabase = await createClient();
  const { error: e1 } = await supabase.from("mechanic_levels").update({ sort_order: 参数.sortB }).eq("id", 参数.idA);
  if (e1) return { success: false, error: e1.message };
  const { error: e2 } = await supabase.from("mechanic_levels").update({ sort_order: 参数.sortA }).eq("id", 参数.idB);
  if (e2) return { success: false, error: e2.message };

  revalidatePath("/mechanic-levels");
  return { success: true };
}

"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* 员工分组属组织架构管理：仅 admin / boss 可写，
 * 与数据库 RLS 策略 has_role('admin','boss') 口径一致（migrations_20260916_a） */
const 可管分组角色 = ["admin", "boss"];

/* 检查指定用户是否有分组管理角色 */
async function 是分组管理员(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profile_roles")
    .select("roles(name)")
    .eq("profile_id", userId);
  return ((data || []) as unknown as { roles?: { name?: string } | null }[]).some(
    (d) => d.roles?.name != null && 可管分组角色.includes(d.roles.name)
  );
}

/* 统一校验：返回 null 表示通过，否则返回错误响应（普通员工调用了也白调） */
async function 校验分组管理权限(): Promise<{ success: false; error: string } | null> {
  const { user, error } = await 验证用户已登录();
  if (!user) return { success: false, error: error || "未登录或登录已过期，请重新登录" };
  if (!(await 是分组管理员(user.id))) {
    return { success: false, error: "只有管理员或老板能维护员工分组" };
  }
  return null;
}

/* ═══ 员工分组删除 Server Action ═══
 * 删除操作从客户端直写收口到服务端，删除前服务端重新检查成员数防止误删。 */
export async function 删除员工分组(id: string): Promise<{ success: boolean; error?: string }> {
  const 拒绝 = await 校验分组管理权限();
  if (拒绝) return 拒绝;

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

/* ═══ 新建员工分组 Server Action ═══
 * 写操作从客户端直写收口到服务端，避免客户端 session 异常导致 401 / 被 RLS 拦截。 */
export async function 新建员工分组(参数: {
  name: string;
  description: string;
  sortOrder: number;
}): Promise<{ success: boolean; error?: string }> {
  const 拒绝 = await 校验分组管理权限();
  if (拒绝) return 拒绝;

  if (!参数.name.trim()) {
    return { success: false, error: "请填写分组名称" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("employee_groups").insert({
    name: 参数.name.trim(),
    description: 参数.description.trim() || null,
    sort_order: 参数.sortOrder,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/employee-groups");
  return { success: true };
}

/* ═══ 员工分组排序交换 Server Action ═══
 * 两行 sort_order 互换从客户端直写收口到服务端，两次更新顺序执行。 */
export async function 交换员工分组排序(参数: {
  aId: string;
  aSortOrder: number;
  bId: string;
  bSortOrder: number;
}): Promise<{ success: boolean; error?: string }> {
  const 拒绝 = await 校验分组管理权限();
  if (拒绝) return 拒绝;

  const supabase = await createClient();
  const { error: e1 } = await supabase
    .from("employee_groups")
    .update({ sort_order: 参数.bSortOrder })
    .eq("id", 参数.aId);
  if (e1) {
    return { success: false, error: e1.message };
  }
  const { error: e2 } = await supabase
    .from("employee_groups")
    .update({ sort_order: 参数.aSortOrder })
    .eq("id", 参数.bId);
  if (e2) {
    return { success: false, error: e2.message };
  }

  revalidatePath("/employee-groups");
  return { success: true };
}

/* ═══ 员工分组排序号保存 Server Action ═══
 * 单个排序号更新从客户端直写收口到服务端。 */
export async function 保存员工分组排序号(id: string, sortOrder: number): Promise<{ success: boolean; error?: string }> {
  const 拒绝 = await 校验分组管理权限();
  if (拒绝) return 拒绝;

  const supabase = await createClient();
  const { error } = await supabase
    .from("employee_groups")
    .update({ sort_order: sortOrder })
    .eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/employee-groups");
  return { success: true };
}

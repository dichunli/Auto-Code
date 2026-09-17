"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { 包装ServerAction错误 } from "@/lib/supabase/server";
import { 考勤管理角色名单 } from "@/lib/attendanceDays";

interface 收支分类 {
  id: string;
  name: string;
  type: string;
  sort_order: number;
  is_active: boolean;
}

/* 收支分类属财务字典：写操作限 admin/boss/accountant（名单与考勤工资同口径），
 * 与数据库 RLS has_role('admin','boss','accountant') 一致（migrations_20260916_b）。
 * 读操作（下拉列表）保持只验登录，手机端录入页不受影响。 */
async function 是财务角色(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profile_roles")
    .select("roles(name)")
    .eq("profile_id", userId);
  return ((data || []) as unknown as { roles?: { name?: string } | null }[]).some(
    (d) => d.roles?.name != null && 考勤管理角色名单.includes(d.roles.name)
  );
}

/* 统一校验：返回 null 表示通过，否则返回错误响应 */
async function 校验财务权限(): Promise<{ success: false; error: string } | null> {
  const { user, error } = await 验证用户已登录();
  if (!user) return { success: false, error: error || "未登录或登录已过期，请重新登录" };
  if (!(await 是财务角色(user.id))) {
    return { success: false, error: "只有管理员、老板或财务能维护收支分类" };
  }
  return null;
}

/* 新建收支分类（重名检查 + 排序号都在服务端做，避免并发重名/重号） */
export async function 新建收支分类(参数: {
  name: string;
  type: string;
}): Promise<{ success: boolean; error?: string }> {
  return 包装ServerAction错误(async () => {
    const supabase = await createClient();
    const 拒绝 = await 校验财务权限();
    if (拒绝) return 拒绝;

    const name = 参数.name.trim();
    if (!name) return { success: false, error: "请填写分类名称" };

    const { data: existing } = await supabase
      .from("other_transaction_categories")
      .select("id")
      .eq("name", name)
      .eq("type", 参数.type)
      .limit(1);
    if (existing && existing.length > 0) {
      return { success: false, error: "该分类名称已存在" };
    }

    const { data: maxRow } = await supabase
      .from("other_transaction_categories")
      .select("sort_order")
      .eq("type", 参数.type)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { error } = await supabase.from("other_transaction_categories").insert({
      name,
      type: 参数.type,
      sort_order: (maxRow?.sort_order || 0) + 10,
    });

    if (error) {
      return { success: false, error: "保存失败：" + error.message };
    }
    return { success: true };
  }) as Promise<{ success: boolean; error?: string }>;
}

/* 更新收支分类（重名检查排除自己） */
export async function 更新收支分类(参数: {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}): Promise<{ success: boolean; error?: string }> {
  return 包装ServerAction错误(async () => {
    const supabase = await createClient();
    const 拒绝 = await 校验财务权限();
    if (拒绝) return 拒绝;

    const name = 参数.name.trim();
    if (!name) return { success: false, error: "请填写分类名称" };

    const { data: existing } = await supabase
      .from("other_transaction_categories")
      .select("id")
      .eq("name", name)
      .eq("type", 参数.type)
      .neq("id", 参数.id)
      .limit(1);
    if (existing && existing.length > 0) {
      return { success: false, error: "该分类名称已存在" };
    }

    const { error } = await supabase
      .from("other_transaction_categories")
      .update({ name, type: 参数.type, is_active: 参数.isActive })
      .eq("id", 参数.id);

    if (error) {
      return { success: false, error: "保存失败：" + error.message };
    }
    return { success: true };
  }) as Promise<{ success: boolean; error?: string }>;
}

/* 获取其它收支分类列表 */
export async function 获取收支分类列表(): Promise<{
  success: boolean;
  data?: 收支分类[];
  error?: string;
}> {
  return 包装ServerAction错误(async () => {
    const supabase = await createClient();
    const { user, error: 登录错误 } = await 验证用户已登录();
    if (!user) return { success: false, error: 登录错误 || "未登录" };
    const { data, error } = await supabase
      .from("other_transaction_categories")
      .select("id, name, type, sort_order, is_active")
      .order("sort_order", { ascending: true })
      .order("name");

    if (error) {
      return { success: false, error: "加载失败：" + error.message };
    }

    return { success: true, data: (data || []) as 收支分类[] };
  }) as Promise<{ success: boolean; data?: 收支分类[]; error?: string }>;
}

/* 删除收支分类 */
export async function 删除收支分类(id: string): Promise<{ success: boolean; error?: string }> {
  return 包装ServerAction错误(async () => {
    const supabase = await createClient();
    const 拒绝 = await 校验财务权限();
    if (拒绝) return 拒绝;

    /* 检查是否已被使用 */
    const { count } = await supabase
      .from("other_transactions")
      .select("id", { count: "exact", head: true })
      .eq("category_id", id);

    if ((count || 0) > 0) {
      return { success: false, error: "该分类已被使用，不能删除" };
    }

    const { error } = await supabase.from("other_transaction_categories").delete().eq("id", id);

    if (error) {
      return { success: false, error: "删除失败：" + error.message };
    }

    return { success: true };
  }) as Promise<{ success: boolean; error?: string }>;
}

/* 批量更新分类排序 */
export async function 更新收支分类排序(参数: {
  items: { id: string; sort_order: number }[];
}): Promise<{ success: boolean; error?: string }> {
  return 包装ServerAction错误(async () => {
    const supabase = await createClient();
    const 拒绝 = await 校验财务权限();
    if (拒绝) return 拒绝;

    for (const item of 参数.items) {
      const { error } = await supabase
        .from("other_transaction_categories")
        .update({ sort_order: item.sort_order })
        .eq("id", item.id);

      if (error) {
        return { success: false, error: "排序保存失败：" + error.message };
      }
    }

    return { success: true };
  }) as Promise<{ success: boolean; error?: string }>;
}

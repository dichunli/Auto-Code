"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { 包装ServerAction错误 } from "@/lib/supabase/server";

interface 收支分类 {
  id: string;
  name: string;
  type: string;
  sort_order: number;
  is_active: boolean;
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
    const { user, error: 登录错误 } = await 验证用户已登录();
    if (!user) return { success: false, error: 登录错误 || "未登录" };

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
    const { user, error: 登录错误 } = await 验证用户已登录();
    if (!user) return { success: false, error: 登录错误 || "未登录" };

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

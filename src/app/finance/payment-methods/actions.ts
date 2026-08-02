"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { 包装ServerAction错误 } from "@/lib/supabase/server";

interface 收款方式 {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

/* 获取收款方式列表 */
export async function 获取收款方式列表(): Promise<{
  success: boolean;
  data?: 收款方式[];
  error?: string;
}> {
  return 包装ServerAction错误(async () => {
    const supabase = await createClient();
    const { user, error: 登录错误 } = await 验证用户已登录();
    if (!user) return { success: false, error: 登录错误 || "未登录" };
    const { data, error } = await supabase
      .from("payment_methods")
      .select("id, code, name, sort_order, is_active")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      return { success: false, error: "加载失败：" + error.message };
    }

    return { success: true, data: (data || []) as 收款方式[] };
  }) as Promise<{ success: boolean; data?: 收款方式[]; error?: string }>;
}

/* 新建收款方式 */
export async function 创建收款方式(参数: {
  code: string;
  name: string;
  sort_order: number;
}): Promise<{ success: boolean; error?: string }> {
  return 包装ServerAction错误(async () => {
    const supabase = await createClient();
    const { user, error: 登录错误 } = await 验证用户已登录();
    if (!user) return { success: false, error: 登录错误 || "未登录" };
    const { error } = await supabase.from("payment_methods").insert({
      code: 参数.code.trim(),
      name: 参数.name.trim(),
      sort_order: 参数.sort_order,
    });

    if (error) {
      return { success: false, error: "保存失败：" + error.message };
    }

    return { success: true };
  }) as Promise<{ success: boolean; error?: string }>;
}

/* 更新收款方式 */
export async function 更新收款方式(参数: {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}): Promise<{ success: boolean; error?: string }> {
  return 包装ServerAction错误(async () => {
    const supabase = await createClient();
    const { user, error: 登录错误 } = await 验证用户已登录();
    if (!user) return { success: false, error: 登录错误 || "未登录" };
    const { error } = await supabase
      .from("payment_methods")
      .update({
        name: 参数.name.trim(),
        sort_order: 参数.sort_order,
        is_active: 参数.is_active,
      })
      .eq("id", 参数.id);

    if (error) {
      return { success: false, error: "更新失败：" + error.message };
    }

    return { success: true };
  }) as Promise<{ success: boolean; error?: string }>;
}

/* 删除收款方式 */
export async function 删除收款方式(id: string): Promise<{ success: boolean; error?: string }> {
  return 包装ServerAction错误(async () => {
    const supabase = await createClient();
    const { user, error: 登录错误 } = await 验证用户已登录();
    if (!user) return { success: false, error: 登录错误 || "未登录" };
    const { error } = await supabase.from("payment_methods").delete().eq("id", id);

    if (error) {
      return { success: false, error: "删除失败：" + error.message };
    }

    return { success: true };
  }) as Promise<{ success: boolean; error?: string }>;
}

/* 更新排序 */
export async function 更新收款方式排序(参数: {
  id: string;
  sort_order: number;
}): Promise<{ success: boolean; error?: string }> {
  return 包装ServerAction错误(async () => {
    const supabase = await createClient();
    const { user, error: 登录错误 } = await 验证用户已登录();
    if (!user) return { success: false, error: 登录错误 || "未登录" };
    const { error } = await supabase
      .from("payment_methods")
      .update({ sort_order: 参数.sort_order })
      .eq("id", 参数.id);

    if (error) {
      return { success: false, error: "排序保存失败：" + error.message };
    }

    return { success: true };
  }) as Promise<{ success: boolean; error?: string }>;
}

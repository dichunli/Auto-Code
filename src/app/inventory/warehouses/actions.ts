"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { 包装ServerAction错误 } from "@/lib/supabase/server";

interface 仓库 {
  id: string;
  name: string;
  address?: string | null;
  created_at: string;
}

interface 仓位 {
  id: string;
  name: string;
  warehouse_id: string;
}

/* 获取仓库列表 */
export async function 获取仓库列表(): Promise<{
  success: boolean;
  data?: 仓库[];
  error?: string;
}> {
  return 包装ServerAction错误(async () => {
    const supabase = await createClient();
    const { user, error: 登录错误 } = await 验证用户已登录();
    if (!user) return { success: false, error: 登录错误 || "未登录" };
    const { data, error } = await supabase
      .from("warehouses")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      return { success: false, error: "加载失败：" + error.message };
    }

    const list = (data || []) as 仓库[];
    list.sort((a, b) => {
      const aMain = a.name === "主仓库" || a.name.includes("主") ? -1 : 0;
      const bMain = b.name === "主仓库" || b.name.includes("主") ? -1 : 0;
      if (aMain !== bMain) return aMain - bMain;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return { success: true, data: list };
  }) as Promise<{ success: boolean; data?: 仓库[]; error?: string }>;
}

/* 删除仓库 */
export async function 删除仓库(id: string): Promise<{ success: boolean; error?: string }> {
  return 包装ServerAction错误(async () => {
    const supabase = await createClient();
    const { user, error: 登录错误 } = await 验证用户已登录();
    if (!user) return { success: false, error: 登录错误 || "未登录" };
    const { error } = await supabase.from("warehouses").delete().eq("id", id);

    if (error) {
      return { success: false, error: "删除失败：" + error.message };
    }

    return { success: true };
  }) as Promise<{ success: boolean; error?: string }>;
}

/* 更新仓库 */
export async function 更新仓库(参数: {
  id: string;
  name: string;
  address?: string | null;
}): Promise<{ success: boolean; error?: string }> {
  return 包装ServerAction错误(async () => {
    const supabase = await createClient();
    const { user, error: 登录错误 } = await 验证用户已登录();
    if (!user) return { success: false, error: 登录错误 || "未登录" };
    const { error } = await supabase
      .from("warehouses")
      .update({
        name: 参数.name.trim(),
        address: 参数.address?.trim() || null,
      })
      .eq("id", 参数.id);

    if (error) {
      return { success: false, error: "保存失败：" + error.message };
    }

    return { success: true };
  }) as Promise<{ success: boolean; error?: string }>;
}

/* 获取仓位列表 */
export async function 获取仓位列表(warehouseId: string): Promise<{
  success: boolean;
  data?: 仓位[];
  error?: string;
}> {
  return 包装ServerAction错误(async () => {
    const supabase = await createClient();
    const { user, error: 登录错误 } = await 验证用户已登录();
    if (!user) return { success: false, error: 登录错误 || "未登录" };
    const { data, error } = await supabase
      .from("warehouse_locations")
      .select("*")
      .eq("warehouse_id", warehouseId)
      .order("name", { ascending: true });

    if (error) {
      return { success: false, error: "加载失败：" + error.message };
    }

    return { success: true, data: (data || []) as 仓位[] };
  }) as Promise<{ success: boolean; data?: 仓位[]; error?: string }>;
}

/* 新增仓位 */
export async function 新增仓位(参数: {
  warehouse_id: string;
  name: string;
}): Promise<{ success: boolean; error?: string }> {
  return 包装ServerAction错误(async () => {
    const supabase = await createClient();
    const { user, error: 登录错误 } = await 验证用户已登录();
    if (!user) return { success: false, error: 登录错误 || "未登录" };
    const { error } = await supabase.from("warehouse_locations").insert({
      warehouse_id: 参数.warehouse_id,
      name: 参数.name.trim(),
    });

    if (error) {
      return { success: false, error: "添加失败：" + error.message };
    }

    return { success: true };
  }) as Promise<{ success: boolean; error?: string }>;
}

/* 批量新增仓位 */
export async function 批量新增仓位(参数: {
  warehouse_id: string;
  names: string[];
}): Promise<{ success: boolean; error?: string }> {
  return 包装ServerAction错误(async () => {
    const supabase = await createClient();
    const { user, error: 登录错误 } = await 验证用户已登录();
    if (!user) return { success: false, error: 登录错误 || "未登录" };
    const rows = 参数.names.map((name) => ({
      warehouse_id: 参数.warehouse_id,
      name: name.trim(),
    }));

    const { error } = await supabase.from("warehouse_locations").insert(rows);

    if (error) {
      return { success: false, error: "批量添加失败：" + error.message };
    }

    return { success: true };
  }) as Promise<{ success: boolean; error?: string }>;
}

/* 删除仓位 */
export async function 删除仓位(id: string): Promise<{ success: boolean; error?: string }> {
  return 包装ServerAction错误(async () => {
    const supabase = await createClient();
    const { user, error: 登录错误 } = await 验证用户已登录();
    if (!user) return { success: false, error: 登录错误 || "未登录" };
    const { error } = await supabase.from("warehouse_locations").delete().eq("id", id);

    if (error) {
      return { success: false, error: "删除失败：" + error.message };
    }

    return { success: true };
  }) as Promise<{ success: boolean; error?: string }>;
}

/* 更新仓位 */
export async function 更新仓位(参数: {
  id: string;
  name: string;
}): Promise<{ success: boolean; error?: string }> {
  return 包装ServerAction错误(async () => {
    const supabase = await createClient();
    const { user, error: 登录错误 } = await 验证用户已登录();
    if (!user) return { success: false, error: 登录错误 || "未登录" };
    const { error } = await supabase
      .from("warehouse_locations")
      .update({ name: 参数.name.trim() })
      .eq("id", 参数.id);

    if (error) {
      return { success: false, error: "保存失败：" + error.message };
    }

    return { success: true };
  }) as Promise<{ success: boolean; error?: string }>;
}

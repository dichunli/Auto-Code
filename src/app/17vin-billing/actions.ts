"use server";

import { createAdminClient } from "@/lib/supabase/admin";

export interface 调用记录 {
  id: string;
  接口类型: string;
  请求参数: Record<string, unknown>;
  响应状态: number | null;
  是否成功: boolean;
  错误信息: string | null;
  创建时间: string;
}

export interface 调用记录查询结果 {
  success: boolean;
  data?: 调用记录[];
  total?: number;
  error?: string;
}

/* 分页查询17VIN调用记录 */
export async function 查询调用记录(
  页码: number = 1,
  每页条数: number = 20
): Promise<调用记录查询结果> {
  try {
    const admin = createAdminClient();
    const offset = (页码 - 1) * 每页条数;

    const { data, error, count } = await admin
      .from("vin17_api_logs")
      .select("*", { count: "exact" })
      .order("创建时间", { ascending: false })
      .range(offset, offset + 每页条数 - 1);

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: (data || []) as 调用记录[],
      total: count || 0,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "查询失败";
    return { success: false, error: msg };
  }
}

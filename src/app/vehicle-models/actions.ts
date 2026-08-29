"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 车型库 Server Action ═══
 * Excel 导入的查重和分批写入从客户端直写收口到服务端，
 * 避免客户端 session 异常中断导入。客户端只负责解析 Excel。 */

/* 导入行：键是中文列名，值可能是字符串/数字/空（日期列已在客户端转成字符串） */
export type 车型导入行 = Record<string, unknown>;

export async function 导入车型(参数: {
  rows: 车型导入行[];
}): Promise<{ success: boolean; inserted?: number; skipped?: number; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  if (!参数.rows || 参数.rows.length === 0) {
    return { success: false, error: "文件中没有数据" };
  }

  const supabase = await createClient();

  /* ID 查重（分批查） */
  const allIds = 参数.rows
    .map((r) => r.id)
    .filter((v): v is number => typeof v === "number");
  const existingIds = new Set<number>();
  for (let i = 0; i < allIds.length; i += 1000) {
    const { data } = await supabase
      .from("vehicle_models")
      .select("id")
      .in("id", allIds.slice(i, i + 1000));
    data?.forEach((r) => existingIds.add(r.id as number));
  }

  const newRecords = 参数.rows.filter((r) => typeof r.id !== "number" || !existingIds.has(r.id));
  const skipped = 参数.rows.length - newRecords.length;
  if (newRecords.length === 0) {
    return { success: true, inserted: 0, skipped };
  }

  /* 分批插入 */
  const batchSize = 500;
  let inserted = 0;
  for (let i = 0; i < newRecords.length; i += batchSize) {
    const batch = newRecords.slice(i, i + batchSize);
    const { error } = await supabase.from("vehicle_models").insert(batch);
    if (error) {
      return { success: false, error: `第 ${Math.floor(i / batchSize) + 1} 批导入失败: ${error.message}（已导入 ${inserted} 条）` };
    }
    inserted += batch.length;
  }

  revalidatePath("/vehicle-models");
  return { success: true, inserted, skipped };
}

import { createClient } from "@/lib/supabase/server";
import VehicleModelsContent from "./VehicleModelsContent";

/* ═════════════════════════════════════════════════════════════════
 * 车型库 — Server Component
 *
 * 数据查询在服务端完成，彻底消除客户端 session 问题。
 * 筛选通过 URL query params 驱动服务端重新查询。
 * ═════════════════════════════════════════════════════════════════ */

export default async function VehicleModelsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const sp = (await Promise.resolve(searchParams || {})) as Record<string, string | undefined>;
  const keyword = (sp.keyword || "").trim();
  const page = Math.max(1, parseInt(sp.page || "1", 10));
  const pageSize = 50;

  /* 解析列筛选参数（以 cf_ 开头的参数） */
  const columnFilters: Record<string, string> = {};
  for (const [key, value] of Object.entries(sp)) {
    if (key.startsWith("cf_") && value?.trim()) {
      columnFilters[key.slice(3)] = value.trim();
    }
  }

  const supabase = await createClient();

  let query = supabase.from("vehicle_models").select("*", { count: "exact" });

  /* 关键词搜索 */
  if (keyword) {
    query = query.or(
      `品牌.ilike.%${keyword}%,车系.ilike.%${keyword}%,车型.ilike.%${keyword}%,厂商.ilike.%${keyword}%,发动机型号.ilike.%${keyword}%`,
    );
  }

  /* 列筛选 */
  for (const [col, val] of Object.entries(columnFilters)) {
    if (col === "id") {
      const num = parseInt(val, 10);
      if (!isNaN(num)) query = query.eq(col as string, num);
    } else {
      query = query.ilike(col as string, `%${val}%`);
    }
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, count, error } = await query.order("id").range(from, to);

  const total = count || 0;
  const models = ((data as unknown as Record<string, unknown>[]) || []);

  return (
    <VehicleModelsContent
      models={models as unknown as Parameters<typeof VehicleModelsContent>[0]["models"]}
      total={total}
      page={page}
      keyword={keyword}
      columnFilters={columnFilters}
      queryError={error?.message || null}
    />
  );
}

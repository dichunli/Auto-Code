"use server";

import { createClient } from "@/lib/supabase/server";
import { syncOeFromVin } from "@/app/parts/actions";

export interface VinQueryResult {
  vin: string;
  oil: { oeNumber: string; fromCache: boolean } | null;
  air: { oeNumber: string; fromCache: boolean } | null;
  cabin: { oeNumber: string; fromCache: boolean } | null;
  error?: string;
}

/* 批量查VIN三滤OE号 */
export async function batchQueryVinFilters(vinList: string[]): Promise<{
  success: boolean;
  data?: VinQueryResult[];
  error?: string;
}> {
  const supabase = await createClient();
  const results: VinQueryResult[] = [];

  /* 1. 先批量查本地缓存 */
  const normalizedVins = vinList.map((v) => v.trim().toUpperCase());
  const { data: caches } = await supabase
    .from("vin_filter_cache")
    .select("vin, filter_type, oe_number")
    .in("vin", normalizedVins);

  /* 按VIN+filter_type建立缓存映射 */
  const cacheMap = new Map<string, string>();
  for (const c of caches || []) {
    cacheMap.set(`${c.vin}|${c.filter_type}`, c.oe_number);
  }

  /* 2. 对每个VIN查三滤 */
  const filterNames: Array<{ name: string; key: "oil" | "air" | "cabin" }> = [
    { name: "机油滤", key: "oil" },
    { name: "空气滤", key: "air" },
    { name: "空调滤", key: "cabin" },
  ];

  for (const vin of normalizedVins) {
    const result: VinQueryResult = { vin, oil: null, air: null, cabin: null };

    for (const { name, key } of filterNames) {
      const cacheKey = `${vin}|${key}`;
      const cachedOe = cacheMap.get(cacheKey);

      if (cachedOe) {
        result[key] = { oeNumber: cachedOe, fromCache: true };
      } else {
        /* 没有缓存，调17VIN */
        try {
          const res = await syncOeFromVin(vin, name);
          if (res.success && res.oeNumber) {
            result[key] = { oeNumber: res.oeNumber, fromCache: false };
          }
        } catch {
          /* 忽略单个查询失败 */
        }
      }
    }

    results.push(result);
  }

  return { success: true, data: results };
}

"use server";

import { createClient } from "@/lib/supabase/server";
import { vin17SearchAftermarketParts } from "@/lib/17vin/client";

export interface VinQueryResult {
  vin: string;
  oil: { oeNumber: string; fromCache: boolean } | null;
  air: { oeNumber: string; fromCache: boolean } | null;
  cabin: { oeNumber: string; fromCache: boolean } | null;
  error?: string;
}

/* 判断配件名称对应的三滤类型 */
function judgeFilterType(name: string): "oil" | "air" | "cabin" | null {
  const n = name.toLowerCase();
  if ((n.includes("机油") || n.includes("oil")) && (n.includes("滤") || n.includes("filter"))) {
    return "oil";
  }
  if ((n.includes("空气") || n.includes("air")) && (n.includes("滤") || n.includes("filter"))) {
    return "air";
  }
  if ((n.includes("空调") || n.includes("cabin") || n.includes("花粉") || n.includes("粉尘")) && (n.includes("滤") || n.includes("filter"))) {
    return "cabin";
  }
  return null;
}

/* 批量查VIN三滤OE号（轻量版，只查OE号不查车型） */
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
  for (const vin of normalizedVins) {
    const result: VinQueryResult = { vin, oil: null, air: null, cabin: null };

    /* 检查缓存是否已存在全部三滤 */
    const hasOil = cacheMap.has(`${vin}|oil`);
    const hasAir = cacheMap.has(`${vin}|air`);
    const hasCabin = cacheMap.has(`${vin}|cabin`);

    if (hasOil) result.oil = { oeNumber: cacheMap.get(`${vin}|oil`)!, fromCache: true };
    if (hasAir) result.air = { oeNumber: cacheMap.get(`${vin}|air`)!, fromCache: true };
    if (hasCabin) result.cabin = { oeNumber: cacheMap.get(`${vin}|cabin`)!, fromCache: true };

    /* 如果三滤都缓存了，跳过17VIN查询 */
    if (hasOil && hasAir && hasCabin) {
      results.push(result);
      continue;
    }

    /* 缺失部分，调17VIN一次查所有滤清器 */
    try {
      const res = await vin17SearchAftermarketParts(vin, "博世", "滤清器");
      if (res.code === 1 && res.data?.aftermarket) {
        for (const item of res.data.aftermarket) {
          const name = String((item.name || item.name_zh || item.Name || item.std_name_zh || "") as string);
          const type = judgeFilterType(name);
          if (!type) continue;

          /* 如果该类型已有缓存，跳过 */
          if (type === "oil" && result.oil) continue;
          if (type === "air" && result.air) continue;
          if (type === "cabin" && result.cabin) continue;

          const oeNumber = String((item.partnumber_original || item.oem_partnumber || item.oe_number || item.oe || "") as string);
          if (!oeNumber) continue;

          result[type] = { oeNumber, fromCache: false };

          /* 写入缓存（只写OE号，车型留空） */
          await supabase.from("vin_filter_cache").upsert({
            vin,
            filter_type: type,
            oe_number: oeNumber,
            name,
            source_brand: "博世",
            updated_at: new Date().toISOString(),
          }, { onConflict: "vin,filter_type" });
        }
      }
    } catch {
      /* 17VIN查询失败，继续下一个VIN */
    }

    results.push(result);
  }

  return { success: true, data: results };
}

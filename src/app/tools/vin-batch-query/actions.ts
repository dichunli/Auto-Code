"use server";

import { createClient } from "@/lib/supabase/server";
import { syncOeFromVin } from "@/app/parts/actions";
import { 标准化VIN } from "@/lib/vinValidator";

export interface VinQueryResult {
  vin: string;
  oil: { oeNumber: string; fromCache: boolean; matchedModels?: number } | null;
  air: { oeNumber: string; fromCache: boolean; matchedModels?: number } | null;
  cabin: { oeNumber: string; fromCache: boolean; matchedModels?: number } | null;
  error?: string;
}

/* 三滤定义 */
const 三滤列表 = [
  { type: "oil" as const, name: "机油滤" },
  { type: "air" as const, name: "空气滤" },
  { type: "cabin" as const, name: "空调滤" },
];

/* 批量查VIN三滤OE号（含车型同步） */
export async function batchQueryVinFilters(vinList: string[]): Promise<{
  success: boolean;
  data?: VinQueryResult[];
  error?: string;
}> {
  const supabase = await createClient();
  const results: VinQueryResult[] = [];
  const normalizedVins = vinList.map((v) => 标准化VIN(v));

  /* 1. 先批量查本地缓存（用于判断 fromCache 标记） */
  const { data: caches } = await supabase
    .from("vin_filter_cache")
    .select("vin, filter_type, oe_number, matched_model_ids")
    .in("vin", normalizedVins);

  const cacheMap = new Map<string, { oe: string; models: number }>();
  for (const c of caches || []) {
    cacheMap.set(`${c.vin}|${c.filter_type}`, {
      oe: c.oe_number,
      models: c.matched_model_ids?.length || 0,
    });
  }

  /* 2. 对每个VIN查三滤 */
  for (const vin of normalizedVins) {
    const result: VinQueryResult = { vin, oil: null, air: null, cabin: null };

    for (const { type, name } of 三滤列表) {
      const cacheKey = `${vin}|${type}`;
      const cached = cacheMap.get(cacheKey);

      if (cached) {
        /* 缓存已有OE号 */
        result[type] = {
          oeNumber: cached.oe,
          fromCache: true,
          matchedModels: cached.models,
        };

        /* 缓存有OE号但缺车型数据，调用 syncOeFromVin 补录 */
        if (cached.models === 0) {
          try {
            const res = await syncOeFromVin(vin, name);
            if (res.success && res.oeNumber) {
              result[type] = {
                oeNumber: res.oeNumber,
                fromCache: false,
                matchedModels: res.matchedModelIds?.length || 0,
              };
            }
          } catch {
            /* 补录失败不影响OE号返回 */
          }
        }
      } else {
        /* 缓存没有，走完整流程 */
        try {
          const res = await syncOeFromVin(vin, name);
          if (res.success && res.oeNumber) {
            result[type] = {
              oeNumber: res.oeNumber,
              fromCache: false,
              matchedModels: res.matchedModelIds?.length || 0,
            };
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

/* 补录车型数据：对已有OE号但缺车型数据的缓存记录进行补录 */
export interface 补录结果项 {
  vin: string;
  type: "oil" | "air" | "cabin";
  typeName: string;
  oeNumber: string;
  synced: boolean; /* true=本次补录成功, false=跳过或失败 */
  matchedModels: number;
}

export async function batchSyncMissingModels(vinList: string[]): Promise<{
  success: boolean;
  data?: 补录结果项[];
  totalSkipped?: number;
  totalSynced?: number;
  totalFailed?: number;
  error?: string;
}> {
  const supabase = await createClient();
  const normalizedVins = vinList.map((v) => 标准化VIN(v));

  /* 查这些VIN的缓存记录 */
  const { data: caches } = await supabase
    .from("vin_filter_cache")
    .select("vin, filter_type, oe_number, matched_model_ids")
    .in("vin", normalizedVins);

  const results: 补录结果项[] = [];
  let totalSkipped = 0;
  let totalSynced = 0;
  let totalFailed = 0;

  for (const vin of normalizedVins) {
    for (const { type, name } of 三滤列表) {
      const cache = (caches || []).find(
        (c) => c.vin === vin && c.filter_type === type
      );

      /* 没有缓存记录，无法补录 */
      if (!cache) {
        results.push({
          vin,
          type,
          typeName: name,
          oeNumber: "",
          synced: false,
          matchedModels: 0,
        });
        totalFailed++;
        continue;
      }

      /* 已经有车型数据，跳过 */
      if (cache.matched_model_ids && cache.matched_model_ids.length > 0) {
        results.push({
          vin,
          type,
          typeName: name,
          oeNumber: cache.oe_number,
          synced: false,
          matchedModels: cache.matched_model_ids.length,
        });
        totalSkipped++;
        continue;
      }

      /* 有OE号但缺车型数据，调用 syncOeFromVin 补录 */
      try {
        const res = await syncOeFromVin(vin, name);
        if (res.success && res.matchedModelIds && res.matchedModelIds.length > 0) {
          results.push({
            vin,
            type,
            typeName: name,
            oeNumber: cache.oe_number,
            synced: true,
            matchedModels: res.matchedModelIds.length,
          });
          totalSynced++;
        } else {
          results.push({
            vin,
            type,
            typeName: name,
            oeNumber: cache.oe_number,
            synced: false,
            matchedModels: 0,
          });
          totalFailed++;
        }
      } catch {
        results.push({
          vin,
          type,
          typeName: name,
          oeNumber: cache.oe_number,
          synced: false,
          matchedModels: 0,
        });
        totalFailed++;
      }
    }
  }

  return {
    success: true,
    data: results,
    totalSkipped,
    totalSynced,
    totalFailed,
  };
}

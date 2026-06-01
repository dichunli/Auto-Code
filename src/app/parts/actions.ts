"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { vin17DecodeVin, vin17GetModelListFromPartNumber, vin17SearchFiltersByVin, vin17SearchAftermarketParts } from "@/lib/17vin/client";

interface 同步结果 {
  success: boolean;
  message?: string;
  matchedCount?: number;
  totalCount?: number;
  error?: string;
}

/* 通过VIN获取group_id，然后同步17VIN适配车型 */
export async function syncPartVin17Models(partId: string, vin: string): Promise<同步结果> {
  const supabase = await createClient();

  /* 1. 查询配件信息 */
  const { data: part, error: partError } = await supabase
    .from("parts")
    .select("id, oe_number, name, vin17_group_id")
    .eq("id", partId)
    .single();

  if (partError || !part) {
    return { success: false, error: "配件不存在" };
  }

  if (!part.oe_number) {
    return { success: false, error: "该配件没有OE号，无法同步17VIN车型" };
  }

  /* 2. VIN解码获取group_id */
  let groupId: string;
  try {
    const decodeRes = (await vin17DecodeVin(vin)) as {
      code: number;
      data?: { model_list?: Array<{ group_id?: string | number }> };
    };
    if (decodeRes.code !== 1 || !decodeRes.data?.model_list?.[0]) {
      return { success: false, error: "VIN解码失败，未找到车型信息" };
    }
    const gid = decodeRes.data.model_list[0].group_id;
    if (!gid) {
      return { success: false, error: "VIN解码结果中缺少品牌分组ID(group_id)" };
    }
    groupId = String(gid);
  } catch (err: unknown) {
    return { success: false, error: "VIN解码出错: " + (err instanceof Error ? err.message : String(err)) };
  }

  /* 3. 用OE号+group_id调40031接口获取适配车型 */
  let modelList: Array<Record<string, unknown>> = [];
  try {
    const fitRes = (await vin17GetModelListFromPartNumber(part.oe_number, groupId)) as {
      code: number;
      data?: { model_list_std?: Array<Record<string, unknown>> };
    };
    if (fitRes.code !== 1) {
      return { success: false, error: "17VIN接口返回错误" };
    }
    modelList = fitRes.data?.model_list_std || [];
  } catch (err: unknown) {
    return { success: false, error: "查询适配车型出错: " + (err instanceof Error ? err.message : String(err)) };
  }

  if (modelList.length === 0) {
    return { success: false, error: "17VIN未返回该配件的适配车型" };
  }

  /* 4. 把group_id存到配件表 */
  await supabase.from("parts").update({ vin17_group_id: groupId }).eq("id", partId);

  /* 5. 用公共函数匹配17VIN车型到本地车型库 */
  const matchedModelIds = await matchVin17ModelsToLocal(supabase, modelList);

  /* 6. 写入 part_vehicle_models */
  if (matchedModelIds.length > 0) {
    const inserts = matchedModelIds.map((id) => ({
      part_id: partId,
      vehicle_model_id: id,
      source: "17vin",
    }));

    const { error: insertError } = await supabase.from("part_vehicle_models").upsert(inserts, {
      onConflict: "part_id,vehicle_model_id",
      ignoreDuplicates: true,
    });

    if (insertError) {
      return { success: false, error: "写入适配车型失败: " + insertError.message };
    }
  }

  revalidatePath(`/parts/${partId}`);
  return {
    success: true,
    message: `同步完成，17VIN返回${modelList.length}个适配车型，匹配到本地${uniqueMatched.length}个车型`,
    matchedCount: uniqueMatched.length,
    totalCount: modelList.length,
  };
}

export async function deletePart(partId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const checks = await Promise.all([
    supabase.from("work_order_item_parts").select("id", { count: "exact", head: true }).eq("part_id", partId),
    supabase.from("purchase_order_items").select("id", { count: "exact", head: true }).eq("part_id", partId),
    supabase.from("inventory_logs").select("id", { count: "exact", head: true }).eq("part_id", partId),
    supabase.from("inventory_check_items").select("id", { count: "exact", head: true }).eq("part_id", partId),
    supabase.from("purchase_returns").select("id", { count: "exact", head: true }).eq("part_id", partId),
  ]);

  const hasBusinessData = checks.some((c) => (c.count || 0) > 0);
  if (hasBusinessData) {
    return { success: false, error: "该配件已有业务数据（工单、采购单、库存记录等），无法删除" };
  }

  const { error } = await supabase.from("parts").delete().eq("id", partId);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/inventory");
  return { success: true };
}

/* 判断配件名称对应的三滤类型 */
function judgeFilterType(name: string): "oil" | "air" | "cabin" | null {
  const n = name.toLowerCase();
  /* 机油滤 */
  if ((n.includes("机油") || n.includes("oil") || n.includes("öl")) && (n.includes("滤") || n.includes("filter"))) {
    return "oil";
  }
  /* 空气滤 */
  if ((n.includes("空气") || n.includes("air") || n.includes("luft")) && (n.includes("滤") || n.includes("filter"))) {
    return "air";
  }
  /* 空调滤 / 花粉滤 / 粉尘滤 */
  if ((n.includes("空调") || n.includes("cabin") || n.includes("花粉") || n.includes("pollen") || n.includes("粉尘") || n.includes("dust") || n.includes("innenraum")) && (n.includes("滤") || n.includes("filter"))) {
    return "cabin";
  }
  return null;
}

/* 精准匹配三滤名称 */
function exactFilterType(name: string): "oil" | "air" | "cabin" | null {
  const n = name.trim();
  if (n === "机油滤" || n === "机油滤清器") return "oil";
  if (n === "空气滤" || n === "空气滤清器") return "air";
  if (n === "空调滤" || n === "空调滤清器") return "cabin";
  return null;
}

/* 公共函数：将17VIN返回的车型列表匹配到本地车型库 */
async function matchVin17ModelsToLocal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  modelList: Array<Record<string, unknown>>
): Promise<string[]> {
  const { data: localModels } = await supabase
    .from("vehicle_models")
    .select("id, brand, series, model_name, year_start, year_end, engine");

  const matchedIds: string[] = [];

  for (const vm of modelList as Array<{
    brand?: string;
    series?: string;
    model?: string;
    model_name?: string;
    year?: string | number;
    year_start?: string | number;
    year_end?: string | number;
    engine_no?: string;
    engine?: string;
  }>) {
    const vmBrand = (vm.brand || "").toLowerCase().trim();
    const vmSeries = (vm.series || "").toLowerCase().trim();
    const vmModel = (vm.model || vm.model_name || "").toLowerCase().trim();
    const vmYear = vm.year ? parseInt(String(vm.year)) : null;
    const vmEngine = (vm.engine_no || vm.engine || "").toLowerCase().trim();

    for (const local of localModels || []) {
      const localBrand = (local.brand || "").toLowerCase().trim();
      const localSeries = (local.series || "").toLowerCase().trim();
      const localModel = (local.model_name || "").toLowerCase().trim();
      const localYearStart = local.year_start;
      const localYearEnd = local.year_end;
      const localEngine = (local.engine || "").toLowerCase().trim();

      if (!vmBrand || !localBrand) continue;
      const brandMatch = vmBrand === localBrand || localBrand.includes(vmBrand) || vmBrand.includes(localBrand);
      if (!brandMatch) continue;

      if (vmSeries && localSeries) {
        const seriesMatch = vmSeries === localSeries || localSeries.includes(vmSeries) || vmSeries.includes(localSeries);
        if (!seriesMatch) continue;
      }

      if (vmModel && localModel) {
        const modelMatch = vmModel === localModel || localModel.includes(vmModel) || vmModel.includes(localModel);
        if (!modelMatch) continue;
      }

      if (vmYear && localYearStart && localYearEnd) {
        if (vmYear < localYearStart - 1 || vmYear > localYearEnd + 1) continue;
      }

      if (vmEngine && localEngine) {
        const engineMatch = localEngine.includes(vmEngine) || vmEngine.includes(localEngine);
        if (!engineMatch) continue;
      }

      matchedIds.push(local.id);
      break;
    }
  }

  /* 去重 */
  return [...new Set(matchedIds)];
}

/* 通过VIN+三滤类型查询OE号（先读本地缓存，没有再调17VIN，查到后同步车型数据入缓存） */
export async function syncOeFromVin(
  vin: string,
  filterName: string
): Promise<{
  success: boolean;
  oeNumber?: string;
  filterType?: string;
  matchedModelIds?: string[];
  error?: string;
}> {
  const supabase = await createClient();
  const filterType = exactFilterType(filterName);
  if (!filterType) {
    return { success: false, error: "只支持机油滤/空气滤/空调滤" };
  }

  const normalizedVin = vin.trim().toUpperCase();

  /* 1. 查本地缓存（30天内有效） */
  const { data: cache } = await supabase
    .from("vin_filter_cache")
    .select("*")
    .eq("vin", normalizedVin)
    .eq("filter_type", filterType)
    .single();

  /* 本地有缓存直接返回（不过期，只在查不到时去17VIN同步） */
  if (cache) {
    return {
      success: true,
      oeNumber: cache.oe_number,
      filterType,
      matchedModelIds: cache.matched_model_ids || [],
    };
  }

  /* 2. 本地没有或已过期，调17VIN查OE号 */
  const brands = ["博世", "马勒", "曼牌"];
  let oeNumber = "";
  let sourceBrand = "";
  let vin17GroupId = "";

  for (const brand of brands) {
    try {
      const res = await vin17SearchAftermarketParts(normalizedVin, brand, "滤清器");
      if (res.code !== 1) continue;

      const list = res.data?.aftermarket || [];
      for (const item of list) {
        const name = String((item.name || item.name_zh || item.Name || item.Name_zh || item.std_name_zh || item.std_name || "") as string);
        const itemType = judgeFilterType(name);
        if (itemType !== filterType) continue;

        const foundOe = String((item.partnumber_original || item.oem_partnumber || item.oe_number || item.OE || item.oe || "") as string);
        if (foundOe) {
          oeNumber = foundOe;
          sourceBrand = brand;
          break;
        }
      }
      if (oeNumber) break;
    } catch {
      /* 忽略单个品牌查询失败 */
    }
  }

  if (!oeNumber) {
    return { success: false, error: `未找到该车型${filterName}的OE号` };
  }

  /* 3. VIN解码获取group_id */
  let modelList: Array<Record<string, unknown>> = [];
  try {
    const decodeRes = (await vin17DecodeVin(normalizedVin)) as {
      code: number;
      data?: { model_list?: Array<{ group_id?: string | number }> };
    };
    if (decodeRes.code === 1 && decodeRes.data?.model_list?.[0]) {
      const gid = decodeRes.data.model_list[0].group_id;
      if (gid) {
        vin17GroupId = String(gid);

        /* 4. 用OE号+group_id查适配车型（API 40031） */
        const fitRes = (await vin17GetModelListFromPartNumber(oeNumber, vin17GroupId)) as {
          code: number;
          data?: { model_list_std?: Array<Record<string, unknown>> };
        };
        if (fitRes.code === 1) {
          modelList = fitRes.data?.model_list_std || [];
        }
      }
    }
  } catch {
    /* 车型查询失败不影响OE号返回 */
  }

  /* 5. 匹配本地车型库 */
  let matchedModelIds: string[] = [];
  if (modelList.length > 0) {
    matchedModelIds = await matchVin17ModelsToLocal(supabase, modelList);
  }

  /* 6. 写入缓存表 */
  await supabase.from("vin_filter_cache").upsert({
    vin: normalizedVin,
    filter_type: filterType,
    oe_number: oeNumber,
    name: filterName,
    source_brand: sourceBrand,
    vin17_group_id: vin17GroupId,
    model_data: modelList.length > 0 ? modelList : null,
    matched_model_ids: matchedModelIds.length > 0 ? matchedModelIds : null,
    updated_at: new Date().toISOString(),
  }, {
    onConflict: "vin,filter_type",
  });

  return {
    success: true,
    oeNumber,
    filterType,
    matchedModelIds,
  };
}

/* VIN查三滤：用新接口7001（aftermarket_vin）查询保养件 */
export async function searchVinFilters(
  vin: string,
  manufacturerBrand?: string
): Promise<{
  success: boolean;
  data?: Array<{
    type: "oil" | "air" | "cabin";
    typeName: string;
    oeNumber: string;
    partNumber: string;
    name: string;
    brand: string;
    manufacturerBrand: string;
    category: string;
    remark: string;
  }>;
  error?: string;
}> {
  try {
    /* 方式一：用新接口7001查（需要传品牌） */
    if (manufacturerBrand) {
      const res = await vin17SearchAftermarketParts(vin, manufacturerBrand, "滤清器");

      if (res.code !== 1) {
        return { success: false, error: res.msg || "17VIN接口返回错误" };
      }

      const list = res.data?.aftermarket || [];
      const results: Array<{
        type: "oil" | "air" | "cabin";
        typeName: string;
        oeNumber: string;
        partNumber: string;
        name: string;
        brand: string;
        manufacturerBrand: string;
        category: string;
        remark: string;
      }> = [];

      for (const item of list) {
        /* 灵活获取字段（兼容大小写） */
        const name = String((item.name || item.name_zh || item.Name || item.Name_zh || item.std_name_zh || item.std_name || "") as string);
        const oeNumber = String((item.partnumber_original || item.oem_partnumber || item.oe_number || item.OE || item.oe || "") as string);
        const partNumber = String((item.partnumber || item.part_number || item.PartNumber || "") as string);
        const brand = String((item.brand || item.Brand || "") as string);
        const mfrBrand = String((item.manufacturer_brand || item.manufacturer_brand || manufacturerBrand) as string);
        const category = String((item.category || item.Category || "滤清器") as string);
        const remark = String((item.remark || item.remark_zh || item.Remark || "") as string);

        const type = judgeFilterType(name);
        if (!type) continue;

        results.push({
          type,
          typeName: type === "oil" ? "机油滤清器" : type === "air" ? "空气滤清器" : "空调滤清器",
          oeNumber: oeNumber || partNumber,
          partNumber: partNumber || oeNumber,
          name,
          brand,
          manufacturerBrand: mfrBrand,
          category,
          remark,
        });
      }

      /* 去重：相同OE号+类型只保留一个 */
      const seen = new Set<string>();
      const unique = results.filter((r) => {
        const key = r.type + "|" + r.oeNumber;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return { success: true, data: unique };
    }

    /* 方式二：没有指定品牌时，回退到旧方式（EPC遍历） */
    const results = await vin17SearchFiltersByVin(vin);
    return {
      success: true,
      data: results.map((r) => ({
        ...r,
        brand: "",
        manufacturerBrand: "",
        category: "滤清器",
      })),
    };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

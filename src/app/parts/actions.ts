"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { vin17DecodeVin, vin17GetModelListFromPartNumber, vin17GetModelListFromPartNumberForAftermarket, vin17SearchFiltersByVin, vin17SearchAftermarketParts } from "@/lib/17vin/client";
import { 判断三滤类型, 精准三滤类型 } from "@/lib/filterType";
import { 车型库匹配字段 } from "@/lib/vehicleModelFields";
import { 标准化字符串, 标准化大写 } from "@/lib/stringNormalize";
import { 标准化VIN } from "@/lib/vinValidator";
import { 生成完整系统码, 配件系统码前缀, 提取系统码序号 } from "@/lib/systemCode";

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
      data?: { group_id?: string | number; model_list?: Array<{ group_id?: string | number; Group_id?: string | number }> };
    };
    if (decodeRes.code !== 1) {
      return { success: false, error: "VIN解码失败，未找到车型信息" };
    }
    const gid = decodeRes.data?.group_id || decodeRes.data?.model_list?.[0]?.group_id || decodeRes.data?.model_list?.[0]?.Group_id;
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
    message: `同步完成，17VIN返回${modelList.length}个适配车型，匹配到本地${matchedModelIds.length}个车型`,
    matchedCount: matchedModelIds.length,
    totalCount: modelList.length,
  };
}

/* 已有OE号时，通过VIN查适配车型（不查OE号，只查40031车型） */
export async function syncModelsFromVin(
  oeNumber: string,
  vin: string
): Promise<{
  success: boolean;
  matchedModelIds?: number[];
  error?: string;
}> {
  const supabase = await createClient();

  /* 1. VIN解码获取group_id */
  let groupId: string;
  try {
    const decodeRes = (await vin17DecodeVin(vin)) as {
      code: number;
      data?: { group_id?: string | number; model_list?: Array<{ group_id?: string | number; Group_id?: string | number }> };
    };
    if (decodeRes.code !== 1) {
      return { success: false, error: "VIN解码失败，未找到车型信息" };
    }
    const gid = decodeRes.data?.group_id || decodeRes.data?.model_list?.[0]?.group_id || decodeRes.data?.model_list?.[0]?.Group_id;
    if (!gid) {
      return { success: false, error: "VIN解码结果中缺少品牌分组ID(group_id)" };
    }
    groupId = String(gid);
  } catch (err: unknown) {
    return { success: false, error: "VIN解码出错: " + (err instanceof Error ? err.message : String(err)) };
  }

  /* 2. 用OE号+group_id查适配车型（API 40031） */
  let modelList: Array<Record<string, unknown>> = [];
  try {
    const fitRes = (await vin17GetModelListFromPartNumber(oeNumber, groupId)) as {
      code: number;
      data?: { model_list_std?: Array<Record<string, unknown>> };
    };
    if (fitRes.code === 1) {
      modelList = fitRes.data?.model_list_std || [];
    }
  } catch { /* 忽略 */ }

  /* 3. 40031返回空，尝试40032易损件接口 */
  if (modelList.length === 0) {
    try {
      const fitRes2 = (await vin17GetModelListFromPartNumberForAftermarket(oeNumber, groupId, "engine")) as {
        code: number;
        data?: { model_list_std?: Array<Record<string, unknown>> };
      };
      if (fitRes2.code === 1) {
        modelList = fitRes2.data?.model_list_std || [];
      }
    } catch { /* 忽略 */ }
  }

  if (modelList.length === 0) {
    return { success: false, error: "17VIN未返回该配件的适配车型" };
  }

  /* 4. 匹配本地车型库 */
  const matchedModelIds = await matchVin17ModelsToLocal(supabase, modelList);

  return {
    success: true,
    matchedModelIds,
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

/* 公共函数：将17VIN返回的车型列表匹配到本地车型库 */
async function matchVin17ModelsToLocal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  modelList: Array<Record<string, unknown>>
): Promise<number[]> {
  const { data: localModels } = await supabase
    .from("vehicle_models")
    .select(车型库匹配字段);

  const matchedIds: number[] = [];

  for (const vm of modelList as Array<{
    id?: number;
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
      const localBrand = (local.品牌 || "").toLowerCase().trim();
      const localSeries = (local.车系 || "").toLowerCase().trim();
      const localModel = (local.车型 || "").toLowerCase().trim();
      const localYear = local.年款;
      const localEngine = (local.发动机型号 || "").toLowerCase().trim();

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

      if (vmYear && localYear) {
        if (vmYear < localYear - 1 || vmYear > localYear + 1) continue;
      }

      if (vmEngine && localEngine) {
        const engineMatch = localEngine.includes(vmEngine) || vmEngine.includes(localEngine);
        if (!engineMatch) continue;
      }

      matchedIds.push(local.id);
      break;
    }
  }

  return [...new Set(matchedIds)];
}

/* 用VIN解码的单车信息匹配本地车型库（40031返回空时的备选方案） */
async function matchVinDecodeModelToLocal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  vinModel: {
    Brand?: string;
    Series?: string;
    Model?: string;
    Engine_no?: string;
    Date_begin?: string;
    Date_end?: string;
    Model_year?: string;
  }
): Promise<number[]> {
  const { data: localModels } = await supabase
    .from("vehicle_models")
    .select(车型库匹配字段);

  const vmBrand = (vinModel.Brand || "").toLowerCase().trim();
  const vmSeries = (vinModel.Series || "").toLowerCase().trim();
  const vmModel = (vinModel.Model || "").toLowerCase().trim();
  const vmEngine = (vinModel.Engine_no || "").toLowerCase().trim();
  const yearStr = vinModel.Model_year || vinModel.Date_begin || "";
  const vmYear = yearStr ? parseInt(String(yearStr).slice(0, 4)) : null;

  const matchedIds: number[] = [];

  for (const local of localModels || []) {
    const localBrand = (local.品牌 || "").toLowerCase().trim();
    const localSeries = (local.车系 || "").toLowerCase().trim();
    const localModel = (local.车型 || "").toLowerCase().trim();
    const localYear = local.年款;
    const localEngine = (local.发动机型号 || "").toLowerCase().trim();

    if (!vmBrand || !localBrand) continue;
    const brandMatch = localBrand.includes(vmBrand) || vmBrand.includes(localBrand);
    if (!brandMatch) continue;

    /* 有机油滤/空气滤/空调滤这类配件，优先按发动机匹配，车型次之 */
    if (vmEngine && localEngine) {
      const engineMatch = localEngine.includes(vmEngine) || vmEngine.includes(localEngine);
      if (!engineMatch) continue;
    } else if (vmSeries && localSeries) {
      /* 没有发动机信息时，用车系+车型兜底 */
      const seriesMatch = localSeries.includes(vmSeries) || vmSeries.includes(localSeries);
      if (!seriesMatch) continue;
    } else if (vmModel && localModel) {
      const modelMatch = localModel.includes(vmModel) || vmModel.includes(localModel);
      if (!modelMatch) continue;
    }

    if (vmYear && localYear) {
      if (vmYear < localYear - 1 || vmYear > localYear + 1) continue;
    }

    matchedIds.push(local.id);
  }

  /* 没有匹配到，自动创建一条车型记录 */
  if (matchedIds.length === 0 && vmBrand) {
    const { data: newModel } = await supabase
      .from("vehicle_models")
      .insert({
        品牌: vinModel.Brand || "",
        车系: vinModel.Series || "",
        车型: vinModel.Model || "",
        年款: vmYear || null,
        发动机型号: vinModel.Engine_no || "",
      })
      .select("id")
      .single();
    if (newModel) {
      matchedIds.push(newModel.id);
    }
  }

  return [...new Set(matchedIds)];
}

/* 通过VIN+三滤类型查询OE号（先读本地缓存，没有再调17VIN，查到后同步车型数据入缓存）
   brand: 指定品牌查询，查不到返回失败；不指定则依次试博世/马勒/曼牌
*/
export async function syncOeFromVin(
  vin: string,
  filterName: string,
  brand?: string
): Promise<{
  success: boolean;
  oeNumber?: string;
  brandPartNumber?: string;
  filterType?: string;
  matchedModelIds?: number[];
  error?: string;
}> {
  const supabase = await createClient();
  const filterType = 精准三滤类型(filterName);
  if (!filterType) {
    return { success: false, error: "只支持机油滤/空气滤/空调滤" };
  }

  const normalizedVin = 标准化VIN(vin);

  /* 1. 查本地缓存（30天内有效） */
  const { data: cache } = await supabase
    .from("vin_filter_cache")
    .select("*")
    .eq("vin", normalizedVin)
    .eq("filter_type", filterType)
    .single();

  /* 本地有缓存直接返回（不过期，只在查不到时去17VIN同步） */
  if (cache) {
    /* 如果缓存有车型数据且有品牌编码，直接返回 */
    if (cache.matched_model_ids && cache.matched_model_ids.length > 0 && cache.brand_part_number) {
      return {
        success: true,
        oeNumber: cache.oe_number,
        brandPartNumber: cache.brand_part_number,
        filterType,
        matchedModelIds: cache.matched_model_ids,
      };
    }
    /* 缓存有OE号但缺车型数据或缺品牌编码，下面补充 */
  }

  /* 2. 确定OE号（缓存有直接用，没有则调17VIN查） */
  let oeNumber = cache?.oe_number || "";
  let brandPartNumber = cache?.brand_part_number || "";
  let sourceBrand = cache?.source_brand || "";
  let vin17GroupId = cache?.vin17_group_id || "";

  /* 如果缓存缺品牌编码，也重新查17VIN */
  if (!oeNumber || !brandPartNumber) {
    /* 方式一：7001接口（aftermarket_vin） */
    /* 传了brand就查指定品牌，没传就不传manufacturer_brand返回所有品牌 */
    const brandsToTry: (string | undefined)[] = brand ? [brand] : [undefined];
    for (const b of brandsToTry) {
      try {
        const res = await vin17SearchAftermarketParts(normalizedVin, b, "滤清器");
        if (res.code !== 1) continue;

        const list = res.data?.aftermarket || [];
        for (const item of list) {
          const name = String((item.name || item.name_zh || item.Name || item.Name_zh || item.std_name_zh || item.std_name || "") as string);
          const itemType = 判断三滤类型(name);
          if (itemType !== filterType) continue;

          const foundOe = String((item.partnumber_original || item.oem_partnumber || item.oe_number || item.OE || item.oe || "") as string);
          const foundBrandPn = String((item.partnumber || item.part_number || item.PartNumber || "") as string);
          if (foundOe) {
            oeNumber = foundOe;
            brandPartNumber = foundBrandPn;
            /* 没传brand时，从返回数据里取实际品牌 */
            sourceBrand = b || String((item.manufacturer_brand || item.brand || "") as string);
            break;
          }
        }
        if (oeNumber) break;
      } catch {
        /* 忽略单个品牌查询失败 */
      }
    }

    /* 方式二：7001接口查不到，回退到EPC遍历 */
    if (!oeNumber) {
      try {
        const epcResults = await vin17SearchFiltersByVin(normalizedVin);
        for (const r of epcResults) {
          if (r.type !== filterType) continue;
          if (r.oeNumber) {
            oeNumber = r.oeNumber;
            brandPartNumber = r.partNumber || "";
            sourceBrand = brand || "";
            break;
          }
        }
      } catch {
        /* EPC遍历失败忽略 */
      }
    }
  }

  if (!oeNumber) {
    return { success: false, error: `未找到该车型${filterName}的OE号` };
  }

  /* 3. VIN解码获取group_id和车型信息 */
  let modelList: Array<Record<string, unknown>> = [];
  let vinDecodeModel: {
    Brand?: string;
    Series?: string;
    Model?: string;
    Engine_no?: string;
    Date_begin?: string;
    Date_end?: string;
    Model_year?: string;
  } | null = null;
  try {
    const decodeRes = (await vin17DecodeVin(normalizedVin)) as {
      code: number;
      data?: {
        group_id?: string | number;
        model_list?: Array<{
          group_id?: string | number;
          Group_id?: string | number;
          Brand?: string;
          Series?: string;
          Model?: string;
          Engine_no?: string;
          Date_begin?: string;
          Date_end?: string;
          Model_year?: string;
        }>
      };
    };
    if (decodeRes.code === 1) {
      /* group_id可能在data上，也可能在model_list[0]上，字段名可能是group_id或Group_id */
      const gid = decodeRes.data?.group_id || decodeRes.data?.model_list?.[0]?.group_id || decodeRes.data?.model_list?.[0]?.Group_id;
      if (gid) {
        vin17GroupId = String(gid);
        if (decodeRes.data?.model_list?.[0]) {
          vinDecodeModel = decodeRes.data.model_list[0];
        }

        /* 4. 用OE号+group_id查适配车型（API 40031） */
        const fitRes = (await vin17GetModelListFromPartNumber(oeNumber, vin17GroupId)) as {
          code: number;
          data?: { model_list_std?: Array<Record<string, unknown>> };
        };
        if (fitRes.code === 1) {
          modelList = fitRes.data?.model_list_std || [];
        }

        /* 4b. 40031返回空，尝试40032易损件接口 */
        if (modelList.length === 0) {
          try {
            const fitRes2 = (await vin17GetModelListFromPartNumberForAftermarket(oeNumber, vin17GroupId, "engine")) as {
              code: number;
              data?: { model_list_std?: Array<Record<string, unknown>> };
            };
            if (fitRes2.code === 1) {
              modelList = fitRes2.data?.model_list_std || [];
            }
          } catch {
            /* 40032失败忽略 */
          }
        }
      }
    }
  } catch {
    /* 车型查询失败不影响OE号返回 */
  }

  /* 5. 匹配本地车型库 */
  let matchedModelIds: number[] = [];
  if (modelList.length > 0) {
    matchedModelIds = await matchVin17ModelsToLocal(supabase, modelList);
  } else if (vinDecodeModel) {
    /* 40031返回空，用VIN解码的单车信息匹配本地车型库 */
    matchedModelIds = await matchVinDecodeModelToLocal(supabase, vinDecodeModel);
  }

  /* 6. 写入缓存表 */
  await supabase.from("vin_filter_cache").upsert({
    vin: normalizedVin,
    filter_type: filterType,
    oe_number: oeNumber,
    brand_part_number: brandPartNumber || null,
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
    brandPartNumber: brandPartNumber || undefined,
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

        const type = 判断三滤类型(name);
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

"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { vin17DecodeVin, vin17GetModelListFromPartNumber, vin17GetModelListFromPartNumberForAftermarket, vin17SearchFiltersByVin, vin17SearchAftermarketParts } from "@/lib/17vin/client";
import { 判断三滤类型, 精准三滤类型 } from "@/lib/filterType";
import { 车型库匹配字段, type 车型库行 } from "@/lib/vehicleModelFields";
import { 标准化VIN } from "@/lib/vinValidator";
import submitPart, { type SubmitPartParams, type SubmitPartResult } from "./new/submitPart";

/* ═══ 保存配件（新建/编辑）═══
 * 客户端提交改走服务端：避免客户端 session 异常导致保存 401 / 被 RLS 拦截。
 * 实际写库逻辑复用 parts/new/submitPart.ts（纯函数，接收服务端 client）。 */
export async function 保存配件(
  参数: Omit<SubmitPartParams, "supabase">
): Promise<SubmitPartResult> {
  const { user, error } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: error || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const result = await submitPart({ ...参数, supabase });

  if (result.success) {
    revalidatePath("/inventory");
    if (result.partId) {
      revalidatePath(`/parts/${result.partId}`);
    }
  }
  return result;
}

/* ═══ 合并配件（11 张表迁移，走原子事务 RPC merge_parts） ═══
 * 原来是客户端逐表循环写，中途失败留半成品；收编后一个事务要么全成要么全败。
 * 库存累加在服务端读最新数量，不用客户端快照。 */
export async function 合并配件(参数: {
  targetId: string;
  sourceIds: string[];
  name: string;
  partNumber: string;
  mergeQuantity: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("merge_parts", {
    p_target_id: 参数.targetId,
    p_source_ids: 参数.sourceIds,
    p_name: 参数.name,
    p_part_number: 参数.partNumber,
    p_merge_quantity: 参数.mergeQuantity,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as { success: boolean; error?: string };
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "合并失败" };
  }

  revalidatePath("/inventory");
  return { success: true };
}

/* ═══ 配件信息图片 增/删（采购看板目录图片） ═══ */
export async function 添加配件图片(参数: {
  partId: string;
  storagePath: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  /* 排序号在服务端取现有数量（防并发同号） */
  const { count } = await supabase
    .from("part_images")
    .select("id", { count: "exact", head: true })
    .eq("part_id", 参数.partId);

  const { error } = await supabase.from("part_images").insert({
    part_id: 参数.partId,
    storage_path: 参数.storagePath,
    sort_order: count || 0,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath(`/parts/${参数.partId}`);
  return { success: true };
}

export async function 删除配件图片(参数: {
  partId: string;
  storagePath: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("part_images")
    .delete()
    .eq("part_id", 参数.partId)
    .eq("storage_path", 参数.storagePath);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath(`/parts/${参数.partId}`);
  return { success: true };
}

interface 同步结果 {
  success: boolean;
  message?: string;
  matchedCount?: number;
  totalCount?: number;
  error?: string;
}

/* 通过VIN获取group_id，然后同步17VIN适配车型 */
export async function syncPartVin17Models(partId: string, vin: string): Promise<同步结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

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

  /* 3. 用OE号+group_id调40031接口获取适配车型，OE号去空格 */
  const cleanOeNumber = (part.oe_number || "").replace(/\s/g, "");
  let modelList: Array<Record<string, unknown>> = [];
  try {
    const fitRes = (await vin17GetModelListFromPartNumber(cleanOeNumber, groupId)) as {
      code: number;
      data?: Record<string, unknown>;
    };
    if (fitRes.code !== 1) {
      return { success: false, error: "17VIN接口返回错误" };
    }
    if (fitRes.data) {
      const list =
        fitRes.data.ModelListStd ??
        fitRes.data.model_list_std ??
        fitRes.data.Model_list_std ??
        fitRes.data.model_list ??
        fitRes.data.Model_list ??
        fitRes.data.list ??
        fitRes.data.List;
      if (Array.isArray(list)) {
        modelList = list as Array<Record<string, unknown>>;
      }
    }
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
  rawOeNumber: string,
  vin: string
): Promise<{
  success: boolean;
  matchedModelIds?: number[];
  error?: string;
}> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const oeNumber = rawOeNumber.replace(/\s/g, "");

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
      data?: Record<string, unknown>;
    };
    if (fitRes.code === 1 && fitRes.data) {
      const list =
        fitRes.data.ModelListStd ??
        fitRes.data.model_list_std ??
        fitRes.data.Model_list_std ??
        fitRes.data.model_list ??
        fitRes.data.Model_list ??
        fitRes.data.list ??
        fitRes.data.List;
      if (Array.isArray(list)) {
        modelList = list as Array<Record<string, unknown>>;
      }
    }
  } catch { /* 忽略 */ }

  /* 3. 40031返回空，尝试40032易损件接口 */
  if (modelList.length === 0) {
    try {
      const fitRes2 = (await vin17GetModelListFromPartNumberForAftermarket(oeNumber, groupId, "engine")) as {
        code: number;
        data?: Record<string, unknown>;
      };
      if (fitRes2.code === 1 && fitRes2.data) {
        const list =
          fitRes2.data.ModelListStd_aftermarket_by_engine ??
          fitRes2.data.ModelListStd ??
          fitRes2.data.model_list_std ??
          fitRes2.data.Model_list_std ??
          fitRes2.data.model_list ??
          fitRes2.data.Model_list ??
          fitRes2.data.list ??
          fitRes2.data.List;
        if (Array.isArray(list)) {
          modelList = list as Array<Record<string, unknown>>;
        }
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

/* 直接通过OE号+groupId同步车型（无需VIN，用于已有group_id的配件） */
export async function syncModelsByGroupId(
  rawOeNumber: string,
  groupId: string
): Promise<{
  success: boolean;
  matchedModelIds?: number[];
  error?: string;
}> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const oeNumber = rawOeNumber.replace(/\s/g, "");

  /* 1. 用OE号+group_id查适配车型（API 40031） */
  let modelList: Array<Record<string, unknown>> = [];
  let debugInfo40031 = "";
  let debugInfo40032 = "";
  try {
    const fitRes = (await vin17GetModelListFromPartNumber(oeNumber, groupId)) as {
      code: number;
      data?: Record<string, unknown>;
      msg?: string;
    };
    const dataKeys = fitRes.data ? Object.keys(fitRes.data).join(",") : "null";
    debugInfo40031 = `code=${fitRes.code}, data keys=[${dataKeys}]`;
    if (fitRes.code === 1 && fitRes.data) {
      /* 兼容可能的字段名 */
      const list =
        fitRes.data.ModelListStd ??
        fitRes.data.model_list_std ??
        fitRes.data.Model_list_std ??
        fitRes.data.model_list ??
        fitRes.data.Model_list ??
        fitRes.data.list ??
        fitRes.data.List;
      if (Array.isArray(list)) {
        modelList = list as Array<Record<string, unknown>>;
      }
    }
  } catch (err: unknown) {
    debugInfo40031 = "异常: " + (err instanceof Error ? err.message : String(err));
  }

  /* 2. 40031返回空，尝试40032易损件接口 */
  if (modelList.length === 0) {
    try {
      const fitRes2 = (await vin17GetModelListFromPartNumberForAftermarket(oeNumber, groupId, "engine")) as {
        code: number;
        data?: Record<string, unknown>;
        msg?: string;
      };
      const dataKeys2 = fitRes2.data ? Object.keys(fitRes2.data).join(",") : "null";
      debugInfo40032 = `code=${fitRes2.code}, data keys=[${dataKeys2}]`;
      if (fitRes2.code === 1 && fitRes2.data) {
        const list =
          fitRes2.data.ModelListStd_aftermarket_by_engine ??
          fitRes2.data.ModelListStd ??
          fitRes2.data.model_list_std ??
          fitRes2.data.Model_list_std ??
          fitRes2.data.model_list ??
          fitRes2.data.Model_list ??
          fitRes2.data.list ??
          fitRes2.data.List;
        if (Array.isArray(list)) {
          modelList = list as Array<Record<string, unknown>>;
        }
      }
    } catch (err: unknown) {
      debugInfo40032 = "异常: " + (err instanceof Error ? err.message : String(err));
    }
  }

  if (modelList.length === 0) {
    return {
      success: false,
      error: `17VIN未返回适配车型。OE=${oeNumber}, group=${groupId}, 40031: ${debugInfo40031}, 40032: ${debugInfo40032}`,
    };
  }

  /* 3. 匹配本地车型库 */
  const matchedModelIds = await matchVin17ModelsToLocal(supabase, modelList);

  if (matchedModelIds.length === 0) {
    return {
      success: false,
      error: `17VIN返回${modelList.length}个车型，但本地车型库未匹配`,
    };
  }

  return {
    success: true,
    matchedModelIds,
  };
}

export async function deletePart(partId: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

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

/* 公共函数：将17VIN返回的车型列表匹配到本地车型库（优先用ID精确匹配） */
async function matchVin17ModelsToLocal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  modelList: Array<Record<string, unknown>>
): Promise<number[]> {
  /* 1. 优先用ID精确匹配（本地车型库就是17VIN的数据，ID是一套编号） */
  const vin17Ids: number[] = [];
  for (const vm of modelList) {
    const idVal = vm.Id ?? vm.id ?? vm.ID;
    if (idVal != null) {
      const numId = typeof idVal === "number" ? idVal : parseInt(String(idVal), 10);
      if (!isNaN(numId)) {
        vin17Ids.push(numId);
      }
    }
  }

  if (vin17Ids.length > 0) {
    const { data: matchedById } = await supabase
      .from("vehicle_models")
      .select("id")
      .in("id", [...new Set(vin17Ids)]);
    if (matchedById && matchedById.length > 0) {
      return matchedById.map((r: Record<string, unknown>) => r.id as number);
    }
  }

  /* 2. ID匹配不上，回退到字段模糊匹配 */
  const { data: localModels } = (await supabase
    .from("vehicle_models")
    .select(车型库匹配字段)) as unknown as { data: 车型库行[] | null };

  const matchedIds: number[] = [];

  for (const vmRaw of modelList) {
    const vm = vmRaw as Record<string, unknown>;
    const vmBrand = String((vm.Brand ?? vm.brand ?? "") as string).toLowerCase().trim();
    const vmSeries = String((vm.Series ?? vm.series ?? "") as string).toLowerCase().trim();
    const vmModel = String((vm.Model ?? vm.model ?? vm.model_name ?? vm.Model_name ?? "") as string).toLowerCase().trim();
    const yearVal = vm.Model_year ?? vm.model_year ?? vm.year ?? vm.Year ?? vm.year_start ?? vm.Year_start ?? vm.year_end ?? vm.Year_end;
    const vmYear = yearVal ? parseInt(String(yearVal)) : null;
    const vmEngine = String((vm.Engine_no ?? vm.engine_no ?? vm.Engine ?? vm.engine ?? "") as string).toLowerCase().trim();

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
  const { data: localModels } = (await supabase
    .from("vehicle_models")
    .select(车型库匹配字段)) as unknown as { data: 车型库行[] | null };

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
  vin17GroupId?: string;
  error?: string;
}> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

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

        /* 4. 用OE号+group_id查适配车型（API 40031），OE号去空格 */
        const cleanOeNumber = oeNumber.replace(/\s/g, "");
        const fitRes = (await vin17GetModelListFromPartNumber(cleanOeNumber, vin17GroupId)) as {
          code: number;
          data?: Record<string, unknown>;
        };
        if (fitRes.code === 1 && fitRes.data) {
          const list =
            fitRes.data.ModelListStd ??
            fitRes.data.model_list_std ??
            fitRes.data.Model_list_std ??
            fitRes.data.model_list ??
            fitRes.data.Model_list ??
            fitRes.data.list ??
            fitRes.data.List;
          if (Array.isArray(list)) {
            modelList = list as Array<Record<string, unknown>>;
          }
        }

        /* 4b. 40031返回空，尝试40032易损件接口 */
        if (modelList.length === 0) {
          try {
            const fitRes2 = (await vin17GetModelListFromPartNumberForAftermarket(oeNumber, vin17GroupId, "engine")) as {
              code: number;
              data?: Record<string, unknown>;
            };
            if (fitRes2.code === 1 && fitRes2.data) {
              const list =
                fitRes2.data.ModelListStd_aftermarket_by_engine ??
                fitRes2.data.ModelListStd ??
                fitRes2.data.model_list_std ??
                fitRes2.data.Model_list_std ??
                fitRes2.data.model_list ??
                fitRes2.data.Model_list ??
                fitRes2.data.list ??
                fitRes2.data.List;
              if (Array.isArray(list)) {
                modelList = list as Array<Record<string, unknown>>;
              }
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
    vin17GroupId: vin17GroupId || undefined,
  };
}

/* ═══ 配件表单页（parts/new）现场新建品牌 / 规格 + 关联配件名称 ═══
 * 原来在 BrandSearch/SpecSearch 组件里客户端直写，收口到服务端。
 * 关联表插入遇唯一冲突（重复关联）视为成功，与客户端原逻辑一致。 */

/* 新建品牌，返回新记录 id（客户端选中用） */
export async function 新建品牌(name: string): Promise<{ success: boolean; id?: string; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!name.trim()) {
    return { success: false, error: "品牌名称不能为空" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("part_brands")
    .insert({ name: name.trim() })
    .select("id")
    .single();

  if (error || !data) {
    return { success: false, error: error?.message || "创建品牌失败" };
  }
  return { success: true, id: data.id };
}

/* 新建规格，返回新记录 id（客户端选中用） */
export async function 新建规格(name: string): Promise<{ success: boolean; id?: string; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!name.trim()) {
    return { success: false, error: "规格名称不能为空" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("part_specifications")
    .insert({ name: name.trim() })
    .select("id")
    .single();

  if (error || !data) {
    return { success: false, error: error?.message || "创建规格失败" };
  }
  return { success: true, id: data.id };
}

/* 关联配件名称 ↔ 品牌（重复关联静默忽略） */
export async function 关联名称品牌(
  partNameId: string,
  brandId: string
): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("part_name_brands")
    .insert({ part_name_id: partNameId, brand_id: brandId });

  /* 重复关联不算失败（与客户端原逻辑一致） */
  if (error && !error.message.includes("duplicate")) {
    return { success: false, error: error.message };
  }
  return { success: true };
}

/* 关联配件名称 ↔ 规格（重复关联静默忽略） */
export async function 关联名称规格(
  partNameId: string,
  specificationId: string
): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("part_name_specifications")
    .insert({ part_name_id: partNameId, specification_id: specificationId });

  /* 重复关联不算失败（与客户端原逻辑一致） */
  if (error && !error.message.includes("duplicate")) {
    return { success: false, error: error.message };
  }
  return { success: true };
}

/* ═══ 补写配件的 17VIN 分组ID ═══
 * 编辑配件时从 vin_filter_cache 找回 group_id 后顺手补到配件表，
 * 原来在 usePartFormInit 客户端直写，收口到服务端。 */
export async function 补写配件分组ID(
  partId: string,
  groupId: string
): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("parts")
    .update({ vin17_group_id: groupId })
    .eq("id", partId);
  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
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
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

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

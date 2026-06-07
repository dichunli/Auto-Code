"use server";

import { createClient } from "@/lib/supabase/server";
import { syncOeFromVin } from "@/app/parts/actions";
import { 标准化VIN } from "@/lib/vinValidator";
import { 配件系统码前缀, 生成完整系统码, 提取系统码序号 } from "@/lib/systemCode";

export interface CreatePartRow {
  partNumber: string;
  name: string;
  brand: string;
  unitCost: string;
  vin: string;
}

export interface CreatePartResult {
  partNumber: string;
  name: string;
  brand: string;
  vin: string;
  success: boolean;
  oeNumber?: string;
  brandPartNumber?: string;
  partId?: string;
  matchedModels?: number;
  error?: string;
}

/* 批量根据VIN创建配件（含OE号和车型关联） */
export async function batchCreatePartsFromVin(
  rows: CreatePartRow[]
): Promise<{ success: boolean; data?: CreatePartResult[]; error?: string }> {
  const supabase = await createClient();
  const results: CreatePartResult[] = [];

  /* 预加载part_names、part_brands、part_categories */
  const [{ data: partNames }, { data: partBrands }, { data: categories }] = await Promise.all([
    supabase.from("part_names").select("id, name, part_categories(id, name)"),
    supabase.from("part_brands").select("id, name"),
    supabase.from("part_categories").select("id, name"),
  ]);

  /* 查找或创建品牌 */
  async function getBrandId(brandName: string): Promise<string | null> {
    const existing = (partBrands || []).find((b) => b.name === brandName);
    if (existing) return existing.id;

    const { data, error } = await supabase.from("part_brands").insert({ name: brandName }).select("id").single();
    if (error || !data) return null;
    return data.id;
  }

  /* 查找或创建配件名称 */
  async function getPartNameId(name: string): Promise<string | null> {
    const existing = (partNames || []).find((pn) => pn.name === name);
    if (existing) return existing.id;

    /* 找不到则自动创建，分类用"滤清器" */
    const filterCategory = (categories || []).find((c) => c.name === "滤清器");
    if (!filterCategory) {
      return null;
    }

    const { data, error } = await supabase
      .from("part_names")
      .insert({ name, category_id: filterCategory.id, unit: "个" })
      .select("id")
      .single();

    if (error || !data) return null;
    return data.id;
  }

  for (const row of rows) {
    const result: CreatePartResult = {
      partNumber: row.partNumber,
      name: row.name,
      brand: row.brand,
      vin: row.vin,
      success: false,
    };

    /* 1. 检查零件编码是否已存在 */
    const { data: existingPart } = await supabase
      .from("parts")
      .select("id")
      .eq("part_number", 标准化VIN(row.partNumber))
      .maybeSingle();

    if (existingPart) {
      result.error = "零件编码已存在";
      results.push(result);
      continue;
    }

    /* 2. 校验名称 */
    const validNames = ["机油滤", "机油滤清器", "空气滤", "空气滤清器", "空调滤", "空调滤清器"];
    if (!validNames.includes(row.name.trim())) {
      result.error = "零件名称必须是机油滤/空气滤/空调滤";
      results.push(result);
      continue;
    }

    /* 3. 获取品牌ID */
    const brandId = await getBrandId(row.brand.trim());
    if (!brandId) {
      result.error = "品牌创建失败";
      results.push(result);
      continue;
    }

    /* 4. 获取配件名称ID */
    const partNameId = await getPartNameId(row.name.trim());
    if (!partNameId) {
      result.error = "配件名称创建失败（缺少滤清器分类）";
      results.push(result);
      continue;
    }

    /* 5. 用VIN+品牌查OE号（指定品牌，查不到不自动试其他品牌） */
    const vinRes = await syncOeFromVin(标准化VIN(row.vin), row.name.trim(), row.brand.trim());
    if (!vinRes.success || !vinRes.oeNumber) {
      result.error = vinRes.error || `该车型${row.name}无${row.brand}品牌OE号`;
      results.push(result);
      continue;
    }

    /* 6. 生成系统码 */
    const prefix = 配件系统码前缀();
    const { data: lastCode } = await supabase
      .from("parts")
      .select("system_code")
      .ilike("system_code", `${prefix}%`)
      .order("system_code", { ascending: false })
      .limit(1);

    let seq = 1;
    if (lastCode && lastCode.length > 0 && lastCode[0].system_code) {
      const lastSeq = 提取系统码序号(lastCode[0].system_code);
      if (lastSeq > 0) seq = lastSeq + 1;
    }
    const systemCode = 生成完整系统码(prefix, seq);

    /* 7. 创建配件 */
    const { data: newPart, error: createError } = await supabase
      .from("parts")
      .insert({
        system_code: systemCode,
        part_number: 标准化VIN(row.partNumber),
        name: row.name.trim(),
        part_name_id: partNameId,
        brand_id: brandId,
        unit_cost: row.unitCost ? parseFloat(row.unitCost) : null,
        oe_number: vinRes.oeNumber,
        vin17_group_id: vinRes.vin17GroupId || null,
        unit: "个",
        min_stock: 10,
      })
      .select("id")
      .single();

    if (createError || !newPart) {
      result.error = "创建配件失败: " + (createError?.message || "未知错误");
      results.push(result);
      continue;
    }

    result.partId = newPart.id;
    result.oeNumber = vinRes.oeNumber;
    result.success = true;

    /* 8. 关联车型 */
    if (vinRes.matchedModelIds && vinRes.matchedModelIds.length > 0) {
      const inserts = vinRes.matchedModelIds.map((id) => ({
        part_id: newPart.id,
        vehicle_model_id: id,
        source: "17vin",
      }));

      await supabase.from("part_vehicle_models").upsert(inserts, {
        onConflict: "part_id,vehicle_model_id",
        ignoreDuplicates: true,
      });

      result.matchedModels = vinRes.matchedModelIds.length;
    }

    results.push(result);
  }

  return { success: true, data: results };
}

/* 仅VIN自动创建三滤：上传VIN列表+指定品牌，自动创建机油滤/空气滤/空调滤 */
export async function autoCreateFiltersByVin(
  vinList: string[],
  brand: string
): Promise<{ success: boolean; data?: CreatePartResult[]; error?: string }> {
  const supabase = await createClient();
  const results: CreatePartResult[] = [];

  /* 预加载 */
  const [{ data: partNames }, { data: partBrands }, { data: categories }] = await Promise.all([
    supabase.from("part_names").select("id, name, part_categories(id, name)"),
    supabase.from("part_brands").select("id, name"),
    supabase.from("part_categories").select("id, name"),
  ]);

  const filterCategory = (categories || []).find((c) => c.name === "滤清器");
  if (!filterCategory) {
    return { success: false, error: "系统中缺少滤清器分类，请先创建" };
  }

  /* 查找或创建品牌 */
  let brandId: string | null = null;
  const existingBrand = (partBrands || []).find((b) => b.name === brand);
  if (existingBrand) {
    brandId = existingBrand.id;
  } else {
    const { data: newBrand } = await supabase.from("part_brands").insert({ name: brand }).select("id").single();
    if (newBrand) brandId = newBrand.id;
  }
  if (!brandId) {
    return { success: false, error: "品牌创建失败" };
  }

  /* 查找或创建三滤配件名称 */
  const filterNames = [
    { name: "机油滤", key: "oil" as const },
    { name: "空气滤", key: "air" as const },
    { name: "空调滤", key: "cabin" as const },
  ];

  const partNameIdMap = new Map<string, string>();
  for (const { name } of filterNames) {
    const existing = (partNames || []).find((pn) => pn.name === name);
    if (existing) {
      partNameIdMap.set(name, existing.id);
    } else {
      const { data: newPn } = await supabase
        .from("part_names")
        .insert({ name, category_id: filterCategory.id, unit: "个" })
        .select("id")
        .single();
      if (newPn) partNameIdMap.set(name, newPn.id);
    }
  }

  /* 生成系统码序号 */
  const prefix = 配件系统码前缀();
  const { data: lastCode } = await supabase
    .from("parts")
    .select("system_code")
    .ilike("system_code", `${prefix}%`)
    .order("system_code", { ascending: false })
    .limit(1);

  let seq = 1;
  if (lastCode && lastCode.length > 0 && lastCode[0].system_code) {
    const lastSeq = 提取系统码序号(lastCode[0].system_code);
    if (lastSeq > 0) seq = lastSeq + 1;
  }

  for (const vin of vinList) {
    const normalizedVin = 标准化VIN(vin);

    for (const { name } of filterNames) {
      const partNameId = partNameIdMap.get(name);
      if (!partNameId) continue;

      /* 查OE号和品牌编码 */
      const vinRes = await syncOeFromVin(normalizedVin, name, brand);
      if (!vinRes.success || !vinRes.oeNumber) {
        const result: CreatePartResult = {
          partNumber: `${prefix}${String(seq).padStart(3, "0")}`,
          name,
          brand,
          vin: normalizedVin,
          success: false,
          error: vinRes.error || `该车型${name}无${brand}品牌OE号`,
        };
        results.push(result);
        continue;
      }

      /* 配件编号优先用品牌编码，没有则用OE号 */
      const brandPn = vinRes.brandPartNumber?.trim();
      const systemCode = `${prefix}${String(seq).padStart(3, "0")}`;
      const partNumber = brandPn || vinRes.oeNumber || systemCode;

      /* 检查配件编号是否已存在 */
      const { data: existingPart } = await supabase
        .from("parts")
        .select("id")
        .eq("part_number", partNumber)
        .single();

      if (existingPart) {
        const result: CreatePartResult = {
          partNumber,
          name,
          brand,
          vin: normalizedVin,
          success: false,
          oeNumber: vinRes.oeNumber,
          brandPartNumber: brandPn,
          error: "配件编号已存在",
        };
        results.push(result);
        continue;
      }

      const result: CreatePartResult = {
        partNumber,
        name,
        brand,
        vin: normalizedVin,
        success: false,
      };

      /* 创建配件 */
      const { data: newPart, error: createError } = await supabase
        .from("parts")
        .insert({
          system_code: systemCode,
          part_number: partNumber,
          name,
          part_name_id: partNameId,
          brand_id: brandId,
          oe_number: vinRes.oeNumber,
          vin17_group_id: vinRes.vin17GroupId || null,
          unit: "个",
          min_stock: 10,
        })
        .select("id")
        .single();

      if (createError || !newPart) {
        result.error = "创建配件失败: " + (createError?.message || "未知错误");
        results.push(result);
        continue;
      }

      seq++;
      result.partId = newPart.id;
      result.oeNumber = vinRes.oeNumber;
      result.brandPartNumber = brandPn;
      result.success = true;

      /* 关联车型 */
      if (vinRes.matchedModelIds && vinRes.matchedModelIds.length > 0) {
        const inserts = vinRes.matchedModelIds.map((id) => ({
          part_id: newPart.id,
          vehicle_model_id: id,
          source: "17vin",
        }));
        await supabase.from("part_vehicle_models").upsert(inserts, {
          onConflict: "part_id,vehicle_model_id",
          ignoreDuplicates: true,
        });
        result.matchedModels = vinRes.matchedModelIds.length;
      }

      results.push(result);
    }
  }

  return { success: true, data: results };
}

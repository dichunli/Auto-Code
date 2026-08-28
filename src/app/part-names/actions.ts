"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 配件名称删除 Server Action ═══
 * 删除操作从客户端直写收口到服务端，删除前检查关联数据防止误删。 */
export async function 删除配件名称(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();

  /* 删除前检查：是否被库存、工单、采购、单位定价等引用 */
  const checks = await Promise.all([
    supabase.from("parts").select("id", { count: "exact", head: true }).eq("part_name_id", id),
    supabase.from("part_name_brands").select("id", { count: "exact", head: true }).eq("part_name_id", id),
    supabase.from("work_order_parts").select("id", { count: "exact", head: true }).eq("part_name_id", id),
    supabase.from("company_part_prices").select("id", { count: "exact", head: true }).eq("part_name_id", id),
    supabase.from("purchase_order_items").select("id", { count: "exact", head: true }).eq("part_name_id", id),
  ]);

  const used = checks.some((c) => (c.count ?? 0) > 0);
  if (used) {
    return { success: false, error: "该配件名称已被使用（存在库存、工单、采购等关联），不允许删除，但可以进行合并" };
  }

  const { error } = await supabase.from("part_names").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/part-names");
  return { success: true };
}

/* ═══ 配件名称表单字段（新建/编辑共用） ═══ */
export interface 配件名称表单 {
  name: string;
  category_id: string;
  unit: string;
  search_keywords: string;
  default_quantity: string;
  auto_link_vehicle_model: boolean;
  auto_match_17vin_models?: boolean;
  is_consumable: boolean;
  require_scan_check?: boolean;
  require_location_check?: boolean;
  sales_type: string;
  sales_value: string;
  diagnosis_type: string;
  diagnosis_value: string;
  repair_type: string;
  repair_value: string;
  qc_type: string;
  qc_value: string;
  picking_type: string;
  picking_value: string;
}

function 表单转写库(表单: 配件名称表单) {
  return {
    name: 表单.name.trim(),
    category_id: 表单.category_id,
    unit: 表单.unit,
    search_keywords: 表单.search_keywords || null,
    default_quantity: 表单.default_quantity ? parseInt(表单.default_quantity) : null,
    auto_link_vehicle_model: 表单.auto_link_vehicle_model,
    auto_match_17vin_models: 表单.auto_match_17vin_models ?? false,
    is_consumable: 表单.is_consumable,
    require_scan_check: 表单.require_scan_check ?? false,
    require_location_check: 表单.require_location_check ?? false,
    sales_commission_type: 表单.sales_type || null,
    sales_commission_value: 表单.sales_value ? parseFloat(表单.sales_value) : null,
    diagnosis_commission_type: 表单.diagnosis_type || null,
    diagnosis_commission_value: 表单.diagnosis_value ? parseFloat(表单.diagnosis_value) : null,
    repair_commission_type: 表单.repair_type || null,
    repair_commission_value: 表单.repair_value ? parseFloat(表单.repair_value) : null,
    qc_commission_type: 表单.qc_type || null,
    qc_commission_value: 表单.qc_value ? parseFloat(表单.qc_value) : null,
    picking_commission_type: 表单.picking_type || null,
    picking_commission_value: 表单.picking_value ? parseFloat(表单.picking_value) : null,
  };
}

/* ─── 新建配件名称（含关联品牌/规格，服务端一次完成） ─── */
export async function 新建配件名称(参数: {
  form: 配件名称表单;
  linkedBrandIds: string[];
  linkedSpecIds: string[];
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!参数.form.name.trim() || !参数.form.category_id) {
    return { success: false, error: "请填写配件名称和所属分类" };
  }

  const supabase = await createClient();

  /* 重名检查（服务端兜底，数据库唯一约束为最后防线） */
  const trimmedName = 参数.form.name.trim();
  const { data: existed } = await supabase
    .from("part_names")
    .select("id")
    .eq("name", trimmedName)
    .limit(1);
  if (existed && existed.length > 0) {
    return { success: false, error: `配件名称"${trimmedName}"已存在，请使用其他名称` };
  }

  const { data: inserted, error } = await supabase
    .from("part_names")
    .insert(表单转写库(参数.form))
    .select("id")
    .single();
  if (error || !inserted) {
    return { success: false, error: error?.message || "保存失败" };
  }

  if (参数.linkedBrandIds.length > 0) {
    await supabase.from("part_name_brands").insert(参数.linkedBrandIds.map((bid) => ({ part_name_id: inserted.id, brand_id: bid })));
  }
  if (参数.linkedSpecIds.length > 0) {
    await supabase.from("part_name_specifications").insert(参数.linkedSpecIds.map((sid) => ({ part_name_id: inserted.id, specification_id: sid })));
  }

  revalidatePath("/part-names");
  return { success: true, id: inserted.id };
}

/* ─── 更新配件名称（含品牌/规格关联差量同步，服务端一次完成） ─── */
export async function 更新配件名称(参数: {
  id: string;
  form: 配件名称表单;
  linkedBrandIds: string[];
  linkedSpecIds: string[];
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!参数.form.name.trim() || !参数.form.category_id) {
    return { success: false, error: "请填写配件名称和所属分类" };
  }

  const supabase = await createClient();

  /* 重名检查（排除自己） */
  const trimmedName = 参数.form.name.trim();
  const { data: existed } = await supabase
    .from("part_names")
    .select("id")
    .eq("name", trimmedName)
    .neq("id", 参数.id)
    .limit(1);
  if (existed && existed.length > 0) {
    return { success: false, error: `配件名称"${trimmedName}"已存在，请使用其他名称` };
  }

  const { error } = await supabase.from("part_names").update(表单转写库(参数.form)).eq("id", 参数.id);
  if (error) {
    return { success: false, error: error.message };
  }

  /* 品牌关联差量同步（服务端读最新再 diff） */
  const { data: existingBrands } = await supabase.from("part_name_brands").select("brand_id").eq("part_name_id", 参数.id);
  const existingBrandIds = new Set(((existingBrands || []) as { brand_id: string }[]).map((b) => b.brand_id));
  const newBrandIds = new Set(参数.linkedBrandIds);
  const brandsToDelete = [...existingBrandIds].filter((bid) => !newBrandIds.has(bid));
  const brandsToInsert = [...newBrandIds].filter((bid) => !existingBrandIds.has(bid));
  if (brandsToDelete.length > 0) {
    await supabase.from("part_name_brands").delete().eq("part_name_id", 参数.id).in("brand_id", brandsToDelete);
  }
  if (brandsToInsert.length > 0) {
    await supabase.from("part_name_brands").insert(brandsToInsert.map((bid) => ({ part_name_id: 参数.id, brand_id: bid })));
  }

  /* 规格关联差量同步 */
  const { data: existingSpecs } = await supabase.from("part_name_specifications").select("specification_id").eq("part_name_id", 参数.id);
  const existingSpecIds = new Set(((existingSpecs || []) as { specification_id: string }[]).map((s) => s.specification_id));
  const newSpecIds = new Set(参数.linkedSpecIds);
  const specsToDelete = [...existingSpecIds].filter((sid) => !newSpecIds.has(sid));
  const specsToInsert = [...newSpecIds].filter((sid) => !existingSpecIds.has(sid));
  if (specsToDelete.length > 0) {
    await supabase.from("part_name_specifications").delete().eq("part_name_id", 参数.id).in("specification_id", specsToDelete);
  }
  if (specsToInsert.length > 0) {
    await supabase.from("part_name_specifications").insert(specsToInsert.map((sid) => ({ part_name_id: 参数.id, specification_id: sid })));
  }

  revalidatePath("/part-names");
  return { success: true };
}

/* ─── Excel 批量导入配件名称（分批插入在服务端做） ─── */
export async function 批量导入配件名称(参数: {
  rows: { name: string; category_id?: string | null; unit?: string }[];
}): Promise<{ success: boolean; inserted?: number; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!参数.rows || 参数.rows.length === 0) {
    return { success: false, error: "没有可导入的数据" };
  }

  const supabase = await createClient();
  const batchSize = 100;
  let inserted = 0;
  for (let i = 0; i < 参数.rows.length; i += batchSize) {
    const batch = 参数.rows.slice(i, i + batchSize);
    const { error } = await supabase.from("part_names").insert(batch);
    if (error) {
      return { success: false, error: `第 ${Math.floor(i / batchSize) + 1} 批导入失败: ${error.message}（已导入 ${inserted} 条）` };
    }
    inserted += batch.length;
  }

  revalidatePath("/part-names");
  return { success: true, inserted };
}

/* ═══ 合并配件名称（6 张表迁移，走原子事务 RPC merge_part_names） ═══
 * 品牌/规格关联去重合并 + 4 张引用表换主 + 删除源名称，一个事务要么全成要么全败。 */
export async function 合并配件名称(参数: {
  targetId: string;
  sourceIds: string[];
  finalName?: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("merge_part_names", {
    p_target_id: 参数.targetId,
    p_source_ids: 参数.sourceIds,
    p_final_name: 参数.finalName || null,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as { success: boolean; error?: string };
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "合并失败" };
  }

  revalidatePath("/part-names");
  return { success: true };
}

/* ═══ 批量关联品牌/规格到配件名称（BatchLinkDialog，逐条 upsert 收服务端） ═══ */
export async function 批量关联配件名称(参数: {
  partNameIds: string[];
  linkTable: "part_name_brands" | "part_name_specifications";
  targetId: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (参数.partNameIds.length === 0) {
    return { success: false, error: "请先选择配件名称" };
  }

  const idColumn = 参数.linkTable === "part_name_brands" ? "brand_id" : "specification_id";
  const supabase = await createClient();
  for (const partNameId of 参数.partNameIds) {
    const { error } = await supabase
      .from(参数.linkTable)
      .upsert({ part_name_id: partNameId, [idColumn]: 参数.targetId });
    if (error) {
      return { success: false, error: error.message };
    }
  }

  revalidatePath("/part-names");
  return { success: true };
}

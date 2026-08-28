"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 配件分类删除 Server Action ═══
 * 删除操作从客户端直写收口到服务端，删除前检查关联数据防止误删。 */
export async function 删除配件分类(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();

  /* 删除前检查：分类下是否还有配件名称、库存配件，或已被供应商引用 */
  const checks = await Promise.all([
    supabase.from("part_names").select("id", { count: "exact", head: true }).eq("category_id", id),
    supabase.from("parts").select("id", { count: "exact", head: true }).eq("category_id", id),
    supabase.from("supplier_part_categories").select("id", { count: "exact", head: true }).eq("part_category_id", id),
  ]);

  const used = checks.some((c) => (c.count ?? 0) > 0);
  if (used) {
    return { success: false, error: "该分类下已有配件名称、库存配件或已被供应商引用，不允许删除" };
  }

  const { error } = await supabase.from("part_categories").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/part-categories");
  return { success: true };
}

/* ═══ 配件分类表单（新建/编辑共用，数值前端字符串、服务端转 number） ═══ */
interface 配件分类表单 {
  name: string;
  auto_link_vehicle_model: boolean;
  is_consumable: boolean;
  /* 新建页（/part-categories/new）没有这三个开关，不传则用 false 默认 */
  auto_match_17vin_models?: boolean;
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

/* 把前端字符串表单转成数据库字段（空字符串 → null） */
function 组装分类字段(form: 配件分类表单) {
  return {
    name: form.name.trim(),
    auto_link_vehicle_model: form.auto_link_vehicle_model,
    auto_match_17vin_models: form.auto_match_17vin_models ?? false,
    is_consumable: form.is_consumable,
    require_scan_check: form.require_scan_check ?? false,
    require_location_check: form.require_location_check ?? false,
    sales_commission_type: form.sales_type || null,
    sales_commission_value: form.sales_value ? parseFloat(form.sales_value) : null,
    diagnosis_commission_type: form.diagnosis_type || null,
    diagnosis_commission_value: form.diagnosis_value ? parseFloat(form.diagnosis_value) : null,
    repair_commission_type: form.repair_type || null,
    repair_commission_value: form.repair_value ? parseFloat(form.repair_value) : null,
    qc_commission_type: form.qc_type || null,
    qc_commission_value: form.qc_value ? parseFloat(form.qc_value) : null,
    picking_commission_type: form.picking_type || null,
    picking_commission_value: form.picking_value ? parseFloat(form.picking_value) : null,
  };
}

/* ═══ 新建配件分类 Server Action ═══
 * sort_order 在服务端取当前最大值 + 1，不用客户端列表里的旧值。 */
export async function 新建配件分类(form: 配件分类表单): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  if (!form.name.trim()) {
    return { success: false, error: "请输入分类名称" };
  }

  const supabase = await createClient();

  /* 服务端取最大排序号（列表页内联表单需要排在最后；独立新建页原本不传 sort_order，
     依赖数据库默认值，这里统一取最大值+1，排在最后，行为等价或更直观） */
  const { data: maxRow } = await supabase
    .from("part_categories")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = ((maxRow as { sort_order: number | null } | null)?.sort_order ?? 0) + 1;

  const { error } = await supabase.from("part_categories").insert({
    ...组装分类字段(form),
    sort_order: nextSort,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/part-categories");
  return { success: true };
}

/* ═══ 更新配件分类 Server Action（编辑页保存） ═══ */
export async function 更新配件分类(id: string, form: 配件分类表单): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("part_categories")
    .update(组装分类字段(form))
    .eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/part-categories");
  return { success: true };
}

/* ═══ 保存配件分类排序 Server Action（列表页拖拽排序批量更新） ═══ */
export async function 保存配件分类排序(
  列表: { id: string; sort_order: number }[]
): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const results = await Promise.all(
    列表.map((item) =>
      supabase.from("part_categories").update({ sort_order: item.sort_order }).eq("id", item.id)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    return { success: false, error: failed.error.message };
  }

  revalidatePath("/part-categories");
  return { success: true };
}

/* ═══ 同步分类属性到配件 Server Action ═══
 * 编辑页"同步到配件"：把分类的属性和提成规则覆盖到所有使用该分类的
 * 配件名称（part_names）和库存配件（parts）。 */
export async function 同步分类属性到配件(
  id: string,
  form: 配件分类表单
): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  /* 同步内容 = 分类字段去掉名称和排序 */
  const { name: _忽略名称, ...updateData } = 组装分类字段(form);

  const supabase = await createClient();

  const { error: nameError } = await supabase.from("part_names").update(updateData).eq("category_id", id);
  if (nameError) {
    return { success: false, error: "同步配件名称失败: " + nameError.message };
  }

  const { error: partError } = await supabase.from("parts").update(updateData).eq("category_id", id);
  if (partError) {
    return { success: false, error: "同步配件失败: " + partError.message };
  }

  revalidatePath("/part-categories");
  return { success: true };
}

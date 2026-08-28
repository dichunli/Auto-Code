"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 维修项目名称删除 Server Action ═══
 * 删除操作从客户端直写收口到服务端，避免客户端 session 异常导致 401 / 被 RLS 拦截。 */
export async function 删除维修项目名称(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("service_names").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/service-names");
  return { success: true };
}

/* ═══ 维修项目名称库 写操作收编 ═══ */

export interface 项目名称表单 {
  category_id: string;
  name: string;
  search_keywords: string;
  sales_type: string;
  sales_value: string;
  diagnosis_type: string;
  diagnosis_value: string;
  repair_type: string;
  repair_value: string;
  qc_type: string;
  qc_value: string;
}

function 名称表单转写库(表单: 项目名称表单) {
  return {
    category_id: 表单.category_id,
    name: 表单.name.trim(),
    search_keywords: 表单.search_keywords || null,
    sales_commission_type: 表单.sales_type || null,
    sales_commission_value: 表单.sales_value ? parseFloat(表单.sales_value) : null,
    diagnosis_commission_type: 表单.diagnosis_type || null,
    diagnosis_commission_value: 表单.diagnosis_value ? parseFloat(表单.diagnosis_value) : null,
    repair_commission_type: 表单.repair_type || null,
    repair_commission_value: 表单.repair_value ? parseFloat(表单.repair_value) : null,
    qc_commission_type: 表单.qc_type || null,
    qc_commission_value: 表单.qc_value ? parseFloat(表单.qc_value) : null,
  };
}

/* ─── 新建项目名称（含关联配件，服务端一次完成） ─── */
export async function 新建维修项目名称(参数: {
  form: 项目名称表单;
  linkedParts: { id: string; quantity: number | null }[];
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!参数.form.name.trim() || !参数.form.category_id) {
    return { success: false, error: "请填写项目名称和所属分类" };
  }

  const supabase = await createClient();

  /* 重名检查（服务端兜底） */
  const { data: dup } = await supabase
    .from("service_names")
    .select("id")
    .eq("name", 参数.form.name.trim())
    .maybeSingle();
  if (dup) {
    return { success: false, error: "该项目名称已存在，请更换" };
  }

  const { data: inserted, error } = await supabase
    .from("service_names")
    .insert(名称表单转写库(参数.form))
    .select("id")
    .single();
  if (error || !inserted) {
    return { success: false, error: error?.message || "保存失败" };
  }

  if (参数.linkedParts.length > 0) {
    const { error: linkError } = await supabase.from("service_name_part_names").insert(
      参数.linkedParts.map((p, idx) => ({ service_name_id: inserted.id, part_name_id: p.id, sort_order: idx, quantity: p.quantity }))
    );
    if (linkError) {
      return { success: false, error: "保存配件关联失败: " + linkError.message };
    }
  }

  revalidatePath("/service-names");
  return { success: true, id: inserted.id };
}

/* ─── 更新项目名称（改名 + 配件关联全量替换，服务端一次完成） ─── */
export async function 更新维修项目名称(参数: {
  id: string;
  form: 项目名称表单;
  linkedParts: { id: string; quantity: number | null }[];
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!参数.form.name.trim() || !参数.form.category_id) {
    return { success: false, error: "请填写项目名称和所属分类" };
  }

  const supabase = await createClient();

  const { error } = await supabase.from("service_names").update(名称表单转写库(参数.form)).eq("id", 参数.id);
  if (error) {
    return { success: false, error: error.message };
  }

  /* 配件关联全量替换（与原逻辑一致：先删后插） */
  const { error: delError } = await supabase.from("service_name_part_names").delete().eq("service_name_id", 参数.id);
  if (delError) {
    return { success: false, error: "删除旧配件关联失败: " + delError.message };
  }
  if (参数.linkedParts.length > 0) {
    const { error: insertError } = await supabase.from("service_name_part_names").insert(
      参数.linkedParts.map((p, idx) => ({ service_name_id: 参数.id, part_name_id: p.id, sort_order: idx, quantity: p.quantity }))
    );
    if (insertError) {
      return { success: false, error: "保存配件关联失败: " + insertError.message };
    }
  }

  revalidatePath("/service-names");
  return { success: true };
}

/* ─── 同步提成配置到关联维修项目（编辑页"同步到维修项目"按钮） ─── */
export async function 同步提成到维修项目(参数: {
  id: string;
  form: 项目名称表单;
}): Promise<{ success: boolean; count?: number; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data: items, error: fetchError } = await supabase
    .from("service_items")
    .select("id")
    .eq("service_name_id", 参数.id);
  if (fetchError) {
    return { success: false, error: "查询关联维修项目失败: " + fetchError.message };
  }
  if (!items || items.length === 0) {
    return { success: false, error: "当前名称库没有关联任何维修项目，无需同步" };
  }

  const 提成字段 = {
    sales_commission_type: 参数.form.sales_type || null,
    sales_commission_value: 参数.form.sales_value ? parseFloat(参数.form.sales_value) : null,
    diagnosis_commission_type: 参数.form.diagnosis_type || null,
    diagnosis_commission_value: 参数.form.diagnosis_value ? parseFloat(参数.form.diagnosis_value) : null,
    repair_commission_type: 参数.form.repair_type || null,
    repair_commission_value: 参数.form.repair_value ? parseFloat(参数.form.repair_value) : null,
    qc_commission_type: 参数.form.qc_type || null,
    qc_commission_value: 参数.form.qc_value ? parseFloat(参数.form.qc_value) : null,
  };
  const { error: updateError } = await supabase
    .from("service_items")
    .update(提成字段)
    .eq("service_name_id", 参数.id);
  if (updateError) {
    return { success: false, error: "同步失败: " + updateError.message };
  }

  return { success: true, count: items.length };
}

/* ─── Excel 批量导入项目名称（分批插入在服务端做） ─── */
export async function 批量导入维修项目名称(参数: {
  rows: Record<string, unknown>[];
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
    const { error } = await supabase.from("service_names").insert(batch as never[]);
    if (error) {
      return { success: false, error: `第 ${Math.floor(i / batchSize) + 1} 批导入失败: ${error.message}（已导入 ${inserted} 条）` };
    }
    inserted += batch.length;
  }

  revalidatePath("/service-names");
  return { success: true, inserted };
}

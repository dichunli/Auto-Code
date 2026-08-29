"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 服务分类删除 Server Action ═══
 * 删除操作从客户端直写收口到服务端，删除前检查关联数据防止误删。 */
export async function 删除服务分类(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();

  /* 删除前检查：分类下是否还有维修项目 */
  const { count: itemCount } = await supabase
    .from("service_items")
    .select("id", { count: "exact", head: true })
    .eq("category_id", id);
  if (itemCount && itemCount > 0) {
    return { success: false, error: "该分类下还有维修项目，不允许删除" };
  }

  const { error } = await supabase.from("service_categories").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/service-categories");
  return { success: true };
}

/* ═══ 分类提成表单（新建/编辑共用，数值前端字符串、服务端转 number） ═══ */
interface 分类提成表单 {
  name: string;
  sales_type: string;
  sales_value: string;
  diagnosis_type: string;
  diagnosis_value: string;
  repair_type: string;
  repair_value: string;
  qc_type: string;
  qc_value: string;
  /* 派单/领单提成只有列表页表单有，新建页不传则为 null */
  dispatch_type?: string;
  dispatch_value?: string;
  claim_type?: string;
  claim_value?: string;
}

/* 把前端字符串表单转成数据库字段（空字符串 → null） */
function 组装提成字段(form: 分类提成表单) {
  return {
    name: form.name.trim(),
    sales_commission_type: form.sales_type || null,
    sales_commission_value: form.sales_value ? parseFloat(form.sales_value) : null,
    diagnosis_commission_type: form.diagnosis_type || null,
    diagnosis_commission_value: form.diagnosis_value ? parseFloat(form.diagnosis_value) : null,
    repair_commission_type: form.repair_type || null,
    repair_commission_value: form.repair_value ? parseFloat(form.repair_value) : null,
    qc_commission_type: form.qc_type || null,
    qc_commission_value: form.qc_value ? parseFloat(form.qc_value) : null,
    dispatch_commission_type: form.dispatch_type || null,
    dispatch_commission_value: form.dispatch_value ? parseFloat(form.dispatch_value) : null,
    claim_commission_type: form.claim_type || null,
    claim_commission_value: form.claim_value ? parseFloat(form.claim_value) : null,
  };
}

/* ═══ 新建服务分类 Server Action ═══
 * 查重 + 插入收口到服务端，避免客户端 session 异常导致 401 / 被 RLS 拦截。 */
export async function 新建服务分类(form: 分类提成表单): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const name = form.name.trim();
  if (!name) {
    return { success: false, error: "请填写分类名称" };
  }

  const supabase = await createClient();

  /* 服务端查重（不区分大小写） */
  const { data: dup } = await supabase
    .from("service_categories")
    .select("id")
    .ilike("name", name)
    .maybeSingle();
  if (dup) {
    return { success: false, error: "该分类名称已存在，请更换" };
  }

  const { error } = await supabase.from("service_categories").insert(组装提成字段(form));
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/service-categories");
  return { success: true };
}

/* ═══ 更新服务分类 Server Action（编辑页保存） ═══ */
export async function 更新服务分类(id: string, form: 分类提成表单): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("service_categories")
    .update(组装提成字段(form))
    .eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/service-categories");
  return { success: true };
}

/* ═══ 保存服务分类排序 Server Action（列表页拖拽排序批量更新） ═══ */
export async function 保存服务分类排序(
  列表: { id: string; sort_order: number }[]
): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const results = await Promise.all(
    列表.map((item) =>
      supabase.from("service_categories").update({ sort_order: item.sort_order }).eq("id", item.id)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    return { success: false, error: failed.error.message };
  }

  revalidatePath("/service-categories");
  return { success: true };
}

/* ═══ 同步分类提成到项目 Server Action ═══
 * 编辑页"同步到项目"：把分类的 4 种提成规则覆盖到所有使用该分类的
 * 项目名称（service_names）和项目实例（service_items）。 */
export async function 同步分类提成到项目(
  id: string,
  form: 分类提成表单
): Promise<{ success: boolean; nameCount?: number; itemCount?: number; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  /* service_names 和 service_items 表目前只有这4种提成字段 */
  const commissionData = {
    sales_commission_type: form.sales_type || null,
    sales_commission_value: form.sales_value ? parseFloat(form.sales_value) : null,
    diagnosis_commission_type: form.diagnosis_type || null,
    diagnosis_commission_value: form.diagnosis_value ? parseFloat(form.diagnosis_value) : null,
    repair_commission_type: form.repair_type || null,
    repair_commission_value: form.repair_value ? parseFloat(form.repair_value) : null,
    qc_commission_type: form.qc_type || null,
    qc_commission_value: form.qc_value ? parseFloat(form.qc_value) : null,
  };

  const supabase = await createClient();

  const { data: nameData, error: nameError } = await supabase
    .from("service_names")
    .update(commissionData)
    .eq("category_id", id)
    .select("id");
  if (nameError) {
    return { success: false, error: "同步项目名称失败: " + nameError.message };
  }

  const { data: itemData, error: itemError } = await supabase
    .from("service_items")
    .update(commissionData)
    .eq("category_id", id)
    .select("id");
  if (itemError) {
    return { success: false, error: "同步项目实例失败: " + itemError.message };
  }

  revalidatePath("/service-categories");
  return {
    success: true,
    nameCount: nameData?.length ?? 0,
    itemCount: itemData?.length ?? 0,
  };
}

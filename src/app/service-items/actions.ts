"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 维修项目 Server Action ═══ */

export interface 维修项目表单 {
  category_id: string;
  name: string;
  search_keywords: string;
  description: string;
  default_price: string;
  vip_price: string;
  customer_parts_price: string;
  company_price: string;
  sales_type: string;
  sales_value: string;
  diagnosis_type: string;
  diagnosis_value: string;
  repair_type: string;
  repair_value: string;
  qc_type: string;
  qc_value: string;
  require_qc: boolean;
}

export interface 车型定价行 {
  vehicle_model_id: number;
  price: number | null;
  vip_price: number | null;
  customer_parts_price: number | null;
  company_price: number | null;
  group_key: string | null;
}

export interface 指定用户价格行 {
  company_id: string | null;
  customer_id: string | null;
  vehicle_id: string | null;
  price: number | null;
}

export interface 关联配件行 {
  id: string;
  quantity: number | null;
}

function 项目表单转写库(表单: 维修项目表单) {
  return {
    category_id: 表单.category_id,
    name: 表单.name.trim(),
    search_keywords: 表单.search_keywords.trim() || null,
    description: 表单.description || null,
    default_price: 表单.default_price ? parseFloat(表单.default_price) : null,
    vip_price: 表单.vip_price ? parseFloat(表单.vip_price) : null,
    customer_parts_price: 表单.customer_parts_price ? parseFloat(表单.customer_parts_price) : null,
    company_price: 表单.company_price ? parseFloat(表单.company_price) : null,
    sales_commission_type: 表单.sales_type || null,
    sales_commission_value: 表单.sales_value ? parseFloat(表单.sales_value) : null,
    diagnosis_commission_type: 表单.diagnosis_type || null,
    diagnosis_commission_value: 表单.diagnosis_value ? parseFloat(表单.diagnosis_value) : null,
    repair_commission_type: 表单.repair_type || null,
    repair_commission_value: 表单.repair_value ? parseFloat(表单.repair_value) : null,
    qc_commission_type: 表单.qc_type || null,
    qc_commission_value: 表单.qc_value ? parseFloat(表单.qc_value) : null,
    require_qc: 表单.require_qc,
  };
}

type 服务端客户端 = Awaited<ReturnType<typeof createClient>>;

/* 子表全量替换：车型定价 + 指定用户价格 + 关联配件 */
async function 替换子表(
  supabase: 服务端客户端,
  itemId: string,
  vehiclePrices: 车型定价行[],
  specialPrices: 指定用户价格行[],
  linkedParts: 关联配件行[],
  先删: boolean
): Promise<string | null> {
  if (先删) {
    const { error: e1 } = await supabase.from("service_item_prices").delete().eq("service_item_id", itemId);
    if (e1) return "删除旧车型定价失败: " + e1.message;
    const { error: e2 } = await supabase.from("service_item_special_prices").delete().eq("service_item_id", itemId);
    if (e2) return "删除旧指定用户价格失败: " + e2.message;
    const { error: e3 } = await supabase.from("service_item_part_names").delete().eq("service_item_id", itemId);
    if (e3) return "删除旧配件关联失败: " + e3.message;
  }

  if (vehiclePrices.length > 0) {
    const insertData = vehiclePrices.map((p) => ({
      service_item_id: itemId,
      vehicle_model_id: p.vehicle_model_id,
      price: p.price,
      vip_price: p.vip_price,
      customer_parts_price: p.customer_parts_price,
      company_price: p.company_price,
      group_key: p.group_key || null,
    }));
    const batchSize = 500;
    for (let i = 0; i < insertData.length; i += batchSize) {
      const { error } = await supabase.from("service_item_prices").insert(insertData.slice(i, i + batchSize));
      if (error) return `车型定价保存失败（第${i + 1}条起）: ` + error.message;
    }
  }

  if (specialPrices.length > 0) {
    const { error } = await supabase.from("service_item_special_prices").insert(
      specialPrices.map((p) => ({
        service_item_id: itemId,
        company_id: p.company_id || null,
        customer_id: p.customer_id || null,
        vehicle_id: p.vehicle_id || null,
        price: p.price,
      }))
    );
    if (error) return "指定用户价格保存失败: " + error.message;
  }

  if (linkedParts.length > 0) {
    const { error } = await supabase.from("service_item_part_names").insert(
      linkedParts.map((p, idx) => ({
        service_item_id: itemId,
        part_name_id: p.id,
        sort_order: idx,
        quantity: p.quantity,
      }))
    );
    if (error) return "关联配件保存失败: " + error.message;
  }

  return null;
}

/* ─── 新建维修项目（编码服务端生成，子表随主表一次写完） ─── */
export async function 新建维修项目(参数: {
  form: 维修项目表单;
  vehiclePrices: 车型定价行[];
  specialPrices: 指定用户价格行[];
  linkedParts: 关联配件行[];
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!参数.form.name.trim() || !参数.form.category_id) {
    return { success: false, error: "请填写项目名称和所属分类" };
  }

  const supabase = await createClient();
  const autoCode = `XM-${Date.now().toString(36).toUpperCase().slice(-6)}-${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;

  const { data: inserted, error } = await supabase
    .from("service_items")
    .insert({ code: autoCode, ...项目表单转写库(参数.form) })
    .select("id")
    .single();
  if (error || !inserted) {
    return { success: false, error: error?.message || "保存失败" };
  }

  const 子表错误 = await 替换子表(supabase, inserted.id, 参数.vehiclePrices, 参数.specialPrices, 参数.linkedParts, false);
  if (子表错误) {
    return { success: false, error: 子表错误 };
  }

  revalidatePath("/service-items");
  return { success: true, id: inserted.id };
}

/* ─── 更新维修项目（主表 + 子表全量替换，服务端一次完成） ─── */
export async function 更新维修项目(参数: {
  id: string;
  form: 维修项目表单;
  vehiclePrices: 车型定价行[];
  specialPrices: 指定用户价格行[];
  linkedParts: 关联配件行[];
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!参数.form.name.trim() || !参数.form.category_id) {
    return { success: false, error: "请填写项目名称和所属分类" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("service_items").update(项目表单转写库(参数.form)).eq("id", 参数.id);
  if (error) {
    return { success: false, error: error.message };
  }

  const 子表错误 = await 替换子表(supabase, 参数.id, 参数.vehiclePrices, 参数.specialPrices, 参数.linkedParts, true);
  if (子表错误) {
    return { success: false, error: 子表错误 };
  }

  revalidatePath("/service-items");
  return { success: true };
}

/* ─── 单独保存车型定价（编辑页"添加车型定价"入口，删旧插新） ─── */
export async function 保存车型定价(参数: {
  serviceItemId: string;
  vehiclePrices: 车型定价行[];
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error: delError } = await supabase.from("service_item_prices").delete().eq("service_item_id", 参数.serviceItemId);
  if (delError) {
    return { success: false, error: delError.message };
  }
  if (参数.vehiclePrices.length > 0) {
    const { error } = await supabase.from("service_item_prices").insert(
      参数.vehiclePrices.map((p) => ({
        service_item_id: 参数.serviceItemId,
        vehicle_model_id: p.vehicle_model_id,
        price: p.price,
        vip_price: p.vip_price,
        customer_parts_price: p.customer_parts_price,
        company_price: p.company_price,
        group_key: p.group_key || null,
      }))
    );
    if (error) {
      return { success: false, error: error.message };
    }
  }

  return { success: true };
}

/* ─── 批量修改维修项目（列表页批量操作） ─── */
export async function 批量更新维修项目(参数: {
  ids: string[];
  updates: {
    category_id?: string;
    is_active?: boolean;
    standard_hours?: number | null;
    default_price?: number | null;
    vip_price?: number | null;
    customer_parts_price?: number | null;
    company_price?: number | null;
  };
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (参数.ids.length === 0 || Object.keys(参数.updates).length === 0) {
    return { success: true };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("service_items").update(参数.updates).in("id", 参数.ids);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/service-items");
  return { success: true };
}

/* ─── Excel 批量导入维修项目（分批插入在服务端做） ─── */
export async function 批量导入维修项目(参数: {
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
  const batchSize = 500;
  let inserted = 0;
  for (let i = 0; i < 参数.rows.length; i += batchSize) {
    const batch = 参数.rows.slice(i, i + batchSize);
    const { error } = await supabase.from("service_items").insert(batch as never[]);
    if (error) {
      return { success: false, error: `第 ${Math.floor(i / batchSize) + 1} 批导入失败: ${error.message}（已导入 ${inserted} 条）` };
    }
    inserted += batch.length;
  }

  revalidatePath("/service-items");
  return { success: true, inserted };
}

/* ═══ 合并维修项目（多表迁移，走原子事务 RPC merge_service_items） ═══
 * 原来是客户端逐表循环写（4 张价格表 + 4 张引用表 + 主表），
 * 中途失败留半成品；收编后一个事务要么全成要么全败。 */
export async function 合并维修项目(参数: {
  targetId: string;
  sourceIds: string[];
  name: string;
  strategy: "keep_target" | "override";
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("merge_service_items", {
    p_target_id: 参数.targetId,
    p_source_ids: 参数.sourceIds,
    p_name: 参数.name,
    p_strategy: 参数.strategy,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as { success: boolean; error?: string };
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "合并失败" };
  }

  revalidatePath("/service-items");
  return { success: true };
}

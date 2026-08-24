"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 供应商档案 Server Action ═══
 * 主表 + 5 张关联表(联系人/分类/件名/品牌/车型)由数据库函数
 * save_supplier_full 一个事务完成,任一失败整体回滚,
 * 杜绝"主表存了但关联数据被清空"的半成品状态。
 */

interface 保存结果 {
  success: boolean;
  supplier_id?: string;
  error?: string;
}

export interface 供应商联系人输入 {
  name: string;
  phone: string;
  title: string;
  is_primary: boolean;
  notes: string;
}

export interface 供应商档案输入 {
  id?: string | null;
  name: string;
  contact: string;
  phone: string;
  address: string;
  notes: string;
  region: string;
  wechat_id: string;
  wechat_group_qr: string | null;
  wrong_shipment_count: string;
  quality_return_count: string;
  recommendation_level: string;
}

/* ─── 保存供应商档案(新建或编辑):主表+关联表一个事务 ─── */
export async function 保存供应商档案(
  档案: 供应商档案输入,
  联系人: 供应商联系人输入[],
  分类ids: string[],
  件名ids: string[],
  品牌ids: string[],
  车型ids: number[]
): Promise<保存结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!档案.name || !档案.name.trim()) {
    return { success: false, error: "请输入供应商名称" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_supplier_full", {
    p_supplier: {
      id: 档案.id || null,
      name: 档案.name,
      contact: 档案.contact,
      phone: 档案.phone,
      address: 档案.address,
      notes: 档案.notes,
      region: 档案.region,
      wechat_id: 档案.wechat_id,
      wechat_group_qr: 档案.wechat_group_qr,
      wrong_shipment_count: parseInt(档案.wrong_shipment_count) || 0,
      quality_return_count: parseInt(档案.quality_return_count) || 0,
      recommendation_level: parseInt(档案.recommendation_level) || 0,
    },
    p_contacts: 联系人.filter((c) => c.name.trim()),
    p_category_ids: 分类ids,
    p_part_name_ids: 件名ids,
    p_brand_ids: 品牌ids,
    p_vehicle_model_ids: 车型ids,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as 保存结果;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "保存失败" };
  }

  revalidatePath("/suppliers");
  return { success: true, supplier_id: 结果.supplier_id };
}

/* ─── 更新供应商电话(2026-08-16 RLS 收紧收编):物流页"补充电话"小入口 ───
 * suppliers 表写已收紧到 admin/boss/warehouse,物流页操作者可能是其他角色,
 * 此 action 服务端校验登录后写入;仅限电话字段,避免成为供应商信息通用后门。 */
export async function 更新供应商电话(
  供应商id: string,
  电话: string
): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!供应商id) {
    return { success: false, error: "供应商选择无效" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("suppliers")
    .update({ phone: 电话.trim() || null })
    .eq("id", 供应商id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/suppliers");
  return { success: true };
}

/* ─── 删除供应商 ───
 * 删除操作从客户端直写收口到服务端，删除前服务端重新检查配件关联，防止误删。 */
export async function 删除供应商(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();

  /* 服务端重新检查：该供应商下是否还有关联配件 */
  const { count: partCount } = await supabase
    .from("parts")
    .select("id", { count: "exact", head: true })
    .eq("supplier_id", id);
  if (partCount && partCount > 0) {
    return { success: false, error: "该供应商有关联的配件信息，无法删除" };
  }

  const { error } = await supabase.from("suppliers").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/suppliers");
  return { success: true };
}

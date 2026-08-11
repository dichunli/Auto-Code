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

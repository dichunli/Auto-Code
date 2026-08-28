"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";

/* ═══ 创建供应商退货记录（退货给供应商弹窗提交） ═══
 * 原来在 SupplierReturnModal 客户端直写，收口到服务端避免 session 异常导致 401/RLS 拦截。 */
export async function 创建供应商退货记录(参数: {
  workOrderItemPartId: string;
  returnReason: string;
  quantity: number;
  supplierName: string | null;
  logisticsCompany: string | null;
  trackingNo: string | null;
  photos: string[];
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("supplier_return_records").insert({
    work_order_item_part_id: 参数.workOrderItemPartId,
    return_reason: 参数.returnReason,
    quantity: 参数.quantity,
    supplier_name: 参数.supplierName,
    logistics_company: 参数.logisticsCompany,
    tracking_no: 参数.trackingNo,
    photos: 参数.photos,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 采退单 Server Action ═══ */

/* ─── 退货运费记入物流应付（2026-09-15 批次5）
 * 场景：退货的运费由店里承担（payer=self），这笔钱付给物流公司。
 * 默认不自动记，用户在采退单详情手动点，防误入账。 */
export async function 记录退货运费入应付(
  采退单id: string
): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!采退单id) {
    return { success: false, error: "缺少采退单信息" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_return_freight_payable", {
    p_return_order_id: 采退单id,
  });
  if (error) {
    return { success: false, error: error.message };
  }
  const 结果 = data as unknown as { success: boolean; error?: string };
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "入账失败" };
  }

  revalidatePath("/return-orders");
  return { success: true };
}

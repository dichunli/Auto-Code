"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 供应商付款单 Server Action（2026-09-14 供应商款项改造批次1） ═══
 * 写操作全部落到 RPC 事务（create_supplier_payment / void_supplier_payment），
 * 角色门禁（admin/boss/warehouse）在 RPC 内校验，这里只做登录验证和参数清洗。 */

interface 核销明细入参 {
  transaction_id: string;
  amount: number;
}

interface RPC结果 {
  success: boolean;
  error?: string;
  payment_id?: string;
  payment_no?: string;
}

/* ─── 创建付款单（含核销明细；2026-09-16 批次6 支持优惠金额） ─── */
export async function 创建供应商付款单(参数: {
  supplier_id: string;
  amount: number;
  discount_amount?: number;
  payment_method?: string;
  paid_at?: string;
  note?: string;
  allocations: 核销明细入参[];
}): Promise<{ success: boolean; payment_no?: string; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  if (!参数.supplier_id) {
    return { success: false, error: "请选择供应商" };
  }
  const 优惠 = 参数.discount_amount || 0;
  if (!Number.isFinite(参数.amount) || 参数.amount < 0) {
    return { success: false, error: "付款金额不能为负" };
  }
  if (!Number.isFinite(优惠) || 优惠 < 0) {
    return { success: false, error: "优惠金额不能为负" };
  }
  if (参数.amount + 优惠 <= 0) {
    return { success: false, error: "付款金额和优惠金额至少一项要大于 0" };
  }

  /* 核销明细清洗：过滤非法行，金额保留 2 位小数（RPC 内还会全量复核） */
  const 明细 = (参数.allocations || [])
    .filter((a) => a && a.transaction_id && Number.isFinite(a.amount) && a.amount > 0)
    .map((a) => ({
      transaction_id: a.transaction_id,
      amount: Math.round(a.amount * 100) / 100,
    }));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_supplier_payment", {
    p_supplier_id: 参数.supplier_id,
    p_amount: Math.round(参数.amount * 100) / 100,
    p_payment_method: 参数.payment_method?.trim() || null,
    p_paid_at: 参数.paid_at || null,
    p_note: 参数.note?.trim() || null,
    p_allocations: 明细,
    p_discount_amount: Math.round(优惠 * 100) / 100,
  });

  if (error) {
    return { success: false, error: error.message };
  }
  const 结果 = data as RPC结果 | null;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "创建付款单失败" };
  }

  revalidatePath("/supplier-payments");
  revalidatePath("/supplier-transactions");
  return { success: true, payment_no: 结果.payment_no };
}

/* ─── 作废付款单 ─── */
export async function 作废供应商付款单(
  paymentId: string
): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!paymentId) {
    return { success: false, error: "缺少付款单 id" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("void_supplier_payment", {
    p_payment_id: paymentId,
  });

  if (error) {
    return { success: false, error: error.message };
  }
  const 结果 = data as RPC结果 | null;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "作废失败" };
  }

  revalidatePath("/supplier-payments");
  revalidatePath("/supplier-transactions");
  return { success: true };
}

"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 客户收款单 Server Action（2026-09-16 往来账销账闭环） ═══
 * 写操作全部落到 RPC 事务（create_customer_receipt / void_customer_receipt），
 * 角色门禁（admin/boss/accountant）在 RPC 内校验，这里只做登录验证和参数清洗。 */

interface 核销明细入参 {
  receivable_id: string;
  amount: number;
}

interface RPC结果 {
  success: boolean;
  error?: string;
  receipt_id?: string;
  receipt_no?: string;
}

/* ─── 创建收款单（含核销明细；收多少销多少） ─── */
export async function 创建客户收款单(参数: {
  customer_id: string;
  amount: number;
  account_id: string;
  payment_method?: string;
  received_at?: string;
  note?: string;
  allocations: 核销明细入参[];
}): Promise<{ success: boolean; receipt_no?: string; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  if (!参数.customer_id) {
    return { success: false, error: "请选择客户" };
  }
  if (!Number.isFinite(参数.amount) || 参数.amount <= 0) {
    return { success: false, error: "收款金额必须大于 0" };
  }
  if (!参数.account_id) {
    return { success: false, error: "请选择收款账户" };
  }

  /* 核销明细清洗：过滤非法行，金额保留 2 位小数（RPC 内还会全量复核） */
  const 明细 = (参数.allocations || [])
    .filter((a) => a && a.receivable_id && Number.isFinite(a.amount) && a.amount > 0)
    .map((a) => ({
      receivable_id: a.receivable_id,
      amount: Math.round(a.amount * 100) / 100,
    }));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_customer_receipt", {
    p_customer_id: 参数.customer_id,
    p_amount: Math.round(参数.amount * 100) / 100,
    p_account_id: 参数.account_id,
    p_payment_method: 参数.payment_method?.trim() || null,
    p_received_at: 参数.received_at || null,
    p_note: 参数.note?.trim() || null,
    p_allocations: 明细,
  });

  if (error) {
    return { success: false, error: error.message };
  }
  const 结果 = data as RPC结果 | null;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "创建收款单失败" };
  }

  revalidatePath("/customer-receipts");
  revalidatePath("/finance/receivable");
  revalidatePath("/finance/transactions");
  return { success: true, receipt_no: 结果.receipt_no };
}

/* ─── 作废收款单 ─── */
export async function 作废客户收款单(
  receiptId: string
): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!receiptId) {
    return { success: false, error: "缺少收款单 id" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("void_customer_receipt", {
    p_receipt_id: receiptId,
  });

  if (error) {
    return { success: false, error: error.message };
  }
  const 结果 = data as RPC结果 | null;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "作废失败" };
  }

  revalidatePath("/customer-receipts");
  revalidatePath("/finance/receivable");
  revalidatePath("/finance/transactions");
  return { success: true };
}

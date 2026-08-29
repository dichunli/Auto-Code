"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 会员 Server Action ═══
 * 会员新建（含初始充值交易）、会员资料编辑从客户端直写收口到服务端，
 * 避免客户端 session 异常导致 401 / 被 RLS 拦截。
 * 页面上的只读查询（客户下拉、会员详情、交易记录）仍走客户端。 */

/* ─── 新建会员（有初始充值时同步写一条充值交易） ─── */
export async function 新建会员(参数: {
  cardNo: string;
  customerId: string;
  name: string;
  phone: string;
  initialBalance: string;
  discountRate: string;
  notes: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  if (!参数.cardNo.trim() || !参数.name.trim()) {
    return { success: false, error: "请填写卡号和姓名" };
  }

  const supabase = await createClient();
  const balance = parseFloat(参数.initialBalance) || 0;

  /* 创建会员 */
  const { data: member, error: memberErr } = await supabase
    .from("members")
    .insert({
      card_no: 参数.cardNo.trim(),
      customer_id: 参数.customerId || null,
      name: 参数.name.trim(),
      phone: 参数.phone.trim() || null,
      balance: balance,
      discount_rate: parseFloat(参数.discountRate) || 1,
      notes: 参数.notes.trim() || null,
    })
    .select("id")
    .single();
  if (memberErr || !member) {
    return { success: false, error: memberErr?.message || "创建会员失败" };
  }

  /* 如果有初始充值，创建交易记录 */
  if (balance > 0) {
    const { error: txErr } = await supabase.from("member_transactions").insert({
      member_id: member.id,
      type: "recharge",
      amount: balance,
      balance_after: balance,
      payment_method: "cash",
      notes: "开卡初始充值",
    });
    if (txErr) {
      return { success: false, error: "会员已创建，但初始充值记录写入失败: " + txErr.message };
    }
  }

  revalidatePath("/members");
  return { success: true, id: member.id };
}

/* ─── 更新会员资料（姓名/手机号/折扣率/状态/备注） ─── */
export async function 更新会员(参数: {
  id: string;
  name: string;
  phone: string;
  discountRate: string;
  status: string;
  notes: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  if (!参数.name.trim()) {
    return { success: false, error: "请填写姓名" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("members")
    .update({
      name: 参数.name.trim(),
      phone: 参数.phone.trim() || null,
      discount_rate: parseFloat(参数.discountRate) || 1,
      status: 参数.status,
      notes: 参数.notes.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 参数.id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/members");
  revalidatePath(`/members/${参数.id}`);
  return { success: true };
}

"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 物流运单 Server Action（2026-08-20 待收货改造一期③） ═══
 * 批量建运单 + 电话命中供应商后关联其待收货采购单。
 * 写操作统一走服务端，避免客户端 session 异常导致 401/RLS 拦截。
 */

interface 操作结果 {
  success: boolean;
  error?: string;
}

/* ─── 批量创建运单的每行输入 ─── */
export interface 运单行输入 {
  tracking_no: string;
  logistics_company_id: string | null;
  logistics_company_name: string | null;
  phone: string | null;
  package_count: number;
  freight_amount: number;
  cod_amount: number;
  photos: string[] | null;
}

/* ─── 创建结果：电话命中供应商时带回其未关联运单的待收货采购单数 ─── */
export interface 运单创建结果 {
  waybill_id: string;
  tracking_no: string;
  supplier_id: string | null;
  supplier_name: string | null;
  待关联单数: number;
}

/* 采购单"待收货"口径：与待收货页一致 */
const 待收货状态 = ["submitted", "approved", "partial_received"];

/* ─── 批量创建运单：逐行电话匹配供应商名，返回命中结果供前端弹问关联 ─── */
export async function 批量创建运单(
  行列表: 运单行输入[]
): Promise<操作结果 & { 结果?: 运单创建结果[] }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  if (!行列表 || 行列表.length === 0) {
    return { success: false, error: "运单列表不能为空" };
  }
  for (const 行 of 行列表) {
    if (!行.tracking_no?.trim()) {
      return { success: false, error: "运单号不能为空" };
    }
    if (!Number.isInteger(行.package_count) || 行.package_count <= 0) {
      return { success: false, error: `运单 ${行.tracking_no} 的件数必须是大于 0 的整数` };
    }
    if (isNaN(行.freight_amount) || 行.freight_amount < 0) {
      return { success: false, error: `运单 ${行.tracking_no} 的运费金额无效` };
    }
    if (isNaN(行.cod_amount) || 行.cod_amount < 0) {
      return { success: false, error: `运单 ${行.tracking_no} 的代收金额无效` };
    }
  }

  const supabase = await createClient();

  /* 逐行电话匹配供应商（取第一个命中的），命中则把供应商名写进运单 */
  const 电话去重 = Array.from(
    new Set(行列表.map((r) => r.phone?.trim()).filter((p): p is string => !!p))
  );
  const 电话供应商 = new Map<string, { id: string; name: string }>();
  for (const 电话 of 电话去重) {
    const { data } = await supabase
      .from("suppliers")
      .select("id, name")
      .ilike("phone", `%${电话}%`)
      .limit(1);
    if (data && data.length > 0) {
      电话供应商.set(电话, data[0] as { id: string; name: string });
    }
  }

  const 待插入 = 行列表.map((行) => {
    const 命中 = 行.phone?.trim() ? 电话供应商.get(行.phone.trim()) : undefined;
    return {
      tracking_no: 行.tracking_no.trim(),
      logistics_company_id: 行.logistics_company_id || null,
      logistics_company_name: 行.logistics_company_name || null,
      phone: 行.phone?.trim() || null,
      package_count: 行.package_count,
      freight_amount: 行.freight_amount,
      cod_amount: 行.cod_amount,
      photos: 行.photos && 行.photos.length > 0 ? 行.photos : null,
      supplier_name: 命中?.name || null,
      status: "pending",
    };
  });

  const { data: 新运单, error: 插入错误 } = await supabase
    .from("logistics_waybills")
    .insert(待插入)
    .select("id, tracking_no, phone");

  if (插入错误) {
    return { success: false, error: 插入错误.message };
  }

  /* 对每个电话命中的供应商，统计其还没关联运单的待收货采购单数，供前端弹问 */
  const 结果: 运单创建结果[] = [];
  for (const w of (新运单 || []) as { id: string; tracking_no: string; phone: string | null }[]) {
    const 命中 = w.phone?.trim() ? 电话供应商.get(w.phone.trim()) : undefined;
    let 待关联单数 = 0;
    if (命中) {
      const { count } = await supabase
        .from("purchase_orders")
        .select("id", { count: "exact", head: true })
        .eq("supplier_id", 命中.id)
        .in("status", 待收货状态)
        .is("waybill_id", null);
      待关联单数 = count || 0;
    }
    结果.push({
      waybill_id: w.id,
      tracking_no: w.tracking_no,
      supplier_id: 命中?.id || null,
      supplier_name: 命中?.name || null,
      待关联单数,
    });
  }

  revalidatePath("/procurement");
  revalidatePath("/logistics");
  revalidatePath("/m/receiving");
  return { success: true, 结果 };
}

/* ─── 结清运费（三期：记物流公司已付运费+运单打标，数据库一个事务） ─── */
export async function 结清运费(运单id: string): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!运单id) {
    return { success: false, error: "缺少运单信息" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("settle_waybill_freight", {
    p_waybill_id: 运单id,
  });
  if (error) {
    return { success: false, error: error.message };
  }
  const 结果 = data as unknown as { success: boolean; error?: string };
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "结清运费失败" };
  }

  revalidatePath("/logistics");
  return { success: true };
}

/* ─── 电话命中弹问确认后：把该供应商所有未关联运单的待收货采购单挂到这张运单 ─── */
export async function 关联运单到供应商待收货单(
  运单id: string,
  供应商id: string
): Promise<操作结果 & { count?: number }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!运单id || !供应商id) {
    return { success: false, error: "缺少运单或供应商信息" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchase_orders")
    .update({ waybill_id: 运单id })
    .eq("supplier_id", 供应商id)
    .in("status", 待收货状态)
    .is("waybill_id", null)
    .select("id");

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/procurement");
  revalidatePath("/m/receiving");
  return { success: true, count: (data || []).length };
}

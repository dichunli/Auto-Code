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

/* ─── 收货前运单处理（2026-08-21）─────────────────────────────
 * 外阜采购单未关联运单时点收货，弹窗提供两条出路：
 *   关联：把已有运单挂到整张采购单（明细id=null）或单个配件（明细id 非空）
 *   豁免：司机捎带/自行采购等无运单场景，记录运费(可选)+说明后放行收货 */

export async function 关联运单到采购单或配件(
  采购单id: string,
  明细id: string | null,
  运单id: string
): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!运单id) return { success: false, error: "请选择运单" };

  const supabase = await createClient();
  /* 运单必须存在且处于待签收（已签收/已作废的运单不能再关联） */
  const { data: 运单 } = await supabase
    .from("logistics_waybills")
    .select("id, status")
    .eq("id", 运单id)
    .single();
  if (!运单) return { success: false, error: "运单不存在" };
  if (运单.status !== "pending") return { success: false, error: "该运单已签收，不能关联" };

  if (明细id) {
    const { error } = await supabase
      .from("purchase_order_items")
      .update({ waybill_id: 运单id })
      .eq("id", 明细id)
      .eq("order_id", 采购单id);
    if (error) return { success: false, error: error.message };
  } else {
    const { error } = await supabase
      .from("purchase_orders")
      .update({ waybill_id: 运单id })
      .eq("id", 采购单id);
    if (error) return { success: false, error: error.message };
  }

  revalidatePath("/procurement");
  return { success: true };
}

export async function 设置运单豁免(
  采购单id: string,
  明细id: string | null,
  运费: number | null,
  说明: string
): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const 说明文本 = 说明.trim();
  if (!说明文本) return { success: false, error: "请填写说明（如：自行采购、其它方式带回）" };
  if (运费 !== null && (isNaN(运费) || 运费 < 0)) {
    return { success: false, error: "运费必须是非负数字" };
  }

  const supabase = await createClient();
  const 补丁 = { waybill_exempt: true, exempt_freight: 运费, exempt_note: 说明文本 };
  if (明细id) {
    const { error } = await supabase
      .from("purchase_order_items")
      .update(补丁)
      .eq("id", 明细id)
      .eq("order_id", 采购单id);
    if (error) return { success: false, error: error.message };
  } else {
    const { error } = await supabase
      .from("purchase_orders")
      .update(补丁)
      .eq("id", 采购单id);
    if (error) return { success: false, error: error.message };
  }

  revalidatePath("/procurement");
  return { success: true };
}


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
    /* 完全匹配才认定命中（2026-08-21 用户口径）：防止电话片段误关联到别家供应商 */
    const { data } = await supabase
      .from("suppliers")
      .select("id, name")
      .eq("phone", 电话)
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

/* ─── 创建单个运单（PC 待收货页"新建运单"弹窗） ───
 * 与 批量创建运单 的区别：供应商名由用户显式填写（不强制电话匹配），
 * 但仍检测电话命中的供应商及其待关联采购单数，供前端弹问关联。 */
export async function 创建运单(参数: {
  trackingNo: string;
  logisticsCompanyId: string;
  logisticsCompanyName: string;
  phone: string;
  supplierName: string;
  packageCount: number;
  freightAmount: number;
  codAmount: number;
  photos: string[];
}): Promise<操作结果 & {
  waybillId?: string;
  命中供应商id?: string | null;
  命中供应商名?: string | null;
  待关联单数?: number;
}> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!参数.trackingNo.trim()) {
    return { success: false, error: "请填写运单号" };
  }
  if (!Number.isInteger(参数.packageCount) || 参数.packageCount <= 0) {
    return { success: false, error: "请填写件数" };
  }

  const supabase = await createClient();
  const { data: waybill, error } = await supabase
    .from("logistics_waybills")
    .insert({
      tracking_no: 参数.trackingNo.trim(),
      logistics_company_id: 参数.logisticsCompanyId || null,
      logistics_company_name: 参数.logisticsCompanyName || null,
      phone: 参数.phone.trim() || null,
      supplier_name: 参数.supplierName.trim() || null,
      package_count: 参数.packageCount,
      freight_amount: 参数.freightAmount,
      cod_amount: 参数.codAmount,
      photos: 参数.photos.length > 0 ? 参数.photos : null,
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !waybill) {
    return { success: false, error: error?.message || "创建运单失败" };
  }

  /* 电话完全匹配命中供应商 → 统计其未关联运单的待收货采购单数（供前端弹问） */
  let 命中供应商id: string | null = null;
  let 命中供应商名: string | null = null;
  let 待关联单数 = 0;
  if (参数.phone.trim()) {
    const { data: 命中 } = await supabase
      .from("suppliers")
      .select("id, name")
      .eq("phone", 参数.phone.trim())
      .limit(1);
    if (命中 && 命中.length > 0) {
      命中供应商id = 命中[0].id as string;
      命中供应商名 = 命中[0].name as string;
      const { count } = await supabase
        .from("purchase_orders")
        .select("id", { count: "exact", head: true })
        .eq("supplier_id", 命中供应商id)
        .in("status", 待收货状态)
        .is("waybill_id", null);
      待关联单数 = count || 0;
    }
  }

  revalidatePath("/procurement");
  revalidatePath("/logistics");
  return { success: true, waybillId: waybill.id, 命中供应商id, 命中供应商名, 待关联单数 };
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

/* ─── 把运单关联到指定采购单（手机待收货管理页用：单张或批量） ─── */
export async function 关联运单到采购单(
  运单id: string,
  采购单ids: string[]
): Promise<操作结果 & { count?: number }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!运单id || !采购单ids || 采购单ids.length === 0) {
    return { success: false, error: "缺少运单或采购单信息" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchase_orders")
    .update({ waybill_id: 运单id })
    .in("id", 采购单ids)
    .select("id");
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/procurement");
  revalidatePath("/m/receiving");
  return { success: true, count: (data || []).length };
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

/* ─── 删除物流公司（删除前服务端检查运单引用） ─── */
export async function 删除物流公司(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();

  /* 服务端重新检查：该物流公司下是否还有运单 */
  const { count, error: countError } = await supabase
    .from("logistics_waybills")
    .select("id", { count: "exact", head: true })
    .eq("logistics_company_id", id);
  if (countError) {
    return { success: false, error: "检查引用失败: " + countError.message };
  }
  if (count && count > 0) {
    return { success: false, error: `该物流公司已被 ${count} 个运单引用，无法删除。` };
  }

  const { error } = await supabase.from("logistics_companies").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/logistics");
  return { success: true };
}

/* ─── 删除运单 ─── */
export async function 删除运单(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("logistics_waybills").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/logistics");
  return { success: true };
}

/* ═══ 物流管理页写操作收编 ═══ */

/* ─── 保存运单（新建/编辑，PC 物流管理页单条表单） ─── */
export async function 保存运单(参数: {
  id: string | null;
  trackingNo: string;
  logisticsCompanyId: string;
  logisticsCompanyName: string;
  phone: string;
  supplierName: string;
  packageCount: number;
  freightAmount: number;
  codAmount: number;
  photos: string[];
  notes: string;
}): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!参数.trackingNo.trim()) {
    return { success: false, error: "请填写运单号" };
  }

  const payload = {
    tracking_no: 参数.trackingNo.trim(),
    logistics_company_id: 参数.logisticsCompanyId || null,
    logistics_company_name: 参数.logisticsCompanyName || null,
    phone: 参数.phone.trim() || null,
    supplier_name: 参数.supplierName.trim() || null,
    package_count: 参数.packageCount,
    freight_amount: 参数.freightAmount,
    cod_amount: 参数.codAmount,
    photos: 参数.photos.length > 0 ? 参数.photos : null,
    notes: 参数.notes.trim() || null,
  };

  const supabase = await createClient();
  if (参数.id) {
    const { error } = await supabase.from("logistics_waybills").update(payload).eq("id", 参数.id);
    if (error) return { success: false, error: error.message };
  } else {
    const { error } = await supabase.from("logistics_waybills").insert({ ...payload, status: "pending" });
    if (error) return { success: false, error: error.message };
  }

  revalidatePath("/logistics");
  return { success: true };
}

/* ─── 批量创建运单（PC 物流管理页"按数量/单号清单"入口） ─── */
export async function 批量建运单(参数: {
  logisticsCompanyId: string;
  logisticsCompanyName: string;
  trackingNos: string[];
}): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (参数.trackingNos.length === 0) {
    return { success: false, error: "请至少输入一个物流单号" };
  }

  const supabase = await createClient();
  const records = 参数.trackingNos.map((trackingNo) => ({
    tracking_no: trackingNo,
    logistics_company_id: 参数.logisticsCompanyId || null,
    logistics_company_name: 参数.logisticsCompanyName || null,
    status: "pending",
  }));
  const { error } = await supabase.from("logistics_waybills").insert(records);
  if (error) return { success: false, error: error.message };

  revalidatePath("/logistics");
  return { success: true };
}

/* ─── 行内保存运单字段（电话变更时服务端同步供应商名） ─── */
export async function 保存运单行内字段(参数: {
  waybillId: string;
  field: "phone" | "package_count" | "freight_amount" | "cod_amount";
  value: string;
}): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  let payload: Record<string, string | number | null> = {};
  if (参数.field === "phone") {
    payload = { phone: 参数.value.trim() || null };
  } else if (参数.field === "package_count") {
    payload = { package_count: parseInt(参数.value, 10) || 0 };
  } else if (参数.field === "freight_amount") {
    payload = { freight_amount: parseFloat(参数.value) || 0 };
  } else {
    payload = { cod_amount: parseFloat(参数.value) || 0 };
  }

  const { error } = await supabase.from("logistics_waybills").update(payload).eq("id", 参数.waybillId);
  if (error) return { success: false, error: error.message };

  /* 电话变更 → 服务端查供应商并同步 supplier_name（完全匹配口径） */
  if (参数.field === "phone") {
    if (参数.value.trim()) {
      const { data: 命中 } = await supabase
        .from("suppliers")
        .select("name")
        .eq("phone", 参数.value.trim())
        .limit(1);
      await supabase
        .from("logistics_waybills")
        .update({ supplier_name: 命中 && 命中.length > 0 ? (命中[0].name as string) : null })
        .eq("id", 参数.waybillId);
    } else {
      await supabase.from("logistics_waybills").update({ supplier_name: null }).eq("id", 参数.waybillId);
    }
  }

  revalidatePath("/logistics");
  return { success: true };
}

/* ─── 保存物流公司（新建/编辑） ─── */
export async function 保存物流公司(参数: {
  id: string | null;
  name: string;
  scopes: string[];
  contact: string;
  phone: string;
  trackingUrl: string;
  notes: string;
  sortOrder: number;
}): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!参数.name.trim()) {
    return { success: false, error: "请填写物流公司名称" };
  }
  if (参数.scopes.length === 0) {
    return { success: false, error: "请至少选择一个服务范围" };
  }

  const payload = {
    name: 参数.name.trim(),
    scopes: 参数.scopes,
    contact: 参数.contact.trim() || null,
    phone: 参数.phone.trim() || null,
    tracking_url: 参数.trackingUrl.trim() || null,
    notes: 参数.notes.trim() || null,
    sort_order: 参数.sortOrder,
  };

  const supabase = await createClient();
  if (参数.id) {
    const { error } = await supabase.from("logistics_companies").update(payload).eq("id", 参数.id);
    if (error) return { success: false, error: error.message };
  } else {
    const { error } = await supabase.from("logistics_companies").insert(payload);
    if (error) return { success: false, error: error.message };
  }

  revalidatePath("/logistics");
  return { success: true };
}

/* ─── 物流公司排序（交换 / 直接改排序号） ─── */
export async function 交换物流公司排序(参数: {
  idA: string;
  sortA: number;
  idB: string;
  sortB: number;
}): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error: e1 } = await supabase.from("logistics_companies").update({ sort_order: 参数.sortB }).eq("id", 参数.idA);
  if (e1) return { success: false, error: e1.message };
  const { error: e2 } = await supabase.from("logistics_companies").update({ sort_order: 参数.sortA }).eq("id", 参数.idB);
  if (e2) return { success: false, error: e2.message };

  revalidatePath("/logistics");
  return { success: true };
}

export async function 保存物流公司排序号(参数: {
  id: string;
  sortOrder: number;
}): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("logistics_companies").update({ sort_order: 参数.sortOrder }).eq("id", 参数.id);
  if (error) return { success: false, error: error.message };

  revalidatePath("/logistics");
  return { success: true };
}

/* ═══ 新建独立运单 Server Action（物流页"新建运单"） ═══
 * 写操作从客户端直写收口到服务端，避免客户端 session 异常导致 401 / 被 RLS 拦截。
 * 与 创建运单 的区别：独立录入不关联采购单、不强制电话匹配供应商，多一个备注字段。 */
export async function 新建独立运单(参数: {
  trackingNo: string;
  logisticsCompanyId: string;
  logisticsCompanyName: string;
  phone: string;
  packageCount: number;
  freightAmount: number;
  codAmount: number;
  photos: string[];
  notes: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!参数.trackingNo.trim()) {
    return { success: false, error: "请填写物流单号" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("logistics_waybills").insert({
    tracking_no: 参数.trackingNo.trim(),
    logistics_company_id: 参数.logisticsCompanyId || null,
    logistics_company_name: 参数.logisticsCompanyName || null,
    phone: 参数.phone.trim() || null,
    package_count: 参数.packageCount,
    freight_amount: 参数.freightAmount,
    cod_amount: 参数.codAmount,
    photos: 参数.photos.length > 0 ? 参数.photos : null,
    status: "pending",
    notes: 参数.notes.trim() || null,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/logistics");
  return { success: true };
}

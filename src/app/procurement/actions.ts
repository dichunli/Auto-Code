"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 采购模块 Server Action ═══
 * 入库、收货、建单等核心写操作统一走服务端:
 * 1. 先验证登录,避免客户端 session 异常导致 401/RLS 42501
 * 2. 多表写入由数据库函数(RPC)一个事务完成,任一失败整体回滚
 * 3. 库存数量以数据库当前值为准(SQL 原子自增),不用客户端快照
 */

interface 操作结果 {
  success: boolean;
  error?: string;
}

interface RPC返回 {
  success: boolean;
  error?: string;
  inbound_order_id?: string;
  inbound_no?: string;
}

/* ─── 入库明细(前端弹窗确认后的每行) ─── */
export interface 入库明细输入 {
  purchase_order_item_id: string;
  quantity: number;
  batch_no: string;
  warehouse_id: string;
  location: string;
  notes: string;
  is_excess: boolean;
}

/* ─── 确认入库:一个事务写 8 张表,失败整体回滚 ─── */
export async function 确认采购入库(
  采购单id: string,
  明细: 入库明细输入[],
  运费: number
): Promise<操作结果 & { inbound_no?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  if (!明细 || 明细.length === 0) {
    return { success: false, error: "入库明细不能为空" };
  }
  for (const m of 明细) {
    if (!m.purchase_order_item_id) {
      return { success: false, error: "入库明细缺少采购明细信息" };
    }
    if (!m.is_excess && (!Number.isInteger(m.quantity) || m.quantity <= 0)) {
      return { success: false, error: "入库数量必须是大于 0 的整数" };
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("complete_purchase_inbound", {
    p_purchase_order_id: 采购单id,
    p_items: 明细,
    p_freight_amount: 运费 || 0,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "入库失败" };
  }

  revalidatePath("/procurement");
  revalidatePath("/inbound-orders");
  return { success: true, inbound_no: 结果.inbound_no };
}

/* ─── 退回待收货:清空处理结果、删补货分支、状态回退,一个事务 ─── */
export async function 退回待收货(采购单id: string): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("revoke_pending_storage", {
    p_purchase_order_id: 采购单id,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "退回失败" };
  }

  revalidatePath("/procurement");
  return { success: true };
}

/* ─── 退回已入库(2026-08-16 批次1 错账收口):整单回滚入库,一个事务 ───
 * 替代原 CompletedStorageList 客户端 10 步连环写(无事务、库存先读再写、
 * 非 admin 删单被 RLS 静默拦→错账)。库存净额回滚+退库回补+到货标记回退。 */
export async function 退回已入库(采购单id: string): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("revoke_completed_inbound", {
    p_purchase_order_id: 采购单id,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "退回失败" };
  }

  revalidatePath("/procurement");
  revalidatePath("/inbound-orders");
  return { success: true };
}

/* ─── 撤销/作废采购单(2026-08-17):仅未收货可操作,单据只废不删 ───
 * revoke 撤销:配件回待采购(工单行 is_purchased 回 false、暂存件回暂存表);
 * void 作废:配件不回,单据留档。两种模式单据都标 cancelled 留档。 */
export async function 撤销作废采购单(
  采购单id: string,
  模式: "revoke" | "void"
): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_purchase_order", {
    p_purchase_order_id: 采购单id,
    p_mode: 模式,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "操作失败" };
  }

  revalidatePath("/procurement");
  revalidatePath("/procurement/orders");
  return { success: true };
}

/* ═══ 采购建单 ═══ */

export interface 采购明细输入 {
  part_id?: string | null;
  part_name_id?: string | null;
  part_number?: string | null;
  name: string;
  supplier_part_name?: string | null;
  brand?: string | null;
  specification?: string | null;
  quantity: number;
  unit?: string | null;
  unit_cost?: number | null;
  category?: string | null;
  license_plate?: string | null;
  photos?: string[];
  notes?: string | null;
  work_order_item_part_id?: string | null;
}

export interface 采购单分组输入 {
  supplier_id: string;
  status?: string;
  logistics_company_id?: string | null;
  notes?: string | null;
  items: 采购明细输入[];
}

interface 建单RPC返回 {
  success: boolean;
  error?: string;
  orders?: { id: string; order_no: string }[];
}

/* ─── 创建采购单:建头+明细+回写工单配件行+清理暂存行,一个事务;支持一次多张(按供应商分组) ───
 * 暂存ids（2026-08-19 收编）：发起采购涉及的 custom_purchase_staging 行 id，
 * 由 RPC 在同一事务内删除（原为客户端补删，失败残留会导致暂存件重复显示） */
export async function 创建采购单(
  分组: 采购单分组输入[],
  暂存ids: string[] = []
): Promise<操作结果 & { orders?: { id: string; order_no: string }[] }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  if (!分组 || 分组.length === 0) {
    return { success: false, error: "采购单不能为空" };
  }
  for (const g of 分组) {
    if (!g.supplier_id) {
      return { success: false, error: "请选择供应商" };
    }
    if (!g.items || g.items.length === 0) {
      return { success: false, error: "采购明细不能为空" };
    }
    for (const it of g.items) {
      if (!it.name || !it.name.trim()) {
        return { success: false, error: "配件名称不能为空" };
      }
      if (!Number.isInteger(it.quantity) || it.quantity <= 0) {
        return { success: false, error: "采购数量必须是大于 0 的整数" };
      }
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_purchase_orders", {
    p_orders: 分组,
    p_staging_ids: 暂存ids,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as 建单RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "创建采购单失败" };
  }

  revalidatePath("/procurement");
  return { success: true, orders: 结果.orders };
}

/* ═══ 自定义采购暂存（2026-08-15） ═══
 * 安全库存补货/自定义采购弹窗不直接建采购单，先暂存，
 * 在「待采购」页与工单配件一起勾选后统一发起采购。 */

export interface 采购暂存输入 {
  part_id: string | null;
  part_number: string | null;
  name: string;
  brand: string | null;
  specification: string | null;
  document_name: string | null;
  unit: string | null;
  unit_cost: number | null;
  quantity: number;
  supplier_id: string;
  source: "safety_stock" | "custom";
}

export async function 添加采购暂存(行列表: 采购暂存输入[]): Promise<操作结果 & { count?: number }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  if (!行列表 || 行列表.length === 0) {
    return { success: false, error: "没有要添加的配件" };
  }
  for (const r of 行列表) {
    if (!r.name || !r.name.trim()) return { success: false, error: "配件名称不能为空" };
    if (!r.supplier_id) return { success: false, error: `「${r.name}」还没选供应商` };
    if (!Number.isInteger(r.quantity) || r.quantity <= 0) {
      return { success: false, error: `「${r.name}」的采购数量必须是大于 0 的整数` };
    }
  }

  const supabase = await createClient();

  /* 供应商名称以服务端为准，不信客户端传的文字 */
  const 供应商ids = [...new Set(行列表.map((r) => r.supplier_id))];
  const { data: 供应商列表 } = await supabase.from("suppliers").select("id, name").in("id", 供应商ids);
  const 供应商名Map = new Map(((供应商列表 || []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  for (const r of 行列表) {
    if (!供应商名Map.has(r.supplier_id)) return { success: false, error: "供应商不存在，请刷新后重试" };
  }

  const { error } = await supabase.from("custom_purchase_staging").insert(
    行列表.map((r) => ({
      part_id: r.part_id || null,
      part_number: r.part_number?.trim() || null,
      name: r.name.trim(),
      brand: r.brand?.trim() || null,
      specification: r.specification?.trim() || null,
      document_name: r.document_name?.trim() || null,
      unit: r.unit?.trim() || null,
      unit_cost: r.unit_cost ?? null,
      quantity: r.quantity,
      supplier_id: r.supplier_id,
      supplier_name: 供应商名Map.get(r.supplier_id),
      source: r.source,
      created_by: user.id,
    }))
  );
  if (error) return { success: false, error: error.message };

  revalidatePath("/procurement");
  return { success: true, count: 行列表.length };
}

/* ═══ 收货处理 ═══ */

/* ─── 收货登记:更新明细+克隆补货分支+服务端重算状态+运单联动,一个事务 ─── */
export async function 提交收货处理(
  采购单id: string,
  明细id: string,
  处理动作: string,
  实收数量: number,
  凭证照片: string[] | null,
  更新凭证: boolean
): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!Number.isInteger(实收数量) || 实收数量 < 0) {
    return { success: false, error: "实收数量必须是 ≥ 0 的整数" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("receive_purchase_item", {
    p_order_id: 采购单id,
    p_item_id: 明细id,
    p_handle_action: 处理动作,
    p_received_qty: 实收数量,
    p_evidence_photos: 凭证照片,
    p_set_evidence: 更新凭证,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "收货失败" };
  }

  revalidatePath("/procurement");
  return { success: true };
}

/* ─── 撤销收货:清空处理结果+删补货分支+状态回退,一个事务 ─── */
export async function 撤销收货处理(采购单id: string, 明细id: string): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("revoke_purchase_receipt", {
    p_order_id: 采购单id,
    p_item_id: 明细id,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "撤销失败" };
  }

  revalidatePath("/procurement");
  return { success: true };
}

/* ─── 部分收货(采购单详情页):实收原子累加,收满推进待入库,不加库存 ─── */
export async function 部分收货登记(
  采购单id: string,
  明细id: string,
  本次数量: number
): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!Number.isInteger(本次数量) || 本次数量 <= 0) {
    return { success: false, error: "收货数量必须是大于 0 的整数" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("receive_purchase_item_partial", {
    p_order_id: 采购单id,
    p_item_id: 明细id,
    p_qty: 本次数量,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "收货失败" };
  }

  revalidatePath("/procurement");
  revalidatePath(`/procurement/${采购单id}`);
  return { success: true };
}

/* ═══ 退货 / 采退单 ═══ */

/* ─── 标记退货记录已完成(2026-08-19 起记账) ───
 * 与"生成采退单"口径统一：标记完成时按 数量×采购价 记应收冲减(credit)，
 * 供应商按名称文本匹配；匹配不到供应商/无采购价则只改状态不记账(accounted=false)。 */
export async function 完成退货记录(记录id: string): Promise<操作结果 & { accounted?: boolean }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("complete_return_record", {
    p_record_id: 记录id,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as { success: boolean; error?: string; accounted?: boolean };
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "操作失败" };
  }

  revalidatePath("/procurement");
  revalidatePath("/supplier-returns");
  return { success: true, accounted: 结果.accounted };
}

/* ─── 批量撤销退货:含入库单整单回滚/弃货加回库存,一个事务 ─── */
export async function 批量撤销退货(记录ids: string[]): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!记录ids || 记录ids.length === 0) {
    return { success: false, error: "请先选择要撤销的记录" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("revoke_supplier_returns", {
    p_record_ids: 记录ids,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "撤销失败" };
  }

  revalidatePath("/procurement");
  revalidatePath("/supplier-returns");
  return { success: true };
}

/* ─── 撤销已退货(2026-08-16 批次2):删采退单+应收冲减+记录回 pending,一个事务 ───
 * 替代原 CompletedReturnList 客户端 5 步连环删(无事务,中途失败留半成品)。
 * 注意:撤销的是整张采退单(同单全部退货记录回 pending),不是只撤一条。 */
export async function 撤销已退货记录(记录id: string): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("revoke_purchase_return_order", {
    p_record_id: 记录id,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "撤销失败" };
  }

  revalidatePath("/procurement");
  revalidatePath("/supplier-returns");
  revalidatePath("/return-orders");
  return { success: true };
}

/* ─── 采退单分组(按供应商) ─── */
export interface 采退单分组输入 {
  supplier_id: string | null;
  supplier_name: string;
  logistics_company?: string | null;
  tracking_no?: string | null;
  return_shipping_fee?: number;
  shipping_fee_payer?: string | null;
  notes?: string | null;
  records: {
    record_id: string;
    part_id?: string | null;
    part_number?: string | null;
    name?: string | null;
    brand?: string | null;
    specification?: string | null;
    quantity: number;
    return_reason?: string | null;
    unit_cost?: number | null;
  }[];
}

/* ─── 生成采退单:建单+明细+退货记录完成+应收冲减,全部供应商一个事务 ─── */
export async function 生成采退单(
  分组: 采退单分组输入[]
): Promise<操作结果 & { orders?: { id: string; return_no: string }[] }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!分组 || 分组.length === 0) {
    return { success: false, error: "采退单不能为空" };
  }
  for (const g of 分组) {
    if (!g.records || g.records.length === 0) {
      return { success: false, error: "采退单明细不能为空" };
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_purchase_return_orders", {
    p_groups: 分组,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as RPC返回 & { orders?: { id: string; return_no: string }[] };
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "生成采退单失败" };
  }

  revalidatePath("/procurement");
  revalidatePath("/return-orders");
  revalidatePath("/supplier-returns");
  return { success: true, orders: 结果.orders };
}

/* ─── 更新工单配件客户意见(待采购页可改:改"未确定"退回待确认,改"否决"不再推进) ─── */
export async function 更新工单配件客户意见(行id: string, 意见: string): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!["pending", "agree", "reject"].includes(意见)) {
    return { success: false, error: "非法的客户意见值" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("work_order_item_parts")
    .update({ customer_opinion: 意见 })
    .eq("id", 行id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/procurement");
  return { success: true };
}

/* ─── 更新单据名称(各 Tab 失焦即存) ───
 * 单据名称有两个存放点:
 *  - 工单配件行 work_order_item_parts.document_name(待询价/待报价/待确认/待采购/退货环节的展示来源)
 *  - 采购明细快照 purchase_order_items.supplier_part_name(待收货/待入库/已入库的展示来源)
 * 改动任一处时联动同步另一处,保证各 Tab 看到的单据名称一致。
 * 联动范围:工单配件行改名 → 只同步「未完成采购单」的明细快照(已完成的是历史凭证不动)。 */
export async function 更新配件单据名称(参数: {
  工单配件行id?: string | null;
  采购明细id?: string | null;
  单据名称: string;
}): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const { 工单配件行id, 采购明细id } = 参数;
  const 新名称 = 参数.单据名称.trim() || null;
  if (!工单配件行id && !采购明细id) {
    return { success: false, error: "缺少要更新的行信息" };
  }

  const supabase = await createClient();

  if (工单配件行id) {
    const { error } = await supabase
      .from("work_order_item_parts")
      .update({ document_name: 新名称 })
      .eq("id", 工单配件行id);
    if (error) return { success: false, error: error.message };

    /* 联动同步:该配件行关联的、采购单未完成的明细快照(先查出目标明细 id 再更新) */
    const { data: 待同步 } = await supabase
      .from("purchase_order_items")
      .select("id, purchase_orders!inner(status)")
      .eq("work_order_item_part_id", 工单配件行id)
      .not("purchase_orders.status", "in", "(completed,cancelled)");
    const 待同步ids = (待同步 || []).map((r: { id: string }) => r.id);
    if (待同步ids.length > 0) {
      const { error: 联动错误 } = await supabase
        .from("purchase_order_items")
        .update({ supplier_part_name: 新名称 })
        .in("id", 待同步ids);
      if (联动错误) console.warn("联动同步采购明细单据名称失败:", 联动错误);
    }
  }

  if (采购明细id) {
    const { data: 明细, error: 读错误 } = await supabase
      .from("purchase_order_items")
      .select("work_order_item_part_id")
      .eq("id", 采购明细id)
      .single();
    if (读错误) return { success: false, error: 读错误.message };

    const { error } = await supabase
      .from("purchase_order_items")
      .update({ supplier_part_name: 新名称 })
      .eq("id", 采购明细id);
    if (error) return { success: false, error: error.message };

    /* 联动回写工单配件行(源头一致) */
    if (明细?.work_order_item_part_id) {
      const { error: 联动错误 } = await supabase
        .from("work_order_item_parts")
        .update({ document_name: 新名称 })
        .eq("id", 明细.work_order_item_part_id);
      if (联动错误) console.warn("联动回写工单配件单据名称失败:", 联动错误);
    }
  }

  revalidatePath("/procurement");
  return { success: true };
}
export async function 删除采购明细(采购单id: string, 明细id: string): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_purchase_item", {
    p_order_id: 采购单id,
    p_item_id: 明细id,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "删除失败" };
  }

  revalidatePath("/procurement");
  return { success: true };
}

/* ─── 单个配件撤销退回待采购(2026-08-20):配件级版"撤销整单" ───
 * 收货前发现某个配件这次不需要买了：工单行 is_purchased 回 false(回待采购列表)、
 * 暂存件回暂存表、删采购明细；明细删空时整单标 cancelled 留档(只废不删)。
 * 与"作废"(删除采购明细,上面)的区别：撤销=配件回待采购可重新组单，作废=彻底删除。 */
export async function 撤销采购明细退回待采购(采购单id: string, 明细id: string): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("revoke_purchase_item_to_pending", {
    p_order_id: 采购单id,
    p_item_id: 明细id,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "撤销失败" };
  }

  revalidatePath("/procurement");
  return { success: true };
}

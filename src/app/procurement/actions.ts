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

/* ─── 创建采购单:建头+明细+回写工单配件行,一个事务;支持一次多张(按供应商分组) ─── */
export async function 创建采购单(
  分组: 采购单分组输入[]
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

/* ─── 标记退货记录已完成(单表更新) ─── */
export async function 完成退货记录(记录id: string): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("supplier_return_records")
    .update({ status: "completed" })
    .eq("id", 记录id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/procurement");
  return { success: true };
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

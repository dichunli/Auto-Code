"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 入库确认单 Server Action（2026-09-08 两阶段入库）═══
 * 确认单（draft）的编辑/作废/确认入库统一走服务端：
 * 1. 先验证登录，避免客户端 session 异常导致 401/RLS 42501
 * 2. 确认入库的业务参数全部由服务端从 draft 读，客户端只传确认单 id，
 *    无法篡改价格/运费/抹零
 * 3. 多表写入由数据库函数（RPC）一个事务完成，任一失败整体回滚
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

/* ─── 确认单明细编辑输入（对应 update_inbound_draft 的 p_items 元素）───
 * 数量/配件不在其列：数量不可改（数量错=收货环节错，作废重生成），
 * 编码修改走「行内配件关联」通道写 purchase_order_items，RPC 自动跟进快照 */
export interface 确认单明细输入 {
  id: string; /* inbound_order_items.id */
  unit_cost: number | null;
  freight_alloc: number | null; /* 手动分摊运费，空=自动分摊 */
  batch_no: string;
  warehouse_id: string;
  location: string;
  notes: string;
}

/* ─── 更新入库确认单 ─── */
export async function 更新入库确认单(
  确认单id: string,
  明细: 确认单明细输入[],
  运费: number,
  抹零: number | null = null,
  销售单单号: string | null = null,
  销售单金额: number | null = null,
  运单id: string | null = null
): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!确认单id) {
    return { success: false, error: "缺少确认单信息" };
  }
  if (!明细 || 明细.length === 0) {
    return { success: false, error: "确认单明细不能为空" };
  }
  for (const m of 明细) {
    if (!m.id) {
      return { success: false, error: "确认单明细缺少行标识" };
    }
    if (m.unit_cost !== null && m.unit_cost < 0) {
      return { success: false, error: "入库单价不能为负" };
    }
    if (m.freight_alloc !== null && m.freight_alloc < 0) {
      return { success: false, error: "分摊运费不能为负" };
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("update_inbound_draft", {
    p_draft_id: 确认单id,
    p_items: 明细,
    p_freight_amount: 运费 || 0,
    p_discount_amount: 抹零,
    p_supplier_order_no: 销售单单号,
    p_supplier_order_amount: 销售单金额,
    p_waybill_id: 运单id,
    p_operator_id: user.id,
  });
  if (error) return { success: false, error: error.message };
  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) return { success: false, error: 结果?.error || "保存失败" };

  revalidatePath("/inbound-orders");
  revalidatePath(`/inbound-orders/${确认单id}`);
  revalidatePath("/procurement");
  return { success: true };
}

/* ─── 作废入库确认单（硬删，inbound_order_items 级联删除）─── */
export async function 作废入库确认单(确认单id: string): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!确认单id) {
    return { success: false, error: "缺少确认单信息" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("void_inbound_draft", {
    p_draft_id: 确认单id,
    p_operator_id: user.id,
  });
  if (error) return { success: false, error: error.message };
  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) return { success: false, error: 结果?.error || "作废失败" };

  revalidatePath("/inbound-orders");
  revalidatePath("/procurement");
  return { success: true };
}

/* ─── 确认入库（核心：业务参数全部由服务端从 draft 读，客户端只传 id）───
 * 按来源分发：批次来源 → complete_batch_inbound；采购单来源 → complete_purchase_inbound。
 * 每行 allocated_cost 作为 freight_alloc 手动行回传，确认单上看到的就是最终入账的（零漂移）。 */
export async function 确认入库单(
  确认单id: string
): Promise<操作结果 & { inbound_no?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!确认单id) {
    return { success: false, error: "缺少确认单信息" };
  }

  const supabase = await createClient();

  /* 读确认单单头 */
  const { data: 单头, error: 单头错误 } = await supabase
    .from("inbound_orders")
    .select(
      "id, status, receiving_batch_id, purchase_order_id, freight_amount, discount_amount, supplier_order_no, supplier_order_amount, waybill_id"
    )
    .eq("id", 确认单id)
    .single();
  if (单头错误 || !单头) {
    return { success: false, error: "入库确认单不存在" };
  }
  if (单头.status !== "draft") {
    return { success: false, error: "该单已确认入库，请勿重复操作" };
  }

  /* 销售单总金额必填（2026-09-09）：存量 NULL 金额的旧确认单先补填保存再确认，
     否则 complete RPC 的「填了才校验对平」会跳过对账直接入账 */
  if (单头.supplier_order_amount == null) {
    return { success: false, error: "请先填写供应商销售单总金额并保存，再确认入库" };
  }

  /* 读确认单明细 */
  const { data: 明细行, error: 明细错误 } = await supabase
    .from("inbound_order_items")
    .select(
      "purchase_order_item_id, quantity, unit_cost, allocated_cost, batch_no, warehouse_id, location, notes"
    )
    .eq("inbound_order_id", 确认单id);
  if (明细错误) {
    return { success: false, error: 明细错误.message };
  }
  if (!明细行 || 明细行.length === 0) {
    return { success: false, error: "确认单明细不能为空" };
  }

  /* 组装 RPC 的 p_items：allocated_cost 作为 freight_alloc 手动行锁定分摊 */
  const p_items = 明细行.map((行) => ({
    purchase_order_item_id: 行.purchase_order_item_id,
    quantity: 行.quantity,
    batch_no: 行.batch_no ?? "",
    warehouse_id: 行.warehouse_id ?? "",
    location: 行.location ?? "",
    notes: 行.notes ?? "",
    is_excess: false,
    unit_cost: 行.unit_cost,
    freight_alloc: 行.allocated_cost ?? 0,
  }));

  let data: unknown;
  let error: { message: string } | null;

  if (单头.receiving_batch_id) {
    /* 批次来源（黄卡） */
    const res = await supabase.rpc("complete_batch_inbound", {
      p_batch_id: 单头.receiving_batch_id,
      p_items,
      p_freight_amount: 单头.freight_amount || 0,
      p_operator_id: user.id,
      p_discount_amount: 单头.discount_amount,
      p_supplier_order_amount: 单头.supplier_order_amount,
      p_waybill_id: 单头.waybill_id,
      p_draft_inbound_id: 确认单id,
    });
    data = res.data;
    error = res.error;
  } else if (单头.purchase_order_id) {
    /* 采购单来源（蓝卡） */
    const res = await supabase.rpc("complete_purchase_inbound", {
      p_purchase_order_id: 单头.purchase_order_id,
      p_items,
      p_freight_amount: 单头.freight_amount || 0,
      p_operator_id: user.id,
      p_discount_amount: 单头.discount_amount,
      p_supplier_order_no: 单头.supplier_order_no,
      p_supplier_order_amount: 单头.supplier_order_amount,
      p_draft_inbound_id: 确认单id,
    });
    data = res.data;
    error = res.error;
  } else {
    return { success: false, error: "确认单来源不明（既非批次也非采购单），请联系管理员" };
  }

  if (error) return { success: false, error: error.message };
  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) return { success: false, error: 结果?.error || "确认入库失败" };

  revalidatePath("/procurement");
  revalidatePath("/inbound-orders");
  revalidatePath(`/inbound-orders/${确认单id}`);
  return { success: true, inbound_no: 结果.inbound_no };
}

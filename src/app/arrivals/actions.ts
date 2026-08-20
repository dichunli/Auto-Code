"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 到货确认单 Server Action（2026-08-20 待收货改造二期） ═══
 * 到货单建单/逐行收货/确认到货/确认入库全部走服务端 + 数据库事务函数。
 * 注意：依赖迁移 supabase/migrations_20260820_arrival_receipts.sql 已执行。
 */

interface 操作结果 {
  success: boolean;
  error?: string;
}

interface RPC返回 {
  success: boolean;
  error?: string;
  arrival_id?: string;
  receipt_no?: string;
  item_count?: number;
  inbound_no?: string;
}

function 刷新相关路径() {
  revalidatePath("/procurement");
  revalidatePath("/m/receiving");
  revalidatePath("/inbound-orders");
}

/* ─── 建到货确认单：选供应商（可挂运单），数据库自动拉入其在途采购行 ─── */
export async function 建到货确认单(
  运单id: string | null,
  供应商id: string,
  供应商单号: string | null,
  照片: string[] | null
): Promise<操作结果 & { arrival_id?: string; receipt_no?: string; item_count?: number }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (!供应商id) {
    return { success: false, error: "请选择供应商" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_arrival_receipt", {
    p_waybill_id: 运单id || null,
    p_supplier_id: 供应商id,
    p_supplier_order_no: 供应商单号?.trim() || null,
    p_photos: 照片 && 照片.length > 0 ? 照片 : null,
  });
  if (error) {
    return { success: false, error: error.message };
  }
  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "创建到货单失败" };
  }

  刷新相关路径();
  return { success: true, arrival_id: 结果.arrival_id, receipt_no: 结果.receipt_no, item_count: 结果.item_count };
}

/* ─── 逐行收货处理：数量+处理动作+仓位+照片，事务内联动采购行 ─── */
export async function 处理到货明细(
  到货明细id: string,
  处理动作: string,
  实收数量: number,
  仓库id: string | null,
  仓位: string | null,
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
  const { data, error } = await supabase.rpc("handle_arrival_item", {
    p_arrival_item_id: 到货明细id,
    p_handle_action: 处理动作,
    p_received_qty: 实收数量,
    p_warehouse_id: 仓库id || null,
    p_location: 仓位?.trim() || null,
    p_evidence_photos: 凭证照片,
    p_set_evidence: 更新凭证,
  });
  if (error) {
    return { success: false, error: error.message };
  }
  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "收货失败" };
  }

  刷新相关路径();
  return { success: true };
}

/* ─── 确认到货单：实物上架（库存+批次+流水）+ 工单配件标已到货（急件直领） ─── */
export async function 确认到货单(到货单id: string): Promise<操作结果 & { receipt_no?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("confirm_arrival_receipt", {
    p_arrival_id: 到货单id,
  });
  if (error) {
    return { success: false, error: error.message };
  }
  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "确认到货失败" };
  }

  刷新相关路径();
  return { success: true, receipt_no: 结果.receipt_no };
}

/* ─── 确认入库：纯账务收尾（入库单+应付款+运费分摊），不再动库存 ─── */
export async function 确认到货入库(
  到货单id: string,
  运费: number
): Promise<操作结果 & { inbound_no?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }
  if (isNaN(运费) || 运费 < 0) {
    return { success: false, error: "运费金额无效" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("complete_arrival_inbound", {
    p_arrival_id: 到货单id,
    p_freight_amount: 运费 || 0,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }
  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "确认入库失败" };
  }

  刷新相关路径();
  return { success: true, inbound_no: 结果.inbound_no };
}

/* ─── 供应商销售单号/截图后补（规划决策1：单号选填、照片可后补） ─── */
export async function 补录到货单信息(
  到货单id: string,
  供应商单号: string | null,
  照片: string[] | null
): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("arrival_receipts")
    .update({
      supplier_order_no: 供应商单号?.trim() || null,
      photos: 照片 && 照片.length > 0 ? 照片 : null,
    })
    .eq("id", 到货单id);
  if (error) {
    return { success: false, error: error.message };
  }

  刷新相关路径();
  return { success: true };
}

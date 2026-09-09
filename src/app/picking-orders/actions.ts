"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* 领料明细输入（快照字段由前端从工单配件分支带入） */
export interface 领料明细输入 {
  work_order_item_part_id: string;
  part_id: string | null;
  batch_id: string;
  quantity: number;
  part_number?: string | null;
  name?: string | null;
  brand?: string | null;
  specification?: string | null;
  unit?: string | null;
  batch_no?: string | null;
  unit_cost?: number | null;
}

/* 直领明细输入（急件直领只需分支和数量，采购行分摊由 RPC 自动做） */
export interface 直领明细输入 {
  work_order_item_part_id: string;
  quantity: number;
}

interface 开单结果 {
  success: boolean;
  data?: { id: string; no: string };
  error?: string;
}

interface RPC返回 {
  success: boolean;
  error?: string;
  picking_order_id?: string;
  picking_no?: string;
}

/**
 * 创建领料单（原子操作：建单 + 逐条扣库存 + 写明细，任一步失败整体回滚）
 * 库存扣减由数据库触发器完成，批次剩余不足或总库存不足会直接报错
 */
export async function 创建领料单(
  工单id: string | null,
  明细: 领料明细输入[],
  领料人: string,
  备注: string
): Promise<开单结果> {
  if (!明细 || 明细.length === 0) {
    return { success: false, error: "领料明细不能为空" };
  }
  for (const m of 明细) {
    if (!m.batch_id || !m.work_order_item_part_id) {
      return { success: false, error: "领料明细缺少批次或配件分支信息" };
    }
    if (!Number.isInteger(m.quantity) || m.quantity <= 0) {
      return { success: false, error: "领料数量必须是大于 0 的整数" };
    }
  }

  const supabase = await createClient();
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "登录已失效，请重新登录" };
  }

  const { data, error } = await supabase.rpc("create_picking_order", {
    p_work_order_id: 工单id,
    p_items: 明细,
    p_receiver_name: 领料人,
    p_notes: 备注,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "创建领料单失败" };
  }

  /* 实领后自动核销申领 */
  await 核销申领(supabase, 分支ids去重(明细.map((m) => m.work_order_item_part_id)), user.id);

  revalidatePath("/picking-orders");
  revalidatePath("/picking");
  if (工单id) {
    revalidatePath(`/work-orders/${工单id}`);
  }
  return {
    success: true,
    data: { id: 结果.picking_order_id!, no: 结果.picking_no! },
  };
}

/* 分支 id 数组去重 */
function 分支ids去重(ids: string[]): string[] {
  return [...new Set(ids)];
}

/**
 * 实领（含直领）后自动核销申领：按分支"剩余实领额度 = 累计实领 - 已核销申领"，
 * 从最早开始逐条覆盖，能盖住就标记 done（退库导致的倒挂不在此处理）
 */
async function 核销申领(
  supabase: Awaited<ReturnType<typeof createClient>>,
  分支ids: string[],
  操作人id: string
) {
  for (const 分支id of 分支ids) {
    const [{ data: 实领记录 }, { data: 全部申领 }] = await Promise.all([
      supabase.from("part_picking_records").select("quantity").eq("work_order_item_part_id", 分支id),
      supabase.from("part_pick_requests").select("id, quantity, status").eq("work_order_item_part_id", 分支id).order("created_at", { ascending: true }),
    ]);
    const 待核销 = (全部申领 || []).filter((r) => r.status === "pending");
    if (待核销.length === 0) continue;
    const 实领总数 = (实领记录 || []).reduce((s, r) => s + (r.quantity || 0), 0);
    let 剩余额度 = 实领总数 - (全部申领 || []).filter((r) => r.status === "done").reduce((s, r) => s + (r.quantity || 0), 0);
    const 核销ids: string[] = [];
    for (const r of 待核销) {
      if (剩余额度 >= r.quantity) {
        核销ids.push(r.id);
        剩余额度 -= r.quantity;
      }
    }
    if (核销ids.length > 0) {
      await supabase
        .from("part_pick_requests")
        .update({ status: "done", done_at: new Date().toISOString(), done_by: 操作人id })
        .in("id", 核销ids);
    }
  }
}

/* ═══ 急件直领（2026-09-09 二期）：待入库未入账的配件直接开领料单，
       登记后不动库存；确认入库事务里即入即出冲账 ═══ */

interface 直领RPC返回 {
  success: boolean;
  error?: string;
  picking_order_id?: string;
  picking_no?: string;
}

/**
 * 直领开单：调 create_direct_picking_order RPC（校验+分摊采购行全在数据库事务里）
 * 直领登记算"已领"（结单门禁/申领核销自动兼容），库存账等确认入库时轧平
 */
export async function 直领开单(
  明细: 直领明细输入[],
  领料人: string,
  备注: string
): Promise<开单结果> {
  if (!明细 || 明细.length === 0) {
    return { success: false, error: "直领明细不能为空" };
  }
  for (const m of 明细) {
    if (!m.work_order_item_part_id) {
      return { success: false, error: "直领明细缺少配件分支信息" };
    }
    if (!Number.isInteger(m.quantity) || m.quantity <= 0) {
      return { success: false, error: "直领数量必须是大于 0 的整数" };
    }
  }

  const supabase = await createClient();
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "登录已失效，请重新登录" };
  }

  const { data, error } = await supabase.rpc("create_direct_picking_order", {
    p_items: 明细,
    p_receiver_name: 领料人,
    p_notes: 备注,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }

  const 结果 = data as unknown as 直领RPC返回;
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "直领开单失败" };
  }

  /* 直领也算实领：按同口径核销申领 */
  await 核销申领(supabase, 分支ids去重(明细.map((m) => m.work_order_item_part_id)), user.id);

  /* 反查工单 id 用于刷新工单详情页 */
  const { data: 单 } = await supabase
    .from("picking_orders")
    .select("work_order_id")
    .eq("id", 结果.picking_order_id!)
    .single();

  revalidatePath("/picking-orders");
  revalidatePath("/picking");
  if (单?.work_order_id) {
    revalidatePath(`/work-orders/${单.work_order_id}`);
  }
  return {
    success: true,
    data: { id: 结果.picking_order_id!, no: 结果.picking_no! },
  };
}

/**
 * 取消直领（仅限未冲账的直领记录）：删登记+删明细行，单空则整单删除
 * 已冲账（入库完成）的不能取消，走退料流程
 */
export async function 取消直领(领料记录id: string): Promise<申领结果 & { 单已删?: boolean }> {
  const supabase = await createClient();
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "登录已失效，请重新登录" };
  }

  /* 先反查工单 id（删完记录就查不到了），用于刷新工单详情页 */
  const { data: 记录 } = await supabase
    .from("part_picking_records")
    .select("work_order_item_parts(work_order_items(work_order_id))")
    .eq("id", 领料记录id)
    .single();
  interface 记录联查 {
    work_order_item_parts: { work_order_items: { work_order_id: string } | null } | null;
  }
  const 工单id = (记录 as unknown as 记录联查 | null)?.work_order_item_parts?.work_order_items?.work_order_id;

  const { data, error } = await supabase.rpc("cancel_direct_picking", {
    p_picking_record_id: 领料记录id,
    p_operator_id: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }
  const 结果 = data as unknown as { success: boolean; error?: string; order_deleted?: boolean };
  if (!结果?.success) {
    return { success: false, error: 结果?.error || "取消直领失败" };
  }

  revalidatePath("/picking-orders");
  revalidatePath("/picking");
  if (工单id) {
    revalidatePath(`/work-orders/${工单id}`);
  }
  return { success: true, 单已删: 结果.order_deleted };
}

/* ═══ 配件申领（师傅手机端发起，只记需求不动库存；库管实领后自动核销） ═══ */
interface 申领结果 {
  success: boolean;
  error?: string;
}

/* 发起申领 */
export async function 申领配件(分支id: string, 数量: number, 备注: string): Promise<申领结果> {
  if (!Number.isInteger(数量) || 数量 <= 0) {
    return { success: false, error: "申领数量必须是大于 0 的整数" };
  }
  const supabase = await createClient();
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "登录已失效，请重新登录" };
  }
  const { error } = await supabase.from("part_pick_requests").insert({
    work_order_item_part_id: 分支id,
    quantity: 数量,
    notes: 备注.trim() || null,
    requested_by: user.id,
  });
  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}

/* 取消申领（仅待出库的可取消） */
export async function 取消申领(申领id: string): Promise<申领结果> {
  const supabase = await createClient();
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "登录已失效，请重新登录" };
  }
  const { error } = await supabase
    .from("part_pick_requests")
    .update({ status: "cancelled" })
    .eq("id", 申领id)
    .eq("status", "pending");
  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}

/* ═══ 统一确认领料（2026-09-10 待领料左右分栏）：左边点选进篮子，右边统一确认。
       有库存的按批次 FIFO 自动分配开普通领料单（即领即扣库存）；
       待入库的走急件直领（登记不动库存，确认入库时轧平）。
       逐工单容错：一个工单失败不影响其他工单 ═══ */

export interface 统一领料项 {
  work_order_item_part_id: string;
  quantity: number;
}

export interface 统一领料工单组 {
  工单id: string;
  /* 有库存可立即领的（服务端查批次自动分配） */
  普通: 统一领料项[];
  /* 待入库未入账的（急件直领） */
  直领: 统一领料项[];
}

export interface 统一领料工单结果 {
  工单id: string;
  普通单号?: string;
  直领单号?: string;
  普通错误?: string;
  直领错误?: string;
}

interface 统一领料返回 {
  success: boolean;
  结果?: 统一领料工单结果[];
  error?: string;
}

/* 分支联查返回形状（服务端重查校验用，不信任客户端传值） */
interface 分支校验行 {
  id: string;
  part_id: string | null;
  part_number: string | null;
  name: string | null;
  alias_name: string | null;
  brand: string | null;
  specification: string | null;
  unit: string | null;
  quantity: number | null;
  part_names: { name: string; unit: string | null } | null;
  work_order_items: { work_order_id: string } | null;
}

interface 批次行 {
  id: string;
  part_id: string;
  batch_no: string | null;
  remaining: number;
  unit_cost: number | null;
}

/**
 * 统一确认领料：按工单分组批量开单
 * 普通部分：服务端重查分支+净领校验数量，批次 FIFO 自动分配后调 create_picking_order
 * 直领部分：直接调 create_direct_picking_order（锁分支校验+采购行分摊全在 RPC 内）
 */
export async function 统一确认领料(
  工单组列表: 统一领料工单组[],
  领料人: string,
  备注: string
): Promise<统一领料返回> {
  if (!工单组列表 || 工单组列表.length === 0) {
    return { success: false, error: "待确认的配件不能为空" };
  }

  const supabase = await createClient();
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "登录已失效，请重新登录" };
  }

  const 结果列表: 统一领料工单结果[] = [];

  for (const 组 of 工单组列表) {
    const 单组结果: 统一领料工单结果 = { 工单id: 组.工单id };

    /* ── 普通领料：重查校验 + FIFO 自动分配 + 开单 ── */
    if (组.普通 && 组.普通.length > 0) {
      try {
        const 普通单号 = await 处理普通领料(supabase, 组, user.id, 领料人, 备注);
        单组结果.普通单号 = 普通单号;
      } catch (err: unknown) {
        单组结果.普通错误 = err instanceof Error ? err.message : "开单失败";
      }
    }

    /* ── 急件直领：校验分摊全在 RPC 事务里 ── */
    if (组.直领 && 组.直领.length > 0) {
      const 有效直领 = 组.直领.filter((m) => Number.isInteger(m.quantity) && m.quantity > 0);
      if (有效直领.length === 0) {
        单组结果.直领错误 = "直领数量必须是大于 0 的整数";
      } else {
        const { data, error } = await supabase.rpc("create_direct_picking_order", {
          p_items: 有效直领,
          p_receiver_name: 领料人,
          p_notes: 备注,
          p_operator_id: user.id,
        });
        const 直领结果 = data as unknown as 直领RPC返回 | null;
        if (error || !直领结果?.success) {
          单组结果.直领错误 = error?.message || 直领结果?.error || "直领开单失败";
        } else {
          单组结果.直领单号 = 直领结果.picking_no;
          await 核销申领(supabase, 分支ids去重(有效直领.map((m) => m.work_order_item_part_id)), user.id);
        }
      }
    }

    结果列表.push(单组结果);
  }

  revalidatePath("/picking-orders");
  revalidatePath("/picking");
  for (const 组 of 工单组列表) {
    revalidatePath(`/work-orders/${组.工单id}`);
  }
  return { success: true, 结果: 结果列表 };
}

/* 普通领料单工单处理：校验→分配→开单，返回单号；失败抛错由上层捕获记录 */
async function 处理普通领料(
  supabase: Awaited<ReturnType<typeof createClient>>,
  组: 统一领料工单组,
  操作人id: string,
  领料人: string,
  备注: string
): Promise<string> {
  const 有效项 = 组.普通.filter((m) => Number.isInteger(m.quantity) && m.quantity > 0);
  if (有效项.length === 0) {
    throw new Error("领料数量必须是大于 0 的整数");
  }
  const 分支ids = 有效项.map((m) => m.work_order_item_part_id);

  /* 服务端重查分支（数量校验、工单归属、快照字段都不信任客户端） */
  const { data: 分支数据 } = await supabase
    .from("work_order_item_parts")
    .select("id, part_id, part_number, name, alias_name, brand, specification, unit, quantity, part_names(name, unit), work_order_items(work_order_id)")
    .in("id", 分支ids);
  const 分支Map = new Map<string, 分支校验行>();
  for (const b of (分支数据 || []) as unknown as 分支校验行[]) {
    分支Map.set(b.id, b);
  }

  /* 净领（领-退）算剩余需领 */
  const [{ data: 领料记录 }, { data: 退料记录 }] = await Promise.all([
    supabase.from("part_picking_records").select("work_order_item_part_id, quantity").in("work_order_item_part_id", 分支ids),
    supabase.from("part_return_records").select("work_order_item_part_id, quantity").in("work_order_item_part_id", 分支ids),
  ]);
  const 净领Map: Record<string, number> = {};
  for (const r of 领料记录 || []) {
    净领Map[r.work_order_item_part_id] = (净领Map[r.work_order_item_part_id] || 0) + r.quantity;
  }
  for (const r of 退料记录 || []) {
    净领Map[r.work_order_item_part_id] = (净领Map[r.work_order_item_part_id] || 0) - r.quantity;
  }

  /* 逐分支校验：存在、属于该工单、有配件档案、数量不超剩余需领 */
  for (const m of 有效项) {
    const b = 分支Map.get(m.work_order_item_part_id);
    const 名称 = b?.alias_name || b?.name || b?.part_names?.name || "配件";
    if (!b) throw new Error(`${名称}：配件分支不存在，可能已被删除`);
    if (b.work_order_items?.work_order_id !== 组.工单id) {
      throw new Error(`${名称}：不属于该工单，请刷新后重试`);
    }
    if (!b.part_id) throw new Error(`${名称}：未关联配件档案，无法按批次领料`);
    const 剩余需领 = (b.quantity || 0) - Math.max(0, 净领Map[b.id] || 0);
    if (m.quantity > 剩余需领) {
      throw new Error(`${名称}：剩余需领 ${剩余需领} 件，本次领 ${m.quantity} 件超量（可能已被其他人领走，请刷新）`);
    }
  }

  /* 查可用批次（剩余>0，按入库时间先进先出） */
  const 配件ids = [...new Set(有效项.map((m) => 分支Map.get(m.work_order_item_part_id)!.part_id!))];
  const { data: 批次数据 } = await supabase
    .from("part_batches")
    .select("id, part_id, batch_no, remaining, unit_cost")
    .in("part_id", 配件ids)
    .gt("remaining", 0)
    .order("inbound_at", { ascending: true });
  const 批次按配件 = new Map<string, 批次行[]>();
  for (const b of (批次数据 || []) as unknown as 批次行[]) {
    const arr = 批次按配件.get(b.part_id) || [];
    arr.push(b);
    批次按配件.set(b.part_id, arr);
  }

  /* FIFO 自动分配并组装明细（批次剩余不足则整单失败） */
  const 明细: 领料明细输入[] = [];
  for (const m of 有效项) {
    const b = 分支Map.get(m.work_order_item_part_id)!;
    const 名称 = b.alias_name || b.name || b.part_names?.name || "配件";
    const 批次 = 批次按配件.get(b.part_id!) || [];
    const 批次总剩余 = 批次.reduce((s, x) => s + x.remaining, 0);
    if (批次总剩余 < m.quantity) {
      throw new Error(`${名称}：批次库存不足，需 ${m.quantity} 件仅剩 ${批次总剩余} 件（可能已被其他人领走，请刷新）`);
    }
    let 待分 = m.quantity;
    for (const p of 批次) {
      if (待分 <= 0) break;
      const 本批 = Math.min(待分, p.remaining);
      if (本批 > 0) {
        明细.push({
          work_order_item_part_id: b.id,
          part_id: b.part_id,
          batch_id: p.id,
          quantity: 本批,
          part_number: b.part_number,
          name: 名称,
          brand: b.brand,
          specification: b.specification,
          unit: b.unit || b.part_names?.unit || "个",
          batch_no: p.batch_no,
          unit_cost: p.unit_cost,
        });
        待分 -= 本批;
      }
    }
  }

  const { data, error } = await supabase.rpc("create_picking_order", {
    p_work_order_id: 组.工单id,
    p_items: 明细,
    p_receiver_name: 领料人,
    p_notes: 备注,
    p_operator_id: 操作人id,
  });
  const 开单结果 = data as unknown as RPC返回 | null;
  if (error || !开单结果?.success) {
    throw new Error(error?.message || 开单结果?.error || "创建领料单失败");
  }

  await 核销申领(supabase, 分支ids去重(分支ids), 操作人id);
  return 开单结果.picking_no!;
}

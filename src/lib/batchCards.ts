/*
 * 批次卡片查询（2026-09-07 待入库卡片化）：
 * 待入库页客户端刷新（PendingStorageList.loadData）和采购看板服务端首屏（procurement/page.tsx）
 * 共用这一个查询，保证两条路径的数据口径完全一致，不会各写一份悄悄漂移。
 *
 * 卡片 = receiving_batches 批次 = 一张供应商销售单；
 * 每张卡片带：配件明细（按 sort_order 排）+ 关联运单（去重，含运费分摊进度）。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/* 批次卡片里的配件行（字段与 PendingStorageList 的 PurchaseOrderItem 结构对齐） */
export interface 批次配件行 {
  id: string;
  name: string;
  brand: string | null;
  specification: string | null;
  quantity: number;
  unit_cost: number | null;
  received_qty: number | null;
  part_id: string | null;
  work_order_item_part_id: string | null;
  part_number: string | null;
  supplier_part_name: string | null;
  unit: string | null;
  category: string | null;
  license_plate: string | null;
  photos: string[] | null;
  notes: string | null;
  handle_action: string | null;
  discount_amount: number | null;
  evidence_photos: string[] | null;
  return_reason: string | null;
  arrival_item_id: string | null;
  receiving_batch_id: string | null;
  /* 批次内排序（对照纸质销售单）；配件级运单关联 */
  sort_order: number;
  waybill_id: string | null;
  /* 采购单反查：配件级没关联运单时回退到单头运单 */
  purchase_orders: { waybill_id: string | null; order_no: string | null } | null;
}

/* 批次关联运单 + 运费分摊进度（剩余 = 运单总运费 − 已完成入库单已分摊之和） */
export interface 批次运单 {
  id: string;
  tracking_no: string | null;
  logistics_company_name: string | null;
  freight_amount: number | null;
  已分摊: number;
  剩余: number;
}

/* 批次卡片：一张供应商销售单一张卡片 */
export interface 批次卡片 {
  id: string;
  batch_no: string;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_order_no: string | null;
  status: string;
  created_at: string;
  items: 批次配件行[];
  waybills: 批次运单[];
  /* 批次关联运单（2026-09-09 批次卡单运单）：一张卡只挂一张，卡片上可变更；
     NULL 时 waybills 回退配件行派生（旧数据/行运单不一致兜底） */
  waybill_id: string | null;
  /* 入库确认单（2026-09-08 两阶段入库）：已生成 draft 时带出，卡片按钮变「待确认 →」 */
  draft_inbound_id: string | null;
  draft_inbound_no: string | null;
}

/* 把单张运单组装成 批次运单（带分摊进度）；运单不存在时返回 null */
function 组装批次运单(
  运单id: string,
  运单映射: Map<string, { tracking_no: string | null; logistics_company_name: string | null; freight_amount: number | null }>,
  已分摊映射: Map<string, number>
): 批次运单 | null {
  const 运单 = 运单映射.get(运单id);
  if (!运单) return null;
  const 已分摊 = Math.round((已分摊映射.get(运单id) || 0) * 100) / 100;
  const 剩余 = Math.round(((运单.freight_amount || 0) - 已分摊) * 100) / 100;
  return { id: 运单id, ...运单, 已分摊, 剩余 };
}

/* 查单个批次的关联运单（入库确认单编辑页换分摊运单用）：
   批次级 waybill_id 优先（2026-09-09 批次卡单运单），NULL 时回退配件行派生——
   配件级 waybill 优先、空则回退采购单单头，
   剩余 = 运单总运费 − 已完成入库单已分摊之和（不含 draft 占用，与确认时 RPC 口径一致） */
export async function 查询批次运单(supabase: SupabaseClient, 批次id: string): Promise<批次运单[]> {
  /* 先查批次级关联运单 */
  const { data: 批次 } = await supabase
    .from("receiving_batches")
    .select("waybill_id")
    .eq("id", 批次id)
    .maybeSingle();
  const 批次运单id = (批次 as { waybill_id: string | null } | null)?.waybill_id || null;

  let 运单id数组: string[];
  if (批次运单id) {
    运单id数组 = [批次运单id];
  } else {
    /* 批次未指定：回退配件行派生（配件级优先，空则回退采购单单头） */
    const { data: 行们 } = await supabase
      .from("purchase_order_items")
      .select("waybill_id, purchase_orders:order_id(waybill_id)")
      .eq("receiving_batch_id", 批次id);
    const 运单id集合 = new Set<string>();
    /* postgrest 联表按数组形态返回，取 [0] 兜底（与详情页查询同写法） */
    const 行列表 = ((行们 || []) as unknown) as { waybill_id: string | null; purchase_orders: { waybill_id: string | null }[] | { waybill_id: string | null } | null }[];
    for (const 行 of 行列表) {
      const 单头 = Array.isArray(行.purchase_orders) ? 行.purchase_orders[0] : 行.purchase_orders;
      const 运单id = 行.waybill_id || 单头?.waybill_id;
      if (运单id) 运单id集合.add(运单id);
    }
    运单id数组 = Array.from(运单id集合);
  }
  if (运单id数组.length === 0) return [];

  const { data: 运单们 } = await supabase
    .from("logistics_waybills")
    .select("id, tracking_no, logistics_company_name, freight_amount")
    .in("id", 运单id数组);
  const { data: 分摊们 } = await supabase
    .from("inbound_orders")
    .select("waybill_id, freight_amount")
    .in("waybill_id", 运单id数组)
    .eq("status", "completed");
  const 已分摊映射 = new Map<string, number>();
  for (const s of (分摊们 || []) as { waybill_id: string | null; freight_amount: number | null }[]) {
    if (!s.waybill_id) continue;
    已分摊映射.set(s.waybill_id, (已分摊映射.get(s.waybill_id) || 0) + (s.freight_amount || 0));
  }

  return ((运单们 || []) as { id: string; tracking_no: string | null; logistics_company_name: string | null; freight_amount: number | null }[]).map((w) => {
    const 已分摊 = Math.round((已分摊映射.get(w.id) || 0) * 100) / 100;
    const 剩余 = Math.round(((w.freight_amount || 0) - 已分摊) * 100) / 100;
    return { id: w.id, tracking_no: w.tracking_no, logistics_company_name: w.logistics_company_name, freight_amount: w.freight_amount, 已分摊, 剩余 };
  });
}

/* 查所有待入库批次卡片；失败或没有批次时返回空数组（调用方按空列表渲染即可） */export async function 查询批次卡片(supabase: SupabaseClient): Promise<批次卡片[]> {
  const { data: 批次们, error } = await supabase
    .from("receiving_batches")
    .select("id, batch_no, supplier_id, supplier_name, supplier_order_no, status, created_at, waybill_id")
    .eq("status", "pending_storage")
    .order("created_at", { ascending: false });
  if (error || !批次们 || 批次们.length === 0) return [];

  const 批次id数组 = (批次们 as { id: string }[]).map((b) => b.id);

  /* 入库确认单（draft）映射：批次 → 确认单（同批次最多一张，数据库唯一索引兜底） */
  const { data: 确认单们 } = await supabase
    .from("inbound_orders")
    .select("id, inbound_no, receiving_batch_id")
    .eq("status", "draft")
    .in("receiving_batch_id", 批次id数组);
  const 确认单映射 = new Map<string, { id: string; inbound_no: string }>();
  for (const d of (确认单们 || []) as { id: string; inbound_no: string; receiving_batch_id: string | null }[]) {
    if (d.receiving_batch_id) 确认单映射.set(d.receiving_batch_id, { id: d.id, inbound_no: d.inbound_no });
  }

  const { data: 行们 } = await supabase
    .from("purchase_order_items")
    .select(`
      id, name, brand, specification, quantity, unit_cost, received_qty,
      part_id, work_order_item_part_id, part_number, supplier_part_name,
      unit, category, license_plate, photos, notes, handle_action,
      discount_amount, evidence_photos, return_reason, arrival_item_id, receiving_batch_id,
      sort_order, waybill_id,
      purchase_orders:order_id(waybill_id, order_no)
    `)
    .in("receiving_batch_id", 批次id数组)
    .order("sort_order", { ascending: true });
  const 配件行们 = ((行们 || []) as unknown) as 批次配件行[];

  /* 收集关联运单（批次级 + 配件级优先/单头回退），去重后一次查运单 + 一次查已分摊 */
  const 运单id集合 = new Set<string>();
  for (const 批 of (批次们 as { waybill_id: string | null }[])) {
    if (批.waybill_id) 运单id集合.add(批.waybill_id);
  }
  for (const 行 of 配件行们) {
    const 运单id = 行.waybill_id || 行.purchase_orders?.waybill_id;
    if (运单id) 运单id集合.add(运单id);
  }
  const 运单id数组 = Array.from(运单id集合);

  const 运单映射 = new Map<string, { tracking_no: string | null; logistics_company_name: string | null; freight_amount: number | null }>();
  const 已分摊映射 = new Map<string, number>();
  if (运单id数组.length > 0) {
    const { data: 运单们 } = await supabase
      .from("logistics_waybills")
      .select("id, tracking_no, logistics_company_name, freight_amount")
      .in("id", 运单id数组);
    for (const w of (运单们 || []) as { id: string; tracking_no: string | null; logistics_company_name: string | null; freight_amount: number | null }[]) {
      运单映射.set(w.id, { tracking_no: w.tracking_no, logistics_company_name: w.logistics_company_name, freight_amount: w.freight_amount });
    }
    const { data: 分摊们 } = await supabase
      .from("inbound_orders")
      .select("waybill_id, freight_amount")
      .in("waybill_id", 运单id数组)
      .eq("status", "completed");
    for (const s of (分摊们 || []) as { waybill_id: string | null; freight_amount: number | null }[]) {
      if (!s.waybill_id) continue;
      已分摊映射.set(s.waybill_id, (已分摊映射.get(s.waybill_id) || 0) + (s.freight_amount || 0));
    }
  }

  return (批次们 as Omit<批次卡片, "items" | "waybills" | "draft_inbound_id" | "draft_inbound_no">[]).map((批) => {
    const items = 配件行们.filter((行) => 行.receiving_batch_id === 批.id);
    /* 批次级关联运单优先（2026-09-09 批次卡单运单）：已指定时只显示它；
       未指定（NULL）时回退配件行派生，保持配件行里出现的先后顺序 */
    const 本批运单 = new Map<string, 批次运单>();
    if (批.waybill_id) {
      const 运单 = 组装批次运单(批.waybill_id, 运单映射, 已分摊映射);
      if (运单) 本批运单.set(运单.id, 运单);
    } else {
      for (const 行 of items) {
        const 运单id = 行.waybill_id || 行.purchase_orders?.waybill_id;
        if (!运单id || 本批运单.has(运单id)) continue;
        const 运单 = 组装批次运单(运单id, 运单映射, 已分摊映射);
        if (运单) 本批运单.set(运单id, 运单);
      }
    }
    const 确认单 = 确认单映射.get(批.id) || null;
    return {
      ...批,
      items,
      waybills: Array.from(本批运单.values()),
      draft_inbound_id: 确认单?.id || null,
      draft_inbound_no: 确认单?.inbound_no || null,
    };
  });
}

import { createClient } from "@/lib/supabase/server";

interface CacheEntry {
  data: WorkOrderDataResult;
  timestamp: number;
}

interface WorkOrderDataResult {
  order: unknown;
  requirements: unknown[] | null;
  profiles: unknown[] | null;
  requirementMedia: unknown[];
  items: unknown[] | null;
  itemsError: unknown;
  itemMedia: unknown[];
  itemMechanics: unknown[];
  mechanicGroups: unknown[] | null;
  knowledgeLinks: unknown[];
  itemParts: unknown[] | null;
  partMedia: unknown[] | null;
  pickingRecords: unknown[] | null;
  returnRecords: unknown[] | null;
  supplierReturnRecords: unknown[] | null;
  partBatches: unknown[] | null;
  qualityChecks: unknown[] | null;
  payments: unknown[] | null;
  advancePaymentRecords: unknown[] | null;
  followUps: unknown[] | null;
  history: unknown[] | null;
  suppliers: unknown[] | null;
  logisticsCompanies: unknown[] | null;
  inspections: unknown[] | null;
  inspectionMedia: unknown[];
  outsourceOrder: unknown | null;
  historyOrderCount: number | null;
  otherOrdersByType: unknown[] | null;
  customerOrderCount: number | null;
}

const cache: Record<string, CacheEntry> = {};
const CACHE_TTL = 30000; // 30秒缓存，减少短时间内重复查询
const MAX_CACHE_SIZE = 50; // 限制缓存条目数，防止内存泄漏

export function clearWorkOrderDataCache(id?: string) {
  if (id) {
    delete cache[id];
  } else {
    Object.keys(cache).forEach((key) => delete cache[key]);
  }
}

export async function getWorkOrderData(id: string) {
  if (cache[id] && Date.now() - cache[id].timestamp < CACHE_TTL) {
    return cache[id].data;
  }

  const supabase = await createClient();

  // ── 第一趟（并行）：工单本身 + 全局数据 + 所有只需工单ID的关联数据 ──
  // 说明：以下查询要么不依赖任何ID，要么只依赖一开始就已知的工单ID(id)，
  // 因此全部合并到第一趟一次性并行发出，无需等待工单查询返回。
  const [
    { data: order, error: orderError },
    { data: profiles },
    { data: mechanicGroups },
    { data: suppliers },
    { data: logisticsCompanies },
    { data: outsourceOrder },
    { data: requirements },
    { data: items, error: itemsError },
    { data: inspections },
    { data: qualityChecks },
    { data: payments },
    { data: advancePaymentRecords },
    { data: followUps },
    { data: history },
  ] = await Promise.all([
    supabase.from("work_orders").select(`*, vehicles(*, vehicle_models(*)), customers(*)`).eq("id", id).single(),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase.from("mechanic_groups").select("*, mechanic_group_members(mechanic_id, profiles(full_name))"),
    supabase.from("suppliers").select("id, name").order("name"),
    supabase.from("logistics_companies").select("id, name").order("name"),
    supabase
      .from("outsource_orders")
      .select("id, order_no, is_paid, created_at, suppliers(name), outsource_order_items(id, work_order_item_id, service_item_id, service_name, amount)")
      .eq("work_order_id", id)
      .maybeSingle(),

    supabase.from("work_order_requirements").select(`
      *,
      submitted_by_profile:profiles!work_order_requirements_submitted_by_fkey(full_name),
      assigned_to_profile:profiles!work_order_requirements_assigned_to_fkey(full_name),
      dispatcher_profile:profiles!work_order_requirements_dispatcher_id_fkey(full_name),
      work_order_requirement_media(id, requirement_id, storage_path, media_type)
    `).eq("work_order_id", id).order("seq", { ascending: true }),

    supabase.from("work_order_items").select(`
      *,
      profiles!work_order_items_mechanic_id_fkey(full_name),
      service_items(sales_commission_type, sales_commission_value, diagnosis_commission_type, diagnosis_commission_value, repair_commission_type, repair_commission_value, qc_commission_type, qc_commission_value),
      outsourced_supplier:suppliers(name),
      work_order_item_media(id, work_order_item_id, storage_path, media_type),
      work_order_item_mechanics(work_order_item_id, mechanic_id, share_pct, profiles(full_name)),
      outsource_order_items(id, work_order_item_id, service_name, amount)
    `).eq("work_order_id", id).order("sort_order", { ascending: true }).order("created_at", { ascending: true }),

    supabase.from("work_order_inspections").select(`
      *,
      work_order_inspection_media(id, inspection_id, storage_path, media_type, annotations)
    `).eq("work_order_id", id).order("created_at", { ascending: true }),

    supabase.from("quality_checks").select("*, profiles(full_name)").eq("work_order_id", id).order("created_at", { ascending: true }),
    supabase.from("payments").select("id, method, amount, paid_at").eq("work_order_id", id).order("paid_at", { ascending: true }),
    supabase.from("advance_payment_records").select("*, profiles(full_name)").eq("work_order_id", id).order("paid_at", { ascending: true }),
    supabase.from("follow_ups").select("id, scheduled_at, completed_at, method, result, notes").eq("work_order_id", id).order("scheduled_at", { ascending: true }),
    supabase.from("work_order_history").select("id, from_status, to_status, created_at").eq("work_order_id", id).order("created_at", { ascending: true }),
  ]);

  if (orderError) {
    console.error("[workOrderData] order query error:", orderError.message, "code:", orderError.code);
  }

  // 提取第一趟结果中的关联 ID，供第二趟使用
  const vehicleId = (order as Record<string, unknown> | null)?.vehicle_id as string | undefined;
  const customerId = (order as Record<string, unknown> | null)?.customer_id as string | undefined;
  const vehicleModelId = (order as Record<string, unknown> | null)?.vehicles ? ((order as Record<string, unknown>).vehicles as Record<string, unknown> | undefined)?.vehicle_model_id as string | undefined : undefined;
  const itemIds = items?.map((i: unknown) => (i as Record<string, unknown>).id as string) || [];
  const serviceItemIds = [...new Set(items?.map((i: unknown) => (i as Record<string, unknown>).service_item_id as string).filter(Boolean) || [])];
  const serviceNameIds = [...new Set(items?.map((i: unknown) => ((i as Record<string, unknown>).service_items as Record<string, unknown> | undefined)?.service_name_id as string).filter(Boolean) || [])];
  const knowledgeConditions = [
    ...serviceItemIds.map((sid: string) => `service_item_id.eq.${sid}`),
    ...serviceNameIds.map((sid: string) => `service_name_id.eq.${sid}`),
  ];

  // ── 第二趟（并行）：依赖第一趟结果的查询一次性发出 ──
  // 配件分支(依赖项目ID)、知识库关联(依赖项目)、车型指导文章(依赖车型ID)、3个统计数(依赖车辆/客户ID)
  const [
    { data: itemParts },
    { data: knowledgeLinksRaw },
    { data: vlinks },
    { count: historyOrderCount },
    { data: otherOrdersByType },
    { count: customerOrderCount },
  ] = await Promise.all([
    itemIds.length > 0
      ? supabase.from("work_order_item_parts").select(`
          *,
          part_names(name, unit, category_id, part_categories(name), sales_commission_type, sales_commission_value, diagnosis_commission_type, diagnosis_commission_value, repair_commission_type, repair_commission_value, qc_commission_type, qc_commission_value, picking_commission_type, picking_commission_value),
          parts(*, part_categories(name), part_brands(name))
        `).in("work_order_item_id", itemIds).order("sort_order", { ascending: true }).order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),

    knowledgeConditions.length > 0
      ? supabase.from("knowledge_service_links").select(`
          article_id, service_item_id, service_name_id,
          knowledge_articles(id, title, type, category_id, knowledge_categories(name))
        `).or(knowledgeConditions.join(","))
      : Promise.resolve({ data: [] }),

    vehicleModelId
      ? supabase.from("knowledge_vehicle_links").select("article_id").eq("vehicle_model_id", vehicleModelId)
      : Promise.resolve({ data: [] }),

    // 同车辆历史工单数（排除当前工单）
    vehicleId
      ? supabase.from("work_orders").select("*", { count: "exact", head: true }).eq("vehicle_id", vehicleId).neq("id", id)
      : Promise.resolve({ count: 0 }),
    // 同车辆其他类型工单列表
    vehicleId
      ? supabase.from("work_orders").select("id, order_no, order_type").eq("vehicle_id", vehicleId).neq("id", id)
      : Promise.resolve({ data: [] }),
    // 同客户消费次数
    customerId
      ? supabase.from("work_orders").select("*", { count: "exact", head: true }).eq("customer_id", customerId)
      : Promise.resolve({ count: 0 }),
  ]);

  // 从嵌套查询结果中提取关联数据，保持与原有数据结构一致
  // 从嵌套查询结果中提取关联数据
  const requirementMedia: unknown[] = [];
  const itemMedia: unknown[] = [];
  const itemMechanics: unknown[] = [];
  const inspectionMedia: unknown[] = [];

  requirements?.forEach((req: unknown) => {
    const r = req as Record<string, unknown>;
    if (r.work_order_requirement_media) {
      requirementMedia.push(...(r.work_order_requirement_media as unknown[]));
      delete r.work_order_requirement_media;
    }
  });

  items?.forEach((item: unknown) => {
    const it = item as Record<string, unknown>;
    if (it.work_order_item_media) {
      itemMedia.push(...(it.work_order_item_media as unknown[]));
      delete it.work_order_item_media;
    }
    if (it.work_order_item_mechanics) {
      itemMechanics.push(...(it.work_order_item_mechanics as unknown[]));
      delete it.work_order_item_mechanics;
    }
  });

  inspections?.forEach((insp: unknown) => {
    const i = insp as Record<string, unknown>;
    if (i.work_order_inspection_media) {
      inspectionMedia.push(...(i.work_order_inspection_media as unknown[]));
      delete i.work_order_inspection_media;
    }
  });

  // ── 第三趟（并行）：依赖配件分支ID(itemPartIds)的查询 ──
  const itemPartIds = itemParts?.map((p: unknown) => (p as Record<string, unknown>).id as string) || [];
  const partIds = itemParts?.map((p: unknown) => (p as Record<string, unknown>).part_id as string).filter(Boolean) || [];

  const [
    { data: partMedia },
    { data: pickingRecords },
    { data: returnRecords },
    { data: supplierReturnRecords },
    { data: partBatches },
  ] = await Promise.all([
    itemPartIds.length > 0 ? supabase.from("work_order_item_part_media").select("id, work_order_item_part_id, storage_path, media_type").in("work_order_item_part_id", itemPartIds) : Promise.resolve({ data: [] }),
    itemPartIds.length > 0 ? supabase.from("part_picking_records").select("work_order_item_part_id, quantity").in("work_order_item_part_id", itemPartIds) : Promise.resolve({ data: [] }),
    itemPartIds.length > 0 ? supabase.from("part_return_records").select("work_order_item_part_id, quantity").in("work_order_item_part_id", itemPartIds) : Promise.resolve({ data: [] }),
    itemPartIds.length > 0 ? supabase.from("supplier_return_records").select("work_order_item_part_id, status").in("work_order_item_part_id", itemPartIds) : Promise.resolve({ data: [] }),
    partIds.length > 0 ? supabase.from("part_batches").select("part_id, quantity").in("part_id", partIds) : Promise.resolve({ data: [] }),
  ]);

  // knowledge links 过滤（数据已在第二趟查出，此处仅做内存过滤，无网络请求）
  // 维修指导类型(guide)或分类为"维修指导"的文章需要同时匹配车型
  const guideArticleIds = (vlinks || []).map((v: unknown) => (v as Record<string, unknown>).article_id as string);
  const knowledgeLinks = (knowledgeLinksRaw || []).filter((link: unknown) => {
    const l = link as Record<string, unknown>;
    const article = l.knowledge_articles as Record<string, unknown> | undefined;
    const articleType = article?.type;
    const categoryName = (article?.knowledge_categories as Record<string, unknown> | undefined)?.name;
    const needsVehicleMatch = articleType === "guide" || categoryName === "维修指导";
    if (!needsVehicleMatch) return true; // 非维修指导不需要车型匹配
    return guideArticleIds.includes(l.article_id as string);
  });

  const result = {
    order, requirements, profiles, requirementMedia, items, itemsError,
    itemMedia, itemMechanics, mechanicGroups, knowledgeLinks, itemParts,
    partMedia, pickingRecords, returnRecords, supplierReturnRecords, partBatches,
    qualityChecks, payments, advancePaymentRecords, followUps, history, suppliers, logisticsCompanies,
    inspections, inspectionMedia, outsourceOrder,
    historyOrderCount: historyOrderCount ?? null,
    otherOrdersByType: otherOrdersByType ?? null,
    customerOrderCount: customerOrderCount ?? null,
  };

  // 写入缓存前检查大小限制，超出则淘汰最旧条目
  const keys = Object.keys(cache);
  if (keys.length >= MAX_CACHE_SIZE) {
    const oldest = keys.reduce((a, b) => (cache[a].timestamp < cache[b].timestamp ? a : b));
    delete cache[oldest];
  }
  cache[id] = { data: result, timestamp: Date.now() };
  return result;
}

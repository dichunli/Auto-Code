import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const cache: Record<string, { data: any; timestamp: number }> = {};
const CACHE_TTL = 2000; // 2秒缓存，减少短时间内重复查询
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

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // 在 Server Component 中 set cookie 会报错，忽略即可
          }
        },
      },
    }
  );

  // 第一批：全局数据 + 工单基本信息（互相独立，并行查询）
  const [
    { data: order },
    { data: profiles },
    { data: mechanicGroups },
    { data: suppliers },
    { data: logisticsCompanies },
  ] = await Promise.all([
    supabase.from("work_orders").select(`*, vehicles(*, vehicle_models(*)), customers(*)`).eq("id", id).single(),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase.from("mechanic_groups").select("*, mechanic_group_members(mechanic_id, profiles(full_name))"),
    supabase.from("suppliers").select("*").order("name"),
    supabase.from("logistics_companies").select("*").order("name"),
  ]);

  // 第二批：工单关联数据（嵌套查询减少 HTTP 请求次数）
  const [
    { data: requirements },
    { data: items, error: itemsError },
    { data: inspections },
    { data: qualityChecks },
    { data: payments },
    { data: advancePaymentRecords },
    { data: followUps },
    { data: history },
  ] = await Promise.all([
    supabase.from("work_order_requirements").select(`
      *,
      submitted_by_profile:profiles!work_order_requirements_submitted_by_fkey(full_name),
      assigned_to_profile:profiles!work_order_requirements_assigned_to_fkey(full_name),
      dispatcher_profile:profiles!work_order_requirements_dispatcher_id_fkey(full_name),
      work_order_requirement_media(*)
    `).eq("work_order_id", id).order("seq", { ascending: true }),

    supabase.from("work_order_items").select(`
      *,
      profiles!work_order_items_mechanic_id_fkey(full_name),
      service_items(service_name_id, sales_commission_type, sales_commission_value, diagnosis_commission_type, diagnosis_commission_value, repair_commission_type, repair_commission_value, qc_commission_type, qc_commission_value, service_names(sales_commission_type, sales_commission_value, diagnosis_commission_type, diagnosis_commission_value, repair_commission_type, repair_commission_value, qc_commission_type, qc_commission_value)),
      outsourced_supplier:suppliers(name),
      work_order_item_media(*),
      work_order_item_mechanics(work_order_item_id, mechanic_id, share_pct, profiles(full_name))
    `).eq("work_order_id", id).order("sort_order", { ascending: true }),

    supabase.from("work_order_inspections").select(`
      *,
      work_order_inspection_media(*)
    `).eq("work_order_id", id).order("created_at", { ascending: true }),

    supabase.from("quality_checks").select("*, profiles(full_name)").eq("work_order_id", id).order("created_at", { ascending: true }),
    supabase.from("payments").select("*").eq("work_order_id", id).order("paid_at", { ascending: true }),
    supabase.from("advance_payment_records").select("*, profiles(full_name)").eq("work_order_id", id).order("paid_at", { ascending: true }),
    supabase.from("follow_ups").select("*").eq("work_order_id", id).order("scheduled_at", { ascending: true }),
    supabase.from("work_order_history").select("*").eq("work_order_id", id).order("created_at", { ascending: true }),
  ]);

  // 从嵌套查询结果中提取关联数据，保持与原有数据结构一致
  // 从嵌套查询结果中提取关联数据
  const requirementMedia: any[] = [];
  const itemMedia: any[] = [];
  const itemMechanics: any[] = [];
  const inspectionMedia: any[] = [];

  requirements?.forEach((req: any) => {
    if (req.work_order_requirement_media) {
      requirementMedia.push(...req.work_order_requirement_media);
      delete req.work_order_requirement_media;
    }
  });

  items?.forEach((item: any) => {
    if (item.work_order_item_media) {
      itemMedia.push(...item.work_order_item_media);
      delete item.work_order_item_media;
    }
    if (item.work_order_item_mechanics) {
      itemMechanics.push(...item.work_order_item_mechanics);
      delete item.work_order_item_mechanics;
    }
  });

  inspections?.forEach((insp: any) => {
    if (insp.work_order_inspection_media) {
      inspectionMedia.push(...insp.work_order_inspection_media);
      delete insp.work_order_inspection_media;
    }
  });

  // 第三批：配件分支（从 items 查询中拆分，避免单次查询数据量过大）
  const itemIds = items?.map((i: any) => i.id) || [];
  const { data: itemParts } = itemIds.length > 0
    ? await supabase.from("work_order_item_parts").select(`
        *,
        part_names(name, unit, category_id, part_categories(name), sales_commission_type, sales_commission_value, diagnosis_commission_type, diagnosis_commission_value, repair_commission_type, repair_commission_value, qc_commission_type, qc_commission_value, picking_commission_type, picking_commission_value),
        parts(*, part_categories(name), part_brands(name))
      `).in("work_order_item_id", itemIds).order("sort_order", { ascending: true })
    : { data: [] };

  // 第四批：依赖 itemParts 的 ID（并行查询）
  const itemPartIds = itemParts?.map((p: any) => p.id) || [];
  const partIds = itemParts?.map((p: any) => p.part_id).filter(Boolean) || [];

  const [
    { data: partMedia },
    { data: pickingRecords },
    { data: returnRecords },
    { data: supplierReturnRecords },
    { data: partBatches },
  ] = await Promise.all([
    itemPartIds.length > 0 ? supabase.from("work_order_item_part_media").select("*").in("work_order_item_part_id", itemPartIds) : Promise.resolve({ data: [] }),
    itemPartIds.length > 0 ? supabase.from("part_picking_records").select("*").in("work_order_item_part_id", itemPartIds) : Promise.resolve({ data: [] }),
    itemPartIds.length > 0 ? supabase.from("part_return_records").select("*").in("work_order_item_part_id", itemPartIds) : Promise.resolve({ data: [] }),
    itemPartIds.length > 0 ? supabase.from("supplier_return_records").select("*").in("work_order_item_part_id", itemPartIds) : Promise.resolve({ data: [] }),
    partIds.length > 0 ? supabase.from("part_batches").select("part_id, quantity").in("part_id", partIds) : Promise.resolve({ data: [] }),
  ]);

  // knowledge links（依赖 items 的结果，合并为单次查询减少 HTTP 请求）
  const serviceItemIds = [...new Set(items?.map((i: any) => i.service_item_id).filter(Boolean) || [])];
  const serviceNameIds = [...new Set(items?.map((i: any) => i.service_items?.service_name_id).filter(Boolean) || [])];
  let knowledgeLinks: any[] = [];
  const knowledgeConditions = [
    ...serviceItemIds.map((sid: string) => `service_item_id.eq.${sid}`),
    ...serviceNameIds.map((sid: string) => `service_name_id.eq.${sid}`),
  ];
  if (knowledgeConditions.length > 0) {
    const { data: links } = await supabase
      .from("knowledge_service_links")
      .select("article_id, service_item_id, service_name_id, knowledge_articles(id, title, type)")
      .or(knowledgeConditions.join(","));
    knowledgeLinks = links || [];
  }

  // 获取车型关联的文章ID（维修指导类型需要同时匹配车型）
  const vehicleModelId = order?.vehicles?.vehicle_model_id;
  let guideArticleIds: string[] = [];
  if (vehicleModelId) {
    const { data: vlinks } = await supabase
      .from("knowledge_vehicle_links")
      .select("article_id")
      .eq("vehicle_model_id", vehicleModelId);
    guideArticleIds = (vlinks || []).map((v: any) => v.article_id);
  }

  // 过滤：维修指导类型(guide)需要同时匹配车型
  knowledgeLinks = knowledgeLinks.filter((link: any) => {
    const articleType = link.knowledge_articles?.type;
    if (articleType !== "guide") return true; // 非维修指导类型不需要车型匹配
    return guideArticleIds.includes(link.article_id);
  });

  const result = {
    order, requirements, profiles, requirementMedia, items, itemsError,
    itemMedia, itemMechanics, mechanicGroups, knowledgeLinks, itemParts,
    partMedia, pickingRecords, returnRecords, supplierReturnRecords, partBatches,
    qualityChecks, payments, advancePaymentRecords, followUps, history, suppliers, logisticsCompanies,
    inspections, inspectionMedia,
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

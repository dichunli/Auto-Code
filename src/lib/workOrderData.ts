import { cache } from "react";
import { createClient } from "@/lib/supabase/server";


// ── 工单关联的车型（vehicle_models 表，字段名为中文）──
export interface 车型信息 {
  id?: string;
  排量?: string | null;
  变速箱类型?: string | null;
  年份?: string | null;
  vehicle_model_id?: string | null;
  [key: string]: unknown;
}

// ── 工单关联的车辆 ──
export interface 车辆信息 {
  id?: string;
  plate_number?: string | null;
  brand?: string | null;
  model?: string | null;
  vin?: string | null;
  color?: string | null;
  engine_no?: string | null;
  vehicle_model_id?: string | null;
  vehicle_models?: 车型信息 | null;
  [key: string]: unknown;
}

// ── 工单关联的客户 ──
export interface 客户信息 {
  id?: string;
  name?: string | null;
  phone?: string | null;
  company?: string | null;
  star_level?: number | null;
  total_spent?: number | null;
  [key: string]: unknown;
}

// ── 工单主体 ──
export interface 工单信息 {
  id: string;
  order_no?: string | null;
  order_type?: string | null;
  status: string;
  description?: string | null;
  mileage_in?: number | null;
  estimated_completion_at?: string | null;
  created_at?: string | null;
  sender_name?: string | null;
  sender_phone?: string | null;
  dashboard_photos?: string[] | null;
  labor_cost?: number | null;
  parts_cost?: number | null;
  other_cost?: number | null;
  total_cost?: number | null;
  discount_amount?: number | null;
  vehicle_id?: string | null;
  customer_id?: string | null;
  vehicles?: 车辆信息 | null;
  customers?: 客户信息 | null;
  [key: string]: unknown;
}

// ── 维修项目（work_order_items），仅声明页面实际访问的字段，其余用索引签名兜底 ──
export interface 维修项目 {
  id: string;
  name?: string | null;
  description?: string | null;
  item_type?: string | null;
  business_type?: string | null;
  alias_name?: string | null;
  standard?: string | null;
  unit?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  total_price?: number | null;
  customer_opinion?: string | null;
  rework_reason?: string | null;
  rework_loss_amount?: number | null;
  rework_source_item_id?: string | null;
  requirement_id?: string | null;
  service_item_id?: string | null;
  mechanic_id?: string | null;
  submitter_id?: string | null;
  inspector_id?: string | null;
  is_outsourced?: boolean | null;
  is_customer_part?: boolean | null;
  sort_order?: number | null;
  created_at?: string | null;
  service_items?: { id?: string | null; [key: string]: unknown } | null;
  outsource_order_items?: unknown[] | null;
  [key: string]: unknown;
}

// ── 配件分支（work_order_item_parts），仅声明页面实际访问的字段 ──
export interface 配件分支 {
  id: string;
  work_order_item_id?: string | null;
  part_id?: string | null;
  part_name_id?: string | null;
  name?: string | null;
  alias_name?: string | null;
  brand?: string | null;
  specification?: string | null;
  part_number?: string | null;
  unit?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  unit_cost?: number | null;
  total_price?: number | null;
  amount?: number | null;
  method?: string | null;
  notes?: string | null;
  supplier_name?: string | null;
  logistics_agreement?: string | null;
  customer_opinion?: string | null;
  is_arrived?: boolean | null;
  is_selected?: boolean | null;
  is_purchased?: boolean | null;
  sort_order?: number | null;
  created_at?: string | null;
  parts?: { name?: string | null; [key: string]: unknown } | null;
  part_names?: { name?: string | null; unit?: string | null; [key: string]: unknown } | null;
  [key: string]: unknown;
}

interface WorkOrderDataResult {
  order: 工单信息 | null;
  requirements: unknown[] | null;
  profiles: unknown[] | null;
  requirementMedia: unknown[];
  items: 维修项目[] | null;
  itemsError: unknown;
  itemMedia: unknown[];
  itemMechanics: unknown[];
  mechanicGroups: unknown[] | null;
  knowledgeLinks: unknown[];
  itemParts: 配件分支[] | null;
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

/* ═══════════════════════════════════════════════════════════════════
 * 缓存策略说明（重要）
 *
 * 这里用 React 的 cache()，作用域是「单次请求」：同一次页面渲染中若多次
 * 调用 getWorkOrderData(id) 只会真正查询一次，请求结束后自动失效。
 *
 * 为什么不再用「30 秒跨请求缓存」：
 * 工单详情页是边看边改的场景（改备注/价格/配件/派工/状态等）。旧的 30 秒
 * 缓存会导致保存后 30 秒内重新加载仍显示旧数据 —— 这是数据正确性隐患。
 * 改用请求级缓存后，每个新请求都拿最新数据，保存后刷新即可看到最新值，
 * 无需各写操作组件再手动清缓存。
 * ═══════════════════════════════════════════════════════════════════ */

/* 保留此导出仅为兼容历史调用（actions.ts 等）。请求级缓存无需手动清除，
 * 这里实现为安全的空操作，避免调用方报错。 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function clearWorkOrderDataCache(_id?: string) {
  /* no-op：React cache() 在请求结束后自动失效，无需手动清理 */
}

export const getWorkOrderData = cache(async function getWorkOrderData(id: string): Promise<WorkOrderDataResult> {
  const supabase = await createClient();

  // ── 第一趟（并行）：工单本身 + 全局数据 + 所有只需工单ID的关联数据 ──
  // 说明：以下查询要么不依赖任何ID，要么只依赖一开始就已知的工单ID(id)，
  // 因此全部合并到第一趟一次性并行发出，无需等待工单查询返回。
  const [
    { data: order, error: orderError },
    { data: profiles },
    { data: employeeGroups },
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
    { data: itemPartsRaw },
  ] = await Promise.all([
    supabase.from("work_orders").select(`*, vehicles(*, vehicle_models(*)), customers(*)`).eq("id", id).single(),
    supabase.from("profiles").select("id, full_name, group_id, profile_roles(roles(name)), mechanic_levels(sort_order)").eq("is_active", true).order("full_name"),
    // 派工"按组派工"使用员工档案的真实分组(employee_groups)，组员来自 profiles.group_id。
    // 原读的 mechanic_groups 是另一套且无数据，导致按组派工空白。
    supabase.from("employee_groups").select("id, name").order("sort_order", { ascending: true }),
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
      diagnosis_submitter_profile:profiles!work_order_requirements_diagnosis_submitter_id_fkey(full_name),
      remarks_submitter_profile:profiles!work_order_requirements_remarks_submitter_id_fkey(full_name),
      assigned_to_profile:profiles!work_order_requirements_assigned_to_fkey(full_name),
      dispatcher_profile:profiles!work_order_requirements_dispatcher_id_fkey(full_name),
      work_order_requirement_media(id, requirement_id, storage_path, media_type)
    `).eq("work_order_id", id).order("seq", { ascending: true }),

    supabase.from("work_order_items").select(`
      *,
      profiles!work_order_items_mechanic_id_fkey(full_name),
      service_items(id, sales_commission_type, sales_commission_value, diagnosis_commission_type, diagnosis_commission_value, repair_commission_type, repair_commission_value, qc_commission_type, qc_commission_value),
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

    // 配件分支：直接经 work_order_items 关联按工单ID过滤，无需等项目ID，故并入第一趟。
    // !inner 保证只取属于本工单的配件，与旧的 .in(itemIds) 口径完全一致。
    supabase.from("work_order_item_parts").select(`
        *,
        part_names(name, unit, category_id, part_categories(name), sales_commission_type, sales_commission_value, diagnosis_commission_type, diagnosis_commission_value, repair_commission_type, repair_commission_value, qc_commission_type, qc_commission_value, picking_commission_type, picking_commission_value),
        parts(*, part_categories(name), part_brands(name)),
        work_order_items!inner(work_order_id)
      `).eq("work_order_items.work_order_id", id).order("sort_order", { ascending: true }).order("created_at", { ascending: true }).order("id", { ascending: true }),
  ]);

  if (orderError) {
    console.error("[workOrderData] order query error:", orderError.message, "code:", orderError.code);
  }

  // 组ID → 组名 映射（用于给员工附上组名，供派工按人排序）
  const 组名Map = new Map(((employeeGroups as { id: string; name: string }[] | null) || []).map((g) => [g.id, g.name]));

  // 给每个员工附加：是否技师(含 mechanic 角色)、组名。供派工"按人派工"排序用。
  // 直接写回 profiles 对象（extra 字段对其它使用方无害）。
  type ProfileRaw = { id: string; full_name: string; group_id?: string | null; profile_roles?: { roles?: { name?: string } | null }[] | null; mechanic_levels?: { sort_order?: number } | null; is_mechanic?: boolean; group_name?: string | null; level_sort?: number };
  const 全部员工 = (profiles as ProfileRaw[] | null) || [];
  全部员工.forEach((p) => {
    p.is_mechanic = (p.profile_roles || []).some((pr) => pr.roles?.name === "mechanic");
    p.group_name = p.group_id ? (组名Map.get(p.group_id) || null) : null;
    // 技师等级 sort_order：越大等级越高；无等级给 -1（排最后）
    p.level_sort = typeof p.mechanic_levels?.sort_order === "number" ? p.mechanic_levels.sort_order : -1;
  });

  // 把员工分组(employee_groups)组装成派工弹窗需要的形状：
  // { id, name, mechanic_group_members: [{ mechanic_id, profiles:{full_name} }] }
  // 组员 = profiles 中 group_id 指向该组的在职员工。空组不显示。
  const mechanicGroups = ((employeeGroups as { id: string; name: string }[] | null) || [])
    .map((g) => ({
      id: g.id,
      name: g.name,
      mechanic_group_members: 全部员工
        .filter((p) => p.group_id === g.id)
        .map((p) => ({ mechanic_id: p.id, profiles: { full_name: p.full_name } })),
    }))
    .filter((g) => g.mechanic_group_members.length > 0);

  // 提取第一趟结果中的关联 ID，供第二趟使用
  const vehicleId = (order as Record<string, unknown> | null)?.vehicle_id as string | undefined;
  const customerId = (order as Record<string, unknown> | null)?.customer_id as string | undefined;
  const vehicleModelId = (order as Record<string, unknown> | null)?.vehicles ? ((order as Record<string, unknown>).vehicles as Record<string, unknown> | undefined)?.vehicle_model_id as string | undefined : undefined;
  const serviceItemIds = [...new Set(items?.map((i: unknown) => (i as Record<string, unknown>).service_item_id as string).filter(Boolean) || [])];
  const knowledgeConditions = serviceItemIds.map((sid: string) => `service_item_id.eq.${sid}`);

  // 剥掉仅用于过滤的关联字段，保持配件行数据结构与旧版一致
  const itemParts = (itemPartsRaw as Record<string, unknown>[] | null)?.map((p) => {
    if (p.work_order_items !== undefined) delete p.work_order_items;
    return p;
  }) ?? [];

  // 配件分支ID / 库存配件ID：配件已在第一趟查出，这些依赖它的查询即可提到第二趟
  const itemPartIds = itemParts.map((p) => p.id as string);
  const partIds = itemParts.map((p) => p.part_id as string).filter(Boolean);

  // ── 第二趟（并行）：合并原第二趟(知识库/统计)与原第三趟(媒体/领料/退料/库存)。
  // 因配件已在第一趟拿到，两批查询的依赖此刻都已就绪，可一次性并行发出，省一次远程往返。──
  const [
    { data: knowledgeLinksRaw },
    { data: vlinks },
    { count: historyOrderCount },
    { data: otherOrdersByType },
    { count: customerOrderCount },
    { data: partMedia },
    { data: pickingRecords },
    { data: returnRecords },
    { data: supplierReturnRecords },
    { data: partBatches },
  ] = await Promise.all([
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

    // ↓ 原第三趟：依赖配件分支ID / 库存配件ID
    itemPartIds.length > 0 ? supabase.from("work_order_item_part_media").select("id, work_order_item_part_id, storage_path, media_type").in("work_order_item_part_id", itemPartIds) : Promise.resolve({ data: [] }),
    itemPartIds.length > 0 ? supabase.from("part_picking_records").select("work_order_item_part_id, quantity").in("work_order_item_part_id", itemPartIds) : Promise.resolve({ data: [] }),
    itemPartIds.length > 0 ? supabase.from("part_return_records").select("work_order_item_part_id, quantity").in("work_order_item_part_id", itemPartIds) : Promise.resolve({ data: [] }),
    itemPartIds.length > 0 ? supabase.from("supplier_return_records").select("work_order_item_part_id, status").in("work_order_item_part_id", itemPartIds) : Promise.resolve({ data: [] }),
    partIds.length > 0 ? supabase.from("part_batches").select("part_id, quantity").in("part_id", partIds) : Promise.resolve({ data: [] }),
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

  // ── 内存过滤：knowledge links（数据已在第二趟查出，此处仅内存处理，无网络请求）──
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

  return result;
});

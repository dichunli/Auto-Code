import { calculateItemCommission, calculatePartCommission } from "@/lib/commission";

/**
 * 工单详情页「数据加工」——把 getWorkOrderData 查出的零散数据，
 * 分组、排序、聚合、预计算成页面可直接渲染的结构。
 *
 * 说明：本文件是从 work-orders/[id]/page.tsx 顶部原样搬迁的纯计算逻辑，
 * 不含任何渲染。逻辑与原页面保持一致，便于单独编写单元测试。
 */

// ── 下列接口由页面 JSX 复用，统一在此导出 ──
export interface ItemPart {
  work_order_item_id: string;
  sort_order?: number;
  [key: string]: unknown;
}

export interface SortableRecord {
  sort_order?: number;
  [key: string]: unknown;
}

export interface MediaRecord {
  requirement_id?: string;
  work_order_item_id?: string;
  work_order_item_part_id?: string;
  inspection_id?: string;
  storage_path?: string;
  media_type?: string;
  [key: string]: unknown;
}

export interface RequirementItem {
  id: string;
  requirement_id?: string | null;
  [key: string]: unknown;
}

export interface InspectionRecord {
  id: string;
  inspection_type?: string;
  [key: string]: unknown;
}

export interface PartBranch {
  id: string;
  part_name_id?: string | null;
  branch_group_id?: string | null;
  alias_name?: string;
  parts?: { name?: string } | null;
  name?: string;
  part_names?: { name?: string } | null;
  sort_order?: number;
  [key: string]: unknown;
}

export interface PartGroupInfo {
  name: string;
  parts: PartBranch[];
  repId: string;
  repSort: number;
  extraIds: string[];
  images: string[];
}

// ── 内部计算用到的零散记录形状 ──
interface BatchRecord { part_id?: string; quantity?: number; [key: string]: unknown }
interface PickingRecord { work_order_item_part_id?: string; quantity?: number; [key: string]: unknown }
interface ReturnRecord { work_order_item_part_id?: string; quantity?: number; [key: string]: unknown }
interface SupplierReturnRecord { work_order_item_part_id?: string; status?: string; [key: string]: unknown }
interface KnowledgeLink {
  service_item_id?: string;
  knowledge_articles?: { id?: string } | null;
  [key: string]: unknown;
}
interface WorkOrderItem {
  id: string;
  service_item_id?: string | null;
  service_items?: { id?: string | null } | null;
  [key: string]: unknown;
}

// ── 函数入参：getWorkOrderData 的结果（按页面实际访问的字段声明） ──
export interface WorkOrderViewInput {
  order: { vehicles?: { vehicle_model_id?: string; vin?: string } | null; status: string; [key: string]: unknown } | null;
  requirements: unknown[] | null;
  items: Array<{ id: string; service_item_id?: string | null; service_items?: unknown; total_price?: number; quantity?: number; unit_price?: number; unit_cost?: number; sort_order?: number; requirement_id?: string | null; [key: string]: unknown }> | null;
  itemMedia: unknown[];
  itemMechanics: Array<{ work_order_item_id: string; [key: string]: unknown }> | null;
  requirementMedia: unknown[];
  knowledgeLinks: unknown[];
  itemParts: Array<{ work_order_item_id: string; is_arrived?: boolean; part_id?: string | null; quantity?: number; unit_price?: number; unit_cost?: number; parts?: unknown; part_names?: unknown; sort_order?: number; created_at?: string; [key: string]: unknown }> | null;
  partMedia: unknown[] | null;
  pickingRecords: unknown[] | null;
  returnRecords: unknown[] | null;
  supplierReturnRecords: unknown[] | null;
  partBatches: unknown[] | null;
  inspections: unknown[] | null;
  inspectionMedia: unknown[];
  advancePaymentRecords: unknown[] | null;
  otherOrdersByType: unknown[] | null;
}

export function buildWorkOrderView(input: WorkOrderViewInput) {
  const {
    order, items, itemMedia, itemMechanics, requirementMedia, knowledgeLinks,
    itemParts, partMedia, pickingRecords, returnRecords, supplierReturnRecords,
    partBatches, inspections, advancePaymentRecords, otherOrdersByType,
  } = input;

  // 预收款净额（从记录表实时计算，扣除已退款）
  const advancePaymentTotal = (advancePaymentRecords || []).reduce(
    (sum: number, r: { amount?: number; refunded_amount?: number }) => sum + (r.amount || 0) - (r.refunded_amount || 0),
    0
  );

  // 工单车型ID（用于配件库存匹配）
  const vehicleModelId = order?.vehicles?.vehicle_model_id;
  // 工单VIN（用于查三滤）
  const vehicleVin = order?.vehicles?.vin;

  // 统计同车辆其他类型工单
  const typeCountMap: Record<string, { count: number; orders: { id: string; order_no: string }[] }> = {};
  const typeLabelMapForDisplay: Record<string, string> = {
    appointment: "预约工单",
    quote: "历史报价单",
    cancelled: "作废工单",
    maintenance: "保养工单",
  };
  (otherOrdersByType || []).forEach((o: { order_type?: string; id: string; order_no: string }) => {
    const t = o.order_type || "normal";
    if (t === "normal") return; // 正常工单不显示
    if (!typeCountMap[t]) {
      typeCountMap[t] = { count: 0, orders: [] };
    }
    typeCountMap[t].count++;
    typeCountMap[t].orders.push({ id: o.id, order_no: o.order_no });
  });

  // 查询未关联具体配件但已到货的分支，用于入库自动填写
  const pendingInboundParts = itemParts?.filter((p: { is_arrived?: boolean; part_id?: string | null }) => p.is_arrived && !p.part_id) || [];

  // 按项目分组施工人
  const mechanicsByItem: Record<string, unknown[]> = {};
  if (itemMechanics) {
    for (const m of itemMechanics) {
      const itemId = m.work_order_item_id;
      if (!mechanicsByItem[itemId]) mechanicsByItem[itemId] = [];
      mechanicsByItem[itemId].push(m);
    }
  }

  // 按项目分组配件，并按 sort_order 排序
  const partsByItem: Record<string, ItemPart[]> = {};
  itemParts?.forEach((p: ItemPart) => {
    if (!partsByItem[p.work_order_item_id]) partsByItem[p.work_order_item_id] = [];
    partsByItem[p.work_order_item_id].push(p);
  });
  Object.values(partsByItem).forEach((arr) => {
    arr.sort((a, b) => {
      const sortDiff = (a.sort_order || 0) - (b.sort_order || 0);
      if (sortDiff !== 0) return sortDiff;
      const timeA = a.created_at ? new Date(a.created_at as string).getTime() : 0;
      const timeB = b.created_at ? new Date(b.created_at as string).getTime() : 0;
      return (timeA || 0) - (timeB || 0);
    });
  });

  // items 按 sort_order 排序（兼容未执行迁移的情况）
  const sortedItems = (items || []).slice().sort((a: SortableRecord, b: SortableRecord) => (a.sort_order || 0) - (b.sort_order || 0));

  // 按需求分组多媒体
  const mediaByRequirement: Record<string, MediaRecord[]> = {};
  (requirementMedia as MediaRecord[] | null)?.forEach((m: MediaRecord) => {
    if (!mediaByRequirement[m.requirement_id!]) mediaByRequirement[m.requirement_id!] = [];
    mediaByRequirement[m.requirement_id!].push(m);
  });

  // 按项目分组图片
  const imagesByItem: Record<string, MediaRecord[]> = {};
  (itemMedia as MediaRecord[] | null)?.forEach((m: MediaRecord) => {
    if (!imagesByItem[m.work_order_item_id!]) imagesByItem[m.work_order_item_id!] = [];
    imagesByItem[m.work_order_item_id!].push(m);
  });

  // 按配件分支分组图片
  const imagesByPart: Record<string, MediaRecord[]> = {};
  (partMedia as MediaRecord[] | null)?.forEach((m: MediaRecord) => {
    if (!imagesByPart[m.work_order_item_part_id!]) imagesByPart[m.work_order_item_part_id!] = [];
    imagesByPart[m.work_order_item_part_id!].push(m);
  });

  // 按检查记录分组媒体
  const mediaByInspection: Record<string, MediaRecord[]> = {};
  (input.inspectionMedia as MediaRecord[] | null)?.forEach((m: MediaRecord) => {
    if (!mediaByInspection[m.inspection_id!]) mediaByInspection[m.inspection_id!] = [];
    mediaByInspection[m.inspection_id!].push(m);
  });

  // 配件库存聚合
  const inventoryByPart: Record<string, number> = {};
  (partBatches as BatchRecord[] | null)?.forEach((b: BatchRecord) => {
    inventoryByPart[b.part_id!] = (inventoryByPart[b.part_id!] || 0) + (b.quantity || 0);
  });

  // 领料 / 退库 / 退货聚合
  const pickingByPart: Record<string, number> = {};
  (pickingRecords as PickingRecord[] | null)?.forEach((r: PickingRecord) => {
    pickingByPart[r.work_order_item_part_id!] = (pickingByPart[r.work_order_item_part_id!] || 0) + (r.quantity || 0);
  });

  const returnByPart: Record<string, number> = {};
  (returnRecords as ReturnRecord[] | null)?.forEach((r: ReturnRecord) => {
    returnByPart[r.work_order_item_part_id!] = (returnByPart[r.work_order_item_part_id!] || 0) + (r.quantity || 0);
  });

  const pendingSupplierReturnByPart: Record<string, boolean> = {};
  (supplierReturnRecords as SupplierReturnRecord[] | null)?.forEach((r: SupplierReturnRecord) => {
    if (r.status === "pending") pendingSupplierReturnByPart[r.work_order_item_part_id!] = true;
  });

  // 按项目分组知识库文章（先建索引 + Set 去重，O(n+k)）
  const knowledgeByItem: Record<string, KnowledgeLink[]> = {};
  const itemIdsByServiceItemId: Record<string, string[]> = {};
  (items as WorkOrderItem[] | null)?.forEach((item: WorkOrderItem) => {
    if (item.service_item_id) {
      (itemIdsByServiceItemId[item.service_item_id] ||= []).push(item.id);
    }
  });
  const knowledgeSeen = new Set<string>();
  (knowledgeLinks as KnowledgeLink[] | null)?.forEach((link: KnowledgeLink) => {
    const matchedItemIds = new Set<string>();
    if (link.service_item_id) {
      (itemIdsByServiceItemId[link.service_item_id] || []).forEach((id) => matchedItemIds.add(id));
    }
    matchedItemIds.forEach((itemId) => {
      const key = `${itemId}:${link.knowledge_articles?.id}`;
      if (knowledgeSeen.has(key)) return;
      knowledgeSeen.add(key);
      (knowledgeByItem[itemId] ||= []).push(link);
    });
  });

  const isLocked = ["pending_settlement", "settled", "delivered"].includes(order?.status ?? "");

  // ========== 预计算：消除渲染时重复遍历和 O(m×n) 匹配 ==========

  // 1. 需求→项目映射（避免 requirements.map 内部反复 filter sortedItems）
  const itemsByRequirement = new Map<string, RequirementItem[]>();
  for (const item of sortedItems as RequirementItem[]) {
    if (item.requirement_id) {
      const arr = itemsByRequirement.get(item.requirement_id);
      if (arr) arr.push(item);
      else itemsByRequirement.set(item.requirement_id, [item]);
    }
  }

  // 2. inspections 预分组（避免重复 filter 4 次）
  const receptionInspections: InspectionRecord[] = [];
  const conditionInspections: InspectionRecord[] = [];
  for (const insp of (inspections || []) as InspectionRecord[]) {
    if (insp.inspection_type === 'reception') receptionInspections.push(insp);
    else if (insp.inspection_type === 'inspection') conditionInspections.push(insp);
  }

  // 3. 未关联需求的项目（避免重复 filter）
  const orphanItems = (sortedItems as RequirementItem[]).filter((item) => !item.requirement_id);

  // 4. 配件按项目预分组 + 预排序 + 预计算 extraIdMap（避免渲染时重复计算）
  const partGroupsByItem = new Map<string, PartGroupInfo[]>();
  for (const itemId of Object.keys(partsByItem)) {
    const parts = partsByItem[itemId] as PartBranch[];
    const groups: Record<string, { name: string; parts: PartBranch[] }> = {};
    for (const p of parts) {
      const key = p.branch_group_id || p.part_name_id || `no_name_${p.id}`;
      if (!groups[key]) {
        groups[key] = {
          name: p.alias_name || p.parts?.name || p.name || p.part_names?.name || '未命名配件',
          parts: [],
        };
      }
      groups[key].parts.push(p);
    }
    const groupList: PartGroupInfo[] = [];
    for (const group of Object.values(groups)) {
      group.parts.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      const rep = group.parts[0];
      if (!rep) continue;
      const extraIds = group.parts.map((p) => p.id);
      const images = extraIds.flatMap((pid) => imagesByPart[pid]?.map((m) => m.storage_path).filter(Boolean) as string[] || []);
      groupList.push({
        name: group.name,
        parts: group.parts,
        repId: rep.id,
        repSort: rep.sort_order || 0,
        extraIds,
        images,
      });
    }
    groupList.sort((a, b) => a.repSort - b.repSort);
    partGroupsByItem.set(itemId, groupList);
  }

  // 5. 总提成预计算（避免渲染时全量遍历）
  let totalCommission = 0;
  for (const item of items || []) {
    const comm = calculateItemCommission(
      item,
      item.service_items,
      null,
      null,
      item.total_price || 0,
      0
    );
    totalCommission += comm.diagnosis + comm.repair + comm.sales + comm.qc;
  }
  for (const p of itemParts || []) {
    /* 只对被选中的默认分支计提成（未选中的备选分支不卖给客户、不计提成） */
    if (!p.is_selected) continue;
    const revenue = (p.quantity || 0) * (p.unit_price || 0);
    const cost = (p.quantity || 0) * (p.unit_cost || 0);
    const comm = calculatePartCommission(p.parts, p.part_names, revenue, cost);
    totalCommission += comm.sales + comm.repair + comm.picking + comm.diagnosis + comm.qc;
  }

  return {
    advancePaymentTotal, vehicleModelId, vehicleVin,
    typeCountMap, typeLabelMapForDisplay, pendingInboundParts,
    mechanicsByItem, partsByItem, sortedItems,
    mediaByRequirement, imagesByItem, imagesByPart, mediaByInspection,
    inventoryByPart, pickingByPart, returnByPart, pendingSupplierReturnByPart,
    knowledgeByItem, isLocked,
    itemsByRequirement, receptionInspections, conditionInspections, orphanItems,
    partGroupsByItem, totalCommission,
  };
}




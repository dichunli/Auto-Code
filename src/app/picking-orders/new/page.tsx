import { createClient } from "@/lib/supabase/server";
import PickingOrderForm from "./PickingOrderForm";
import WorkOrderPicker from "./WorkOrderPicker";

export interface 待领料分支 {
  id: string;
  part_id: string;
  part_number: string | null;
  name: string | null;
  brand: string | null;
  specification: string | null;
  unit: string | null;
  quantity: number;
  已领数量: number;
  剩余需领: number;
}

export interface 可用批次 {
  id: string;
  part_id: string;
  batch_no: string | null;
  remaining: number;
  unit_cost: number | null;
  inbound_at: string | null;
}

export interface 工单概要 {
  id: string;
  order_no: string;
  status: string;
  车牌: string;
  客户: string;
}

/* 开领料单页:
   - 无 work_order_id 参数 → 显示有待领料配件的工单列表供选择
   - 有 work_order_id 参数 → 显示该工单所有待领料配件,批量分配批次开单 */
export default async function NewPickingOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ work_order_id?: string }>;
}) {
  const { work_order_id: 工单id } = await searchParams;
  const supabase = await createClient();

  /* 查询所有"已选中、已关联库存配件、客户已同意"的配件分支 */
  const { data: 分支数据 } = await supabase
    .from("work_order_item_parts")
    .select(
      "id, work_order_item_id, part_id, part_number, name, brand, specification, unit, quantity, is_arrived, work_order_items!inner(work_order_id, work_orders!inner(id, order_no, status, vehicles(plate_number), customers(name)))"
    )
    .eq("is_selected", true)
    .eq("customer_opinion", "agree")
    .not("part_id", "is", null);

  interface 分支行 {
    id: string;
    work_order_item_id: string;
    part_id: string;
    part_number: string | null;
    name: string | null;
    brand: string | null;
    specification: string | null;
    unit: string | null;
    quantity: number;
    is_arrived: boolean;
    work_order_items: {
      work_order_id: string;
      work_orders: {
        id: string;
        order_no: string;
        status: string;
        vehicles: { plate_number: string } | null;
        customers: { name: string } | null;
      } | null;
    } | null;
  }
  const 所有分支 = (分支数据 || []) as unknown as 分支行[];

  /* 统计每个分支的净领料数量(领 - 退) */
  const 分支ids = 所有分支.map((b) => b.id);
  const 净领Map: Record<string, number> = {};
  if (分支ids.length > 0) {
    const [{ data: 领料记录 }, { data: 退料记录 }] = await Promise.all([
      supabase.from("part_picking_records").select("work_order_item_part_id, quantity").in("work_order_item_part_id", 分支ids),
      supabase.from("part_return_records").select("work_order_item_part_id, quantity").in("work_order_item_part_id", 分支ids),
    ]);
    for (const r of 领料记录 || []) {
      净领Map[r.work_order_item_part_id] = (净领Map[r.work_order_item_part_id] || 0) + r.quantity;
    }
    for (const r of 退料记录 || []) {
      净领Map[r.work_order_item_part_id] = (净领Map[r.work_order_item_part_id] || 0) - r.quantity;
    }
  }

  /* 过滤出还有剩余需领的分支 */
  const 待领分支 = 所有分支
    .map((b) => ({
      ...b,
      净领: Math.max(0, 净领Map[b.id] || 0),
    }))
    .filter((b) => b.quantity - b.净领 > 0);

  if (!工单id) {
    /* 按工单分组,给出有待领料配件的工单列表 */
    const 工单Map = new Map<string, 工单概要 & { 待领件数: number }>();
    for (const b of 待领分支) {
      const wo = b.work_order_items?.work_orders;
      if (!wo) continue;
      const 已有 = 工单Map.get(wo.id);
      if (已有) {
        已有.待领件数 += b.quantity - b.净领;
      } else {
        工单Map.set(wo.id, {
          id: wo.id,
          order_no: wo.order_no,
          status: wo.status,
          车牌: wo.vehicles?.plate_number || "-",
          客户: wo.customers?.name || "-",
          待领件数: b.quantity - b.净领,
        });
      }
    }
    return <WorkOrderPicker 工单列表={Array.from(工单Map.values())} />;
  }

  /* 指定工单:列出待领料分支 + 可用批次 */
  const 本单分支 = 待领分支.filter((b) => b.work_order_items?.work_orders?.id === 工单id);
  const 工单信息原始 = 本单分支[0]?.work_order_items?.work_orders;

  /* 工单可能没有任何待领料分支,单独查工单信息 */
  let 工单: 工单概要 | null = 工单信息原始
    ? {
        id: 工单信息原始.id,
        order_no: 工单信息原始.order_no,
        status: 工单信息原始.status,
        车牌: 工单信息原始.vehicles?.plate_number || "-",
        客户: 工单信息原始.customers?.name || "-",
      }
    : null;
  if (!工单) {
    const { data: wo } = await supabase
      .from("work_orders")
      .select("id, order_no, status, vehicles(plate_number), customers(name)")
      .eq("id", 工单id)
      .single();
    interface 工单行 {
      id: string;
      order_no: string;
      status: string;
      vehicles: { plate_number: string } | null;
      customers: { name: string } | null;
    }
    const w = wo as unknown as 工单行 | null;
    if (w) {
      工单 = {
        id: w.id,
        order_no: w.order_no,
        status: w.status,
        车牌: w.vehicles?.plate_number || "-",
        客户: w.customers?.name || "-",
      };
    }
  }

  const 配件ids = Array.from(new Set(本单分支.map((b) => b.part_id)));
  let 批次: 可用批次[] = [];
  if (配件ids.length > 0) {
    const { data: 批次数据 } = await supabase
      .from("part_batches")
      .select("id, part_id, batch_no, remaining, unit_cost, inbound_at")
      .in("part_id", 配件ids)
      .gt("remaining", 0)
      .order("inbound_at", { ascending: true });
    批次 = (批次数据 || []) as unknown as 可用批次[];
  }

  const 分支列表: 待领料分支[] = 本单分支.map((b) => ({
    id: b.id,
    part_id: b.part_id,
    part_number: b.part_number,
    name: b.name,
    brand: b.brand,
    specification: b.specification,
    unit: b.unit,
    quantity: b.quantity,
    已领数量: b.净领,
    剩余需领: b.quantity - b.净领,
  }));

  return <PickingOrderForm 工单={工单} 分支列表={分支列表} 批次列表={批次} />;
}

import { createClient } from "@/lib/supabase/server";
import PickingOrderPicker from "./PickingOrderPicker";
import MaterialReturnForm from "./MaterialReturnForm";

export interface 可退记录 {
  picking_record_id: string;
  work_order_item_part_id: string;
  part_id: string | null;
  batch_id: string | null;
  part_number: string | null;
  name: string | null;
  brand: string | null;
  specification: string | null;
  unit: string | null;
  batch_no: string | null;
  unit_cost: number | null;
  已领: number;
  可退: number;
}

export interface 领料单概要 {
  id: string;
  picking_no: string;
  created_at: string;
  工单号: string;
  车牌: string;
}

/* 开退料单页:
   - 无 picking_order_id 参数 → 列出有可退配件的领料单
   - 有 picking_order_id 参数 → 列出该领料单的可退记录,填数量开退料单 */
export default async function NewMaterialReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ picking_order_id?: string }>;
}) {
  const { picking_order_id: 领料单id } = await searchParams;
  const supabase = await createClient();

  /* 查所有领料单的明细(含快照) + 对应领料/退料记录,计算可退数量 */
  const { data: 明细数据 } = await supabase
    .from("picking_order_items")
    .select(
      "id, picking_order_id, picking_record_id, work_order_item_part_id, part_id, batch_id, part_number, name, brand, specification, unit, batch_no, unit_cost, quantity, picking_orders!inner(id, picking_no, status, created_at, work_orders(order_no, vehicles(plate_number)))"
    )
    .eq("picking_orders.status", "confirmed")
    .not("picking_record_id", "is", null)
    .order("created_at", { ascending: false });

  interface 明细行 {
    id: string;
    picking_order_id: string;
    picking_record_id: string;
    work_order_item_part_id: string | null;
    part_id: string | null;
    batch_id: string | null;
    part_number: string | null;
    name: string | null;
    brand: string | null;
    specification: string | null;
    unit: string | null;
    batch_no: string | null;
    unit_cost: number | null;
    quantity: number;
    picking_orders: {
      id: string;
      picking_no: string;
      status: string;
      created_at: string;
      work_orders: { order_no: string; vehicles: { plate_number: string } | null } | null;
    } | null;
  }
  const 所有明细 = ((明细数据 || []) as unknown as 明细行[]).filter((d) => d.picking_record_id);

  /* 统计每条领料记录已退数量 */
  const 记录ids = 所有明细.map((d) => d.picking_record_id);
  const 已退Map: Record<string, number> = {};
  if (记录ids.length > 0) {
    const { data: 退料记录 } = await supabase
      .from("part_return_records")
      .select("picking_record_id, quantity")
      .in("picking_record_id", 记录ids);
    for (const r of 退料记录 || []) {
      if (r.picking_record_id) {
        已退Map[r.picking_record_id] = (已退Map[r.picking_record_id] || 0) + r.quantity;
      }
    }
  }

  const 可退明细 = 所有明细
    .map((d) => ({ ...d, 可退: d.quantity - (已退Map[d.picking_record_id] || 0) }))
    .filter((d) => d.可退 > 0);

  if (!领料单id) {
    /* 按领料单分组 */
    const 单Map = new Map<string, 领料单概要 & { 可退件数: number }>();
    for (const d of 可退明细) {
      const po = d.picking_orders;
      if (!po) continue;
      const 已有 = 单Map.get(po.id);
      if (已有) {
        已有.可退件数 += d.可退;
      } else {
        单Map.set(po.id, {
          id: po.id,
          picking_no: po.picking_no,
          created_at: po.created_at,
          工单号: po.work_orders?.order_no || "-",
          车牌: po.work_orders?.vehicles?.plate_number || "-",
          可退件数: d.可退,
        });
      }
    }
    return <PickingOrderPicker 领料单列表={Array.from(单Map.values())} />;
  }

  /* 指定领料单的可退记录 */
  const 本单明细 = 可退明细.filter((d) => d.picking_order_id === 领料单id);
  const 领料单信息 = 本单明细[0]?.picking_orders;

  /* 查领料单主表拿工单 id */
  const { data: 领料单主表 } = await supabase
    .from("picking_orders")
    .select("id, picking_no, work_order_id, created_at, work_orders(order_no, vehicles(plate_number))")
    .eq("id", 领料单id)
    .single();
  interface 领料单行 {
    id: string;
    picking_no: string;
    work_order_id: string | null;
    created_at: string;
    work_orders: { order_no: string; vehicles: { plate_number: string } | null } | null;
  }
  const 主表 = 领料单主表 as unknown as 领料单行 | null;

  const 领料单概要结果: (领料单概要 & { 工单id: string | null }) | null = 主表
    ? {
        id: 主表.id,
        picking_no: 主表.picking_no,
        created_at: 主表.created_at,
        工单号: 主表.work_orders?.order_no || 领料单信息?.work_orders?.order_no || "-",
        车牌: 主表.work_orders?.vehicles?.plate_number || "-",
        工单id: 主表.work_order_id,
      }
    : null;

  const 记录列表: 可退记录[] = 本单明细.map((d) => ({
    picking_record_id: d.picking_record_id,
    work_order_item_part_id: d.work_order_item_part_id || "",
    part_id: d.part_id,
    batch_id: d.batch_id,
    part_number: d.part_number,
    name: d.name,
    brand: d.brand,
    specification: d.specification,
    unit: d.unit,
    batch_no: d.batch_no,
    unit_cost: d.unit_cost,
    已领: d.quantity,
    可退: d.可退,
  }));

  return <MaterialReturnForm 领料单={领料单概要结果} 记录列表={记录列表} />;
}

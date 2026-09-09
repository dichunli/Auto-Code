import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { StickyPageHeader } from "@/components/StickyPageHeader";
import Link from "next/link";
import { PickingTabBar, type PickingTab } from "./PickingTabBar";
import { PendingPickList, type 待领工单组 } from "./PendingPickList";
import { PendingReturnRequestList, type 退料申请行 } from "./PendingReturnRequestList";
import PickingOrdersContent from "../picking-orders/PickingOrdersContent";
import MaterialReturnsContent from "../material-returns/MaterialReturnsContent";
import type { 领料单 } from "../picking-orders/page";
import type { 退料单 } from "../material-returns/page";

/* 待领料分支的联查返回形状 */
interface 分支联查行 {
  id: string;
  work_order_item_id: string;
  part_id: string | null;
  part_number: string | null;
  name: string | null;
  alias_name: string | null;
  brand: string | null;
  specification: string | null;
  unit: string | null;
  quantity: number | null;
  part_names: { name: string; unit: string | null } | null;
  parts: { quantity: number | null } | null;
  work_order_items: {
    name: string;
    work_orders: {
      id: string;
      order_no: string;
      status: string;
      order_type: string | null;
      settled_at: string | null;
      vehicles: { plate_number: string } | null;
      customers: { name: string } | null;
    } | null;
  } | null;
}

/* 待入库检测：采购行联查返回形状 */
interface 采购行联查 {
  work_order_item_part_id: string | null;
  receiving_batch_id: string | null;
  purchase_orders: { status: string } | null;
}

const 每页分支数 = 50;

export default async function PickingManagePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const currentTab: PickingTab = ["pending_pick", "picked", "pending_return", "returned"].includes(
    sp.tab as PickingTab
  )
    ? (sp.tab as PickingTab)
    : "pending_pick";
  const 当前页 = Math.max(1, parseInt(sp.page || "1") || 1);

  const supabase = await createClient();

  /* ═══ 待领料：选中分支 + 客户已同意 + 净领未达需求 +（有库存 或 已进入待入库流程） ═══ */
  let 待领组列表: 待领工单组[] = [];
  let 待领总分支数 = 0;
  if (currentTab === "pending_pick") {
    const { data: 分支数据 } = await supabase
      .from("work_order_item_parts")
      .select(`
        id, work_order_item_id, part_id, part_number, name, alias_name, brand, specification, unit, quantity,
        part_names(name, unit),
        parts(quantity),
        work_order_items!inner(
          name,
          work_orders!inner(id, order_no, status, order_type, settled_at, vehicles(plate_number), customers(name))
        )
      `)
      .eq("is_selected", true)
      .eq("customer_opinion", "agree")
      .order("created_at", { ascending: true })
      .limit(1000);

    const 所有分支 = (分支数据 || []) as unknown as 分支联查行[];
    const 分支ids = 所有分支.map((b) => b.id);

    /* 净领（领-退）、待出库申领数、待入库检测 三批并行 */
    const [
      { data: 领料记录 },
      { data: 退料记录 },
      { data: 申领记录 },
      { data: 采购行数据 },
    ] = await Promise.all([
      分支ids.length > 0
        ? supabase.from("part_picking_records").select("work_order_item_part_id, quantity").in("work_order_item_part_id", 分支ids)
        : Promise.resolve({ data: [] as { work_order_item_part_id: string; quantity: number }[] }),
      分支ids.length > 0
        ? supabase.from("part_return_records").select("work_order_item_part_id, quantity").in("work_order_item_part_id", 分支ids)
        : Promise.resolve({ data: [] as { work_order_item_part_id: string; quantity: number }[] }),
      分支ids.length > 0
        ? supabase.from("part_pick_requests").select("work_order_item_part_id, quantity").eq("status", "pending").in("work_order_item_part_id", 分支ids)
        : Promise.resolve({ data: [] as { work_order_item_part_id: string; quantity: number }[] }),
      分支ids.length > 0
        ? supabase
            .from("purchase_order_items")
            .select("work_order_item_part_id, receiving_batch_id, purchase_orders(status)")
            .in("work_order_item_part_id", 分支ids)
        : Promise.resolve({ data: [] as 采购行联查[] }),
    ]);

    const 净领Map: Record<string, number> = {};
    for (const r of 领料记录 || []) {
      净领Map[r.work_order_item_part_id] = (净领Map[r.work_order_item_part_id] || 0) + r.quantity;
    }
    for (const r of 退料记录 || []) {
      净领Map[r.work_order_item_part_id] = (净领Map[r.work_order_item_part_id] || 0) - r.quantity;
    }

    const 申领Map: Record<string, number> = {};
    for (const r of 申领记录 || []) {
      申领Map[r.work_order_item_part_id] = (申领Map[r.work_order_item_part_id] || 0) + (r.quantity || 0);
    }

    /* 待入库检测：黄卡批次 pending_storage 或 蓝卡采购单 pending_storage */
    const 批次ids = [...new Set((采购行数据 || []).map((r) => r.receiving_batch_id).filter(Boolean))] as string[];
    let 待入库批次 = new Set<string>();
    if (批次ids.length > 0) {
      const { data: 批次数据 } = await supabase
        .from("receiving_batches")
        .select("id, status")
        .in("id", 批次ids)
        .eq("status", "pending_storage");
      待入库批次 = new Set((批次数据 || []).map((b) => b.id as string));
    }
    const 待入库分支 = new Set<string>();
    for (const r of (采购行数据 || []) as unknown as 采购行联查[]) {
      if (!r.work_order_item_part_id) continue;
      if (r.receiving_batch_id && 待入库批次.has(r.receiving_batch_id)) {
        待入库分支.add(r.work_order_item_part_id);
      } else if (r.purchase_orders?.status === "pending_storage") {
        待入库分支.add(r.work_order_item_part_id);
      }
    }

    /* 过滤 + 分类 */
    interface 待领行 {
      id: string;
      名称: string;
      brand: string | null;
      specification: string | null;
      part_number: string | null;
      unit: string;
      需求数量: number;
      已领: number;
      库存: number;
      申领数: number;
      可领: boolean;
    }
    const 行列表: (待领行 & { 工单id: string; 工单号: string; 车牌: string; 客户: string; 项目名: string })[] = [];
    for (const b of 所有分支) {
      const wo = b.work_order_items?.work_orders;
      if (!wo) continue;
      /* 已结算/已取消的工单不再领料 */
      if (wo.settled_at) continue;
      if (wo.order_type === "cancelled") continue;
      if (wo.status === "settled" || wo.status === "delivered") continue;
      const 需求 = b.quantity || 0;
      const 已领 = Math.max(0, 净领Map[b.id] || 0);
      if (需求 - 已领 <= 0) continue;
      const 库存 = b.part_id ? Number(b.parts?.quantity || 0) : 0;
      const 有库存 = !!b.part_id && 库存 > 0;
      const 在待入库 = 待入库分支.has(b.id);
      /* 既无库存也没进入待入库流程的件还在采购/收货阶段，不算待领料 */
      if (!有库存 && !在待入库) continue;
      行列表.push({
        id: b.id,
        名称: b.alias_name || b.name || b.part_names?.name || "未命名配件",
        brand: b.brand,
        specification: b.specification,
        part_number: b.part_number,
        unit: b.unit || b.part_names?.unit || "个",
        需求数量: 需求,
        已领,
        库存,
        申领数: 申领Map[b.id] || 0,
        可领: 有库存,
        工单id: wo.id,
        工单号: wo.order_no,
        车牌: wo.vehicles?.plate_number || "-",
        客户: wo.customers?.name || "-",
        项目名: b.work_order_items?.name || "-",
      });
    }

    /* 分页（按分支行 50 条/页） */
    待领总分支数 = 行列表.length;
    const 页内行 = 行列表.slice((当前页 - 1) * 每页分支数, 当前页 * 每页分支数);

    /* 按工单分组 */
    const 组Map = new Map<string, 待领工单组>();
    for (const r of 页内行) {
      const 已有 = 组Map.get(r.工单id);
      const 行 = {
        id: r.id,
        名称: r.名称,
        brand: r.brand,
        specification: r.specification,
        part_number: r.part_number,
        unit: r.unit,
        项目名: r.项目名,
        需求数量: r.需求数量,
        已领: r.已领,
        库存: r.库存,
        申领数: r.申领数,
        可领: r.可领,
      };
      if (已有) {
        已有.行列表.push(行);
      } else {
        组Map.set(r.工单id, {
          工单id: r.工单id,
          工单号: r.工单号,
          车牌: r.车牌,
          客户: r.客户,
          行列表: [行],
        });
      }
    }
    待领组列表 = Array.from(组Map.values());
  }

  /* ═══ 已领料：领料单列表（与 /picking-orders 同口径，嵌入模式复用组件） ═══ */
  let 领料单们: 领料单[] = [];
  if (currentTab === "picked") {
    const { data } = await supabase
      .from("picking_orders")
      .select("id, picking_no, status, total_quantity, receiver_name, notes, created_at, work_orders(id, order_no), profiles(full_name)")
      .order("created_at", { ascending: false });
    领料单们 = (data as unknown as 领料单[]) || [];
  }

  /* ═══ 待退料：退料申请 pending 列表（师傅手机端发起，库管确认后开退料单） ═══ */
  let 退料申请们: 退料申请行[] = [];
  const 申请人姓名: Record<string, string> = {};
  if (currentTab === "pending_return") {
    const { data } = await supabase
      .from("part_return_requests")
      .select(`
        id, quantity, return_type, reason, created_at, requested_by,
        work_order_item_parts(
          id, name, alias_name, part_number, brand, specification, unit,
          part_names(name),
          work_order_items(name, work_orders(id, order_no, vehicles(plate_number)))
        ),
        part_picking_records(id, quantity, picking_orders(id, picking_no))
      `)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    退料申请们 = (data || []) as unknown as 退料申请行[];
    /* requested_by 无外键，姓名单独查 */
    const 申请人ids = [...new Set(退料申请们.map((r) => r.requested_by).filter(Boolean))] as string[];
    if (申请人ids.length > 0) {
      const { data: 档案 } = await supabase.from("profiles").select("id, full_name").in("id", 申请人ids);
      for (const p of (档案 || []) as { id: string; full_name: string | null }[]) {
        申请人姓名[p.id] = p.full_name || "-";
      }
    }
  }

  /* ═══ 已退料：退料单列表（与 /material-returns 同口径，嵌入模式复用组件） ═══ */
  let 退料单们: 退料单[] = [];
  if (currentTab === "returned") {
    const { data } = await supabase
      .from("material_return_orders")
      .select("id, return_no, status, total_quantity, return_type, reason, notes, created_at, work_orders(id, order_no), picking_orders(id, picking_no), profiles(full_name)")
      .order("created_at", { ascending: false });
    退料单们 = (data as unknown as 退料单[]) || [];
  }

  return (
    <div>
      <StickyPageHeader>
        <PageHeader title="领料管理" description="工单配件的领料 / 退料集中处理" />

        {/* 顶部按钮区：与采购看板互跳 + 快捷开单 */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Link
            href="/procurement?tab=pending_storage"
            className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            采购看板 →
          </Link>
          <Link
            href="/picking-orders/new"
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            + 开领料单
          </Link>
          <Link
            href="/material-returns/new"
            className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
          >
            + 开退料单
          </Link>
        </div>

        <PickingTabBar currentTab={currentTab} />
      </StickyPageHeader>

      {currentTab === "pending_pick" && (
        <PendingPickList
          key={currentTab}
          组列表={待领组列表}
          当前页={当前页}
          总条数={待领总分支数}
          每页={每页分支数}
        />
      )}
      {currentTab === "picked" && (
        <PickingOrdersContent key={currentTab} initialRecords={领料单们} 嵌入模式 />
      )}
      {currentTab === "pending_return" && (
        <PendingReturnRequestList key={currentTab} initialRequests={退料申请们} 申请人姓名={申请人姓名} />
      )}
      {currentTab === "returned" && (
        <MaterialReturnsContent key={currentTab} initialRecords={退料单们} 嵌入模式 />
      )}
    </div>
  );
}

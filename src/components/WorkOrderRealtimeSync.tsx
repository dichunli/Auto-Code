"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { 是否自己刚改的配件, 是否自己刚结构改动的项目 } from "@/lib/localEditSignal";

interface Props {
  orderId: string;
  itemIds: string[];
  partIds: string[];
}

// 工单详情页实时同步：订阅本工单相关的多张表，任意一端（桌面/移动/采购）
// 改动后，其他端自动刷新。过滤精准到本工单，不会被别的工单干扰。
export function WorkOrderRealtimeSync({ orderId, itemIds, partIds }: Props) {
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    if (!orderId) return;

    // 配件表改动：区分自己/别人，避免自己的局部更新触发整页刷新
    const onPartChange = (payload: { new?: unknown; old?: unknown }) => {
      const newRow = payload.new as { id?: string; work_order_item_id?: string } | null;
      const oldRow = payload.old as { id?: string; work_order_item_id?: string } | null;
      const 变化的分支id = newRow?.id || oldRow?.id || "";
      const 所属项目id = newRow?.work_order_item_id || oldRow?.work_order_item_id || "";
      if (是否自己刚改的配件(变化的分支id)) return;
      if (是否自己刚结构改动的项目(所属项目id)) return;
      router.refresh();
    };

    // 其余表改动：直接刷新（这些多为状态/付款/派工等非高频局部编辑，刷新最省心且正确）
    const onOtherChange = () => router.refresh();

    const channel = supabase.channel(`wo_sync_${orderId}`);

    // 工单主体（状态、金额汇总、折扣等）
    channel.on("postgres_changes", { event: "*", schema: "public", table: "work_orders", filter: `id=eq.${orderId}` }, onOtherChange);
    // 工时/配件项目、需求、检验、付款、质检、预收款（都挂 work_order_id）
    channel.on("postgres_changes", { event: "*", schema: "public", table: "work_order_items", filter: `work_order_id=eq.${orderId}` }, onOtherChange);
    channel.on("postgres_changes", { event: "*", schema: "public", table: "work_order_requirements", filter: `work_order_id=eq.${orderId}` }, onOtherChange);
    channel.on("postgres_changes", { event: "*", schema: "public", table: "work_order_inspections", filter: `work_order_id=eq.${orderId}` }, onOtherChange);
    channel.on("postgres_changes", { event: "*", schema: "public", table: "payments", filter: `work_order_id=eq.${orderId}` }, onOtherChange);
    channel.on("postgres_changes", { event: "*", schema: "public", table: "quality_checks", filter: `work_order_id=eq.${orderId}` }, onOtherChange);
    channel.on("postgres_changes", { event: "*", schema: "public", table: "advance_payment_records", filter: `work_order_id=eq.${orderId}` }, onOtherChange);

    // 配件分支、派工（挂 work_order_item_id，按本工单的项目ID列表过滤）
    if (itemIds.length > 0) {
      const itemFilter = `work_order_item_id=in.(${itemIds.join(",")})`;
      channel.on("postgres_changes", { event: "*", schema: "public", table: "work_order_item_parts", filter: itemFilter }, onPartChange);
      channel.on("postgres_changes", { event: "*", schema: "public", table: "work_order_item_mechanics", filter: itemFilter }, onOtherChange);
    }

    // 领料/退料/供应商退货（挂 work_order_item_part_id，按本工单的配件ID列表过滤）
    if (partIds.length > 0) {
      const partFilter = `work_order_item_part_id=in.(${partIds.join(",")})`;
      channel.on("postgres_changes", { event: "*", schema: "public", table: "part_picking_records", filter: partFilter }, onOtherChange);
      channel.on("postgres_changes", { event: "*", schema: "public", table: "part_return_records", filter: partFilter }, onOtherChange);
      channel.on("postgres_changes", { event: "*", schema: "public", table: "supplier_return_records", filter: partFilter }, onOtherChange);
    }

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // itemIds/partIds 用字符串化做依赖，内容变化才重订阅
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, router, orderId, itemIds.join(","), partIds.join(",")]);

  return null;
}

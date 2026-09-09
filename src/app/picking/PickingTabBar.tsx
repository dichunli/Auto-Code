"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

export type PickingTab = "pending_pick" | "picked" | "pending_return" | "returned";

const TABS: { key: PickingTab; label: string; color: string }[] = [
  { key: "pending_pick", label: "待领料", color: "bg-purple-500" },
  { key: "picked", label: "已领料", color: "bg-green-500" },
  { key: "pending_return", label: "待退料", color: "bg-amber-500" },
  { key: "returned", label: "已退料", color: "bg-gray-500" },
];

interface Props {
  currentTab: PickingTab;
}

/* 待领料角标用的分支行（口径与 page.tsx 待领料 Tab 一致，仅取计数所需字段） */
interface 角标分支行 {
  id: string;
  part_id: string | null;
  quantity: number | null;
  parts: { quantity: number | null } | null;
  work_order_items: {
    work_orders: {
      status: string;
      order_type: string | null;
      settled_at: string | null;
    } | null;
  } | null;
}

interface 角标采购行 {
  work_order_item_part_id: string | null;
  receiving_batch_id: string | null;
  purchase_orders: { status: string } | null;
}

export function PickingTabBar({ currentTab }: Props) {
  const supabase = createClient();
  const [counts, setCounts] = useState<Record<PickingTab, number>>({
    pending_pick: 0,
    picked: 0,
    pending_return: 0,
    returned: 0,
  });

  const loadCounts = useCallback(async () => {
    /* 待领料：与 page.tsx 同口径（选中分支+客户同意+净领未达+有库存或待入库中） */
    const { data: 分支数据 } = await supabase
      .from("work_order_item_parts")
      .select(
        "id, part_id, quantity, parts(quantity), work_order_items(work_orders(status, order_type, settled_at))"
      )
      .eq("is_selected", true)
      .eq("customer_opinion", "agree")
      .order("created_at", { ascending: false })
      .limit(2000);

    const 分支们 = (分支数据 || []) as unknown as 角标分支行[];
    const 分支ids = 分支们.map((b) => b.id);

    const 净领Map: Record<string, number> = {};
    const 待入库分支 = new Set<string>();
    if (分支ids.length > 0) {
      const [{ data: 领料记录 }, { data: 退料记录 }, { data: 采购行数据 }] = await Promise.all([
        supabase.from("part_picking_records").select("work_order_item_part_id, quantity").in("work_order_item_part_id", 分支ids),
        supabase.from("part_return_records").select("work_order_item_part_id, quantity").in("work_order_item_part_id", 分支ids),
        supabase
          .from("purchase_order_items")
          .select("work_order_item_part_id, receiving_batch_id, purchase_orders(status)")
          .in("work_order_item_part_id", 分支ids),
      ]);
      for (const r of 领料记录 || []) {
        净领Map[r.work_order_item_part_id] = (净领Map[r.work_order_item_part_id] || 0) + r.quantity;
      }
      for (const r of 退料记录 || []) {
        净领Map[r.work_order_item_part_id] = (净领Map[r.work_order_item_part_id] || 0) - r.quantity;
      }
      const 批次ids = [...new Set((采购行数据 || []).map((r) => r.receiving_batch_id).filter(Boolean))] as string[];
      let 待入库批次 = new Set<string>();
      if (批次ids.length > 0) {
        const { data: 批次数据 } = await supabase
          .from("receiving_batches")
          .select("id")
          .in("id", 批次ids)
          .eq("status", "pending_storage");
        待入库批次 = new Set((批次数据 || []).map((b) => b.id as string));
      }
      for (const r of (采购行数据 || []) as unknown as 角标采购行[]) {
        if (!r.work_order_item_part_id) continue;
        if (r.receiving_batch_id && 待入库批次.has(r.receiving_batch_id)) {
          待入库分支.add(r.work_order_item_part_id);
        } else if (r.purchase_orders?.status === "pending_storage") {
          待入库分支.add(r.work_order_item_part_id);
        }
      }
    }

    let 待领料 = 0;
    for (const b of 分支们) {
      const wo = b.work_order_items?.work_orders;
      if (!wo || wo.settled_at) continue;
      if (wo.order_type === "cancelled") continue;
      if (wo.status === "settled" || wo.status === "delivered") continue;
      const 剩余需领 = (b.quantity || 0) - Math.max(0, 净领Map[b.id] || 0);
      if (剩余需领 <= 0) continue;
      const 有库存 = !!b.part_id && Number(b.parts?.quantity || 0) > 0;
      if (有库存 || 待入库分支.has(b.id)) 待领料++;
    }

    const [{ data: 领料单数据 }, { data: 退料申请数据 }, { data: 退料单数据 }] = await Promise.all([
      supabase.from("picking_orders").select("id").eq("status", "confirmed"),
      supabase.from("part_return_requests").select("id").eq("status", "pending"),
      supabase.from("material_return_orders").select("id"),
    ]);

    setCounts({
      pending_pick: 待领料,
      picked: 领料单数据?.length || 0,
      pending_return: 退料申请数据?.length || 0,
      returned: 退料单数据?.length || 0,
    });
  }, [supabase]);

  useEffect(() => {
    loadCounts();

    /* Realtime 订阅：相关表变化时刷新角标 */
    const 订阅表 = [
      "work_order_item_parts",
      "part_picking_records",
      "part_return_requests",
      "picking_orders",
      "material_return_orders",
    ];
    const channels = 订阅表.map((表名) =>
      supabase
        .channel(`picking_tab_counts_${表名}`)
        .on("postgres_changes", { event: "*", schema: "public", table: 表名 }, () => {
          loadCounts();
        })
        .subscribe()
    );

    return () => {
      for (const ch of channels) {
        supabase.removeChannel(ch);
      }
    };
  }, [supabase, loadCounts]);

  /* 切换 Tab 时也刷新角标（Realtime 可能漏发，点 Tab 是强意图动作） */
  useEffect(() => {
    loadCounts();
  }, [currentTab, loadCounts]);

  return (
    /* 胶囊标签（对齐采购看板样式）：圆角按钮 + 彩色数字角标，自动换行 */
    <div className="flex flex-wrap gap-2 mb-4">
      {TABS.map((tab) => {
        const isActive = currentTab === tab.key;
        const count = counts[tab.key];
        return (
          <Link
            key={tab.key}
            href={`/picking?tab=${tab.key}`}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              isActive
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            {tab.label}
            {count > 0 && (
              <span
                className={`ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full text-[11px] font-bold text-white ${
                  isActive ? "bg-white/25" : tab.color
                }`}
              >
                {count > 99 ? "99+" : count}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

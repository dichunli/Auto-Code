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

interface Props {
  currentTab: PickingTab;
}

export function PickingTabBar({ currentTab }: Props) {
  const supabase = createClient();
  const [counts, setCounts] = useState<Record<PickingTab, number>>({
    pending_pick: 0,
    picked: 0,
    pending_return: 0,
    returned: 0,
  });

  /* 角标计数：一次 RPC 全取（2026-09-19 收编，9-15 诊断🟠#12）。
   * 原来拉 2000 行选中分支+领料/退料/采购行三表到浏览器算"待领料"，
   * 超 2000 行角标静默失真；数据库端聚合后口径不变、无截断。
   * 失败静默：角标不打扰页面，下次 Realtime/切 Tab 再试。 */
  const loadCounts = useCallback(async () => {
    const { data, error } = await supabase.rpc("picking_tab_counts");
    if (error || !data) return;
    setCounts(data as unknown as Record<PickingTab, number>);
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

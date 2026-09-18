"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

export type ProcurementTab =
  | "pending_inquiry"
  | "pending_quote"
  | "pending_confirm"
  | "pending_purchase"
  | "pending_receipt"
  | "pending_storage"
  | "completed_storage"
  | "pending_return"
  | "completed_return"
  | "inbound_orders"
  | "return_orders"
  | "quote_sheets";

const TABS: { key: ProcurementTab; label: string; color: string }[] = [
  { key: "pending_inquiry", label: "待询价", color: "bg-gray-500" },
  { key: "pending_quote", label: "待报价", color: "bg-yellow-500" },
  { key: "pending_confirm", label: "待确认", color: "bg-blue-500" },
  { key: "pending_purchase", label: "待采购", color: "bg-orange-500" },
  { key: "pending_receipt", label: "待收货", color: "bg-indigo-500" },
  { key: "pending_storage", label: "待入库", color: "bg-teal-500" },
  { key: "completed_storage", label: "已入库", color: "bg-green-500" },
  { key: "pending_return", label: "待退货", color: "bg-rose-500" },
  { key: "completed_return", label: "已退货", color: "bg-gray-500" },
  { key: "inbound_orders", label: "入库单", color: "bg-cyan-600" },
  { key: "return_orders", label: "采退单", color: "bg-gray-500" },
  { key: "quote_sheets", label: "询价单", color: "bg-purple-500" },
];

interface Props {
  currentTab: ProcurementTab;
}

export function ProcurementTabBar({ currentTab }: Props) {
  const supabase = createClient();
  const [counts, setCounts] = useState<Record<ProcurementTab, number>>({
    pending_inquiry: 0,
    pending_quote: 0,
    pending_confirm: 0,
    pending_purchase: 0,
    pending_receipt: 0,
    pending_storage: 0,
    completed_storage: 0,
    pending_return: 0,
    completed_return: 0,
    inbound_orders: 0,
    return_orders: 0,
    quote_sheets: 0,
  });

  /* 角标计数：一次 RPC 全取（2026-09-19 收编，9-15 诊断🟠#12）。
   * 原来拉 2000 行工单配件到浏览器数数，超 2000 行角标静默失真；
   * 数据库端聚合后口径不变、无截断。失败静默：角标不打扰页面，下次 Realtime/切 Tab 再试。 */
  const loadCounts = useCallback(async () => {
    const { data, error } = await supabase.rpc("procurement_tab_counts");
    if (error || !data) return;
    setCounts(data as unknown as Record<ProcurementTab, number>);
  }, [supabase]);

  useEffect(() => {
    loadCounts();

    /* Realtime 订阅：work_order_item_parts 变化时刷新前 4 个标签计数 */
    const partsChannel = supabase
      .channel("procurement_tab_parts_counts")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "work_order_item_parts" },
        () => {
          loadCounts();
        }
      )
      .subscribe();

    /* Realtime 订阅：purchase_orders 变化时刷新待收货计数 */
    const poChannel = supabase
      .channel("procurement_tab_po_counts")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "purchase_orders" },
        () => {
          loadCounts();
        }
      )
      .subscribe();

    /* Realtime 订阅: supplier_return_records 变化时刷新待退货/已退货计数 */
    const retChannel = supabase
      .channel("procurement_tab_return_counts")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "supplier_return_records" },
        () => {
          loadCounts();
        }
      )
      .subscribe();

    /* Realtime 订阅: supplier_quote_sheets 变化时刷新询价单角标（供应商一提交就亮） */
    const quoteChannel = supabase
      .channel("procurement_tab_quote_counts")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "supplier_quote_sheets" },
        () => {
          loadCounts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(partsChannel);
      supabase.removeChannel(poChannel);
      supabase.removeChannel(retChannel);
      supabase.removeChannel(quoteChannel);
    };
  }, [supabase, loadCounts]);

  /* 切换 Tab 时也刷新角标：Realtime 事件可能因网络/订阅失败漏发，
   * 而用户点 Tab 是强意图动作，此时必须给出最新数字（2026-08-14 角标不实时问题） */
  useEffect(() => {
    loadCounts();
  }, [currentTab, loadCounts]);

  return (
    /* 胶囊标签（对齐工单列表页的阶段筛选样式）：圆角按钮 + 彩色数字角标，自动换行 */
    <div className="flex flex-wrap gap-2 mb-4">
      {TABS.map((tab) => {
        const isActive = currentTab === tab.key;
        const count = counts[tab.key];
        return (
          <Link
            key={tab.key}
            href={
              tab.key === "inbound_orders"
                ? "/inbound-orders"
                : tab.key === "return_orders"
                ? "/return-orders"
                : tab.key === "quote_sheets"
                ? "/quote-sheets"
                : `/procurement?tab=${tab.key}`
            }
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

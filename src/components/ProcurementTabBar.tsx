"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
  | "completed_return";

const TABS: { key: ProcurementTab; label: string }[] = [
  { key: "pending_inquiry", label: "待询价" },
  { key: "pending_quote", label: "待报价" },
  { key: "pending_confirm", label: "待确认" },
  { key: "pending_purchase", label: "待采购" },
  { key: "pending_receipt", label: "待收货" },
  { key: "pending_storage", label: "待入库" },
  { key: "completed_storage", label: "已入库" },
  { key: "pending_return", label: "待退货" },
  { key: "completed_return", label: "已退货" },
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
  });

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

    return () => {
      supabase.removeChannel(partsChannel);
      supabase.removeChannel(poChannel);
      supabase.removeChannel(retChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  async function loadCounts() {
    const { data: parts } = await supabase
      .from("work_order_item_parts")
      .select(
        `
        id, unit_cost, unit_price, customer_opinion, is_purchased, is_arrived, part_id,
        work_order_items(
          work_orders(settled_at, order_type)
        ),
        parts(quantity)
      `
      )
      .order("created_at", { ascending: false })
      .limit(2000);

    const rows = (parts || []) as any[];

    let pendingInquiry = 0;
    let pendingQuote = 0;
    let pendingConfirm = 0;
    let pendingPurchase = 0;

    for (const r of rows) {
      const wo = r.work_order_items?.work_orders;
      if (!wo) continue;
      if (wo.settled_at) continue;
      if (wo.order_type === "cancelled") continue;
      if (r.is_purchased || r.is_arrived) continue;

      const cost = Number(r.unit_cost || 0);
      const price = Number(r.unit_price || 0);
      const opinion = r.customer_opinion || "pending";

      if (cost <= 0) {
        pendingInquiry++;
      } else if (cost > 0 && price <= 0) {
        pendingQuote++;
      } else if (cost > 0 && price > 0 && opinion === "pending") {
        pendingConfirm++;
      }

      if (cost > 0 && price > 0 && opinion === "agree") {
        const inventoryQty = Number(r.parts?.quantity || 0);
        if (!r.part_id || inventoryQty <= 0) {
          pendingPurchase++;
        }
      }
    }

    const { data: poData } = await supabase
      .from("purchase_orders")
      .select("id, status, purchase_order_items(quantity, handle_action)")
      .in("status", ["submitted", "approved", "partial_received"]);

    const pendingReceipt = (poData || []).filter((o: any) => {
      const items = o.purchase_order_items || [];
      return items.some((it: any) => !it.handle_action);
    }).length;

    const { data: storageData } = await supabase
      .from("purchase_orders")
      .select("id")
      .eq("status", "pending_storage");

    const pendingStorage = storageData?.length || 0;

    const { data: completedData } = await supabase
      .from("purchase_orders")
      .select("id")
      .eq("status", "completed");

    const completedStorage = completedData?.length || 0;

    const { data: returnData } = await supabase
      .from("supplier_return_records")
      .select("id, status");

    const pendingReturn = (returnData || []).filter((r: any) => r.status === "pending").length;
    const completedReturn = (returnData || []).filter((r: any) => r.status === "completed").length;

    setCounts({
      pending_inquiry: pendingInquiry,
      pending_quote: pendingQuote,
      pending_confirm: pendingConfirm,
      pending_purchase: pendingPurchase,
      pending_receipt: pendingReceipt,
      pending_storage: pendingStorage,
      completed_storage: completedStorage,
      pending_return: pendingReturn,
      completed_return: completedReturn,
    });
  }

  return (
    <div className="flex flex-wrap gap-1 mb-6 border-b border-gray-200">
      {TABS.map((tab) => {
        const isActive = currentTab === tab.key;
        const count = counts[tab.key];
        return (
          <Link
            key={tab.key}
            href={`/procurement?tab=${tab.key}`}
            className={`px-4 py-2.5 text-sm border-b-2 -mb-px transition-colors rounded-t-md flex items-center gap-1.5 ${
              isActive
                ? "border-blue-600 text-blue-700 font-semibold bg-blue-50"
                : "border-transparent text-gray-600 font-medium hover:text-gray-900 hover:border-gray-300"
            }`}
          >
            {tab.label}
            {count > 0 && (
              <span
                className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 text-xs rounded-full ${
                  isActive
                    ? "bg-blue-200 text-blue-800"
                    : "bg-gray-200 text-gray-700"
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

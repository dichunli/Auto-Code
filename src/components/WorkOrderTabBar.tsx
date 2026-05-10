"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface TabInfo {
  order_no: string;
  plate_number: string;
}

interface WorkOrderTabBarProps {
  tabs?: string;
}

export function WorkOrderTabBar({ tabs: tabsProp }: WorkOrderTabBarProps) {
  const router = useRouter();
  const pathname = usePathname();

  const tabs = tabsProp?.split(",").filter(Boolean) || [];

  const activeId =
    pathname.startsWith("/work-orders/") && pathname !== "/work-orders"
      ? pathname.split("/")[2]
      : null;

  const [tabInfo, setTabInfo] = useState<Record<string, TabInfo>>({});
  const loadedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const missing = tabs.filter((id) => !loadedRef.current.has(id));
    if (missing.length === 0) return;

    const supabase = createClient();
    supabase
      .from("work_orders")
      .select("id, order_no, vehicles(plate_number)")
      .in("id", missing)
      .then(({ data }) => {
        if (!data) return;
        data.forEach((raw: any) => loadedRef.current.add(raw.id));
        setTabInfo((prev) => {
          const next = { ...prev };
          data.forEach((raw: any) => {
            const v = raw.vehicles;
            const vehicle = Array.isArray(v) ? v[0] : v;
            next[raw.id] = {
              order_no: raw.order_no || "",
              plate_number: vehicle?.plate_number || "",
            };
          });
          return next;
        });
      });
  }, [tabs.join(",")]);

  const handleTabClick = useCallback(
    (tabId: string | null) => {
      if (tabId === null) {
        if (!activeId) return;
        const qs = tabs.length > 0 ? `?tabs=${tabs.join(",")}` : "";
        router.push(`/work-orders${qs}`);
      } else {
        if (activeId === tabId) return;
        router.push(`/work-orders/${tabId}?tabs=${tabs.join(",")}`);
      }
    },
    [tabs, activeId, router]
  );

  const handleCloseTab = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.stopPropagation();
      const newTabs = tabs.filter((t) => t !== tabId);
      if (activeId === tabId) {
        if (newTabs.length > 0) {
          router.push(`/work-orders/${newTabs[newTabs.length - 1]}?tabs=${newTabs.join(",")}`);
        } else {
          router.push("/work-orders");
        }
      } else {
        const base = activeId ? `/work-orders/${activeId}` : "/work-orders";
        const qs = newTabs.length > 0 ? `?tabs=${newTabs.join(",")}` : "";
        router.push(`${base}${qs}`);
      }
    },
    [tabs, activeId, router]
  );

  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
      <button
        onClick={() => handleTabClick(null)}
        className={`flex items-center gap-1 px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 whitespace-nowrap transition-colors ${
          !activeId
            ? "bg-white text-blue-700 border-blue-600"
            : "text-gray-600 border-transparent hover:text-gray-900"
        }`}
      >
        服务记录
      </button>
      {tabs.map((tabId) => {
        const info = tabInfo[tabId];
        const label = info?.plate_number || info?.order_no || "加载中...";
        const isActive = activeId === tabId;
        return (
          <button
            key={tabId}
            onClick={() => handleTabClick(tabId)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 whitespace-nowrap transition-colors ${
              isActive
                ? "bg-white text-blue-700 border-blue-600"
                : "text-gray-600 border-transparent hover:text-gray-900"
            }`}
          >
            <span>工单详情：{label}</span>
            <span
              onClick={(e) => handleCloseTab(e, tabId)}
              className="text-gray-400 hover:text-red-500 text-xs leading-none cursor-pointer"
            >
              ✕
            </span>
          </button>
        );
      })}
    </div>
  );
}

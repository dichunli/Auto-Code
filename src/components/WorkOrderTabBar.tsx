"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { 工单标签存储键, 读本地工单标签 } from "@/lib/orderTabs";

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

  const urlTabs = tabsProp?.split(",").filter(Boolean) || [];

  const activeId =
    pathname.startsWith("/work-orders/") && pathname !== "/work-orders"
      ? pathname.split("/")[2]
      : null;

  /* URL 没有 tabs 时的后备（从菜单/返回键进列表页）：读本地存储 */
  const [本地tabs, set本地tabs] = useState<string[]>([]);
  const tabs = urlTabs.length > 0 ? urlTabs : 本地tabs;

  const [tabInfo, setTabInfo] = useState<Record<string, TabInfo>>({});
  const loadedRef = useRef<Set<string>>(new Set());

  /* 首次挂载：读本地存储的标签 */
  useEffect(() => {
    set本地tabs(读本地工单标签());
  }, []);

  /* URL 是操作后的最新事实：详情页 或 URL 带 tabs 时，同步写本地存储。
   * 注意"列表页且 URL 无 tabs"时不写——那是菜单/返回进入的场景，不该清掉存储 */
  useEffect(() => {
    if (activeId || urlTabs.length > 0) {
      localStorage.setItem(工单标签存储键, JSON.stringify(urlTabs));
    }
  }, [urlTabs, activeId]);

  useEffect(() => {
    const missing = tabs.filter((id) => !loadedRef.current.has(id));
    if (missing.length === 0) return;

    /* 过滤掉非法 UUID，避免 PostgREST 返回 400 */
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const validIds = missing.filter((id) => uuidRegex.test(id));
    if (validIds.length === 0) return;

    const supabase = createClient();
    supabase
      .from("work_orders")
      .select("id, order_no, vehicles(plate_number)")
      .in("id", validIds)
      .then(({ data }) => {
        if (!data) return;
        interface RawRow {
          id: string;
          order_no: string | null;
          vehicles: { plate_number: string } | { plate_number: string }[] | null;
        }
        data.forEach((raw: RawRow) => loadedRef.current.add(raw.id));
        setTabInfo((prev) => {
          const next = { ...prev };
          data.forEach((raw: RawRow) => {
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
      /* 关闭是用户的明确动作：立即写存储（含关完写成 []），
       * 否则关完标签后存储里还是旧值，标签会"复活" */
      localStorage.setItem(工单标签存储键, JSON.stringify(newTabs));
      set本地tabs(newTabs);
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
    [tabs, activeId, router, set本地tabs]
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

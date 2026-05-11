"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";

interface NavItem {
  href: string;
  label: string;
  children?: { href: string; label: string; countKey?: string }[];
}

const navItems: NavItem[] = [
  { href: "/", label: "仪表盘" },
  {
    href: "/work-orders",
    label: "工单管理",
    children: [
      { href: "/work-orders", label: "全部工单", countKey: "all" },
      { href: "/work-orders?status=repairing", label: "在修工单", countKey: "repairing" },
      { href: "/work-orders?type=appointment", label: "预约单", countKey: "appointment" },
      { href: "/work-orders?type=quote", label: "历史报价单", countKey: "quote" },
      { href: "/work-orders?type=maintenance", label: "保养工单", countKey: "maintenance" },
      { href: "/work-orders?type=cancelled", label: "作废工单", countKey: "cancelled" },
    ],
  },
  { href: "/customers", label: "客户车辆" },
  { href: "/vehicle-models", label: "车型库" },
  { href: "/appointments", label: "客户预约" },
  { href: "/inventory", label: "配件库存" },
  { href: "/procurement", label: "采购管理" },
  { href: "/logistics", label: "物流运单" },
  { href: "/service-items", label: "维修项目" },
  { href: "/service-categories", label: "项目分类" },
  { href: "/service-names", label: "项目名称" },
  { href: "/knowledge", label: "知识库" },
  { href: "/employees", label: "员工管理" },
  { href: "/members", label: "会员管理" },
  { href: "/finance", label: "财务管理" },
  { href: "/reports", label: "报表统计" },
  { href: "/follow-ups", label: "售后回访" },
  { href: "/reminders", label: "保养提醒" },
  { href: "/notifications", label: "客户通知" },
  { href: "/operation-logs", label: "操作日志" },
];

function NavGroup({
  item,
  pathname,
  onClick,
  counts,
}: {
  item: NavItem;
  pathname: string;
  onClick: () => void;
  counts: Record<string, number>;
}) {
  const [open, setOpen] = useState(() => {
    if (!item.children) return false;
    return pathname.startsWith(item.href + "/") || pathname === item.href;
  });
  const searchParams = useSearchParams();
  const queryString = searchParams ? (searchParams.toString() ? "?" + searchParams.toString() : "") : "";
  const isActive = pathname === item.href || pathname.startsWith(item.href + "/");

  if (!item.children) {
    return (
      <Link
        href={item.href}
        onClick={onClick}
        className={cn(
          "block px-3 py-2 rounded-md text-sm font-medium transition-colors",
          isActive ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
        )}
      >
        {item.label}
      </Link>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium transition-colors",
          isActive ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
        )}
      >
        <span>{item.label}</span>
        <svg
          className={cn("w-4 h-4 transition-transform", open ? "rotate-180" : "")}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="ml-3 mt-1 space-y-1 border-l-2 border-gray-100 pl-2">
          {item.children.map((child) => {
            const childActive = pathname === child.href || pathname + queryString === child.href;
            const count = child.countKey ? counts[child.countKey] || 0 : 0;
            return (
              <Link
                key={child.href}
                href={child.href}
                onClick={onClick}
                className={cn(
                  "flex items-center justify-between px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  childActive ? "bg-blue-50 text-blue-700" : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
                )}
              >
                <span>{child.label}</span>
                {count > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 bg-red-500 text-white rounded-full text-[10px] min-w-[18px] text-center">
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    async function fetchCounts() {
      const { count: allCount } = await supabase
        .from("work_orders")
        .select("id", { count: "exact", head: true });
      const { count: repairingCount } = await supabase
        .from("work_orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "repairing");

      setCounts({
        all: allCount || 0,
        repairing: repairingCount || 0,
        appointment: 0,
        quote: 0,
        maintenance: 0,
        cancelled: 0,
      });
    }
    fetchCounts();
    const interval = setInterval(fetchCounts, 30000);
    return () => clearInterval(interval);
  }, [supabase]);

  async function handleLogout() {
    try {
      await supabase.auth.signOut();
    } catch {
      // 忽略登出错误，强制跳转
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      {/* 移动端顶部条 */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-white border-b border-gray-200 z-40 flex items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">修</span>
          </div>
          <span className="text-lg font-bold text-gray-900">汽修管家</span>
        </Link>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2 rounded-md text-gray-600 hover:bg-gray-100"
        >
          {mobileOpen ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* 侧边栏 */}
      <aside
        className={cn(
          "fixed md:static top-14 md:top-auto bottom-0 left-0 z-30 w-56 bg-white border-r border-gray-200 flex flex-col transition-transform duration-200 ease-in-out",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-4 border-b border-gray-100 flex-shrink-0">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">修</span>
            </div>
            <span className="text-lg font-bold text-gray-900">汽修管家</span>
          </Link>
        </div>

        {/* 导航 */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {navItems.map((item) => (
            <NavGroup key={item.href} item={item} pathname={pathname} onClick={() => setMobileOpen(false)} counts={counts} />
          ))}
        </nav>

        {/* 退出登录 */}
        <div className="p-3 border-t border-gray-100 flex-shrink-0">
          <button
            onClick={handleLogout}
            className="w-full px-3 py-2 text-sm text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-md transition-colors text-left"
          >
            退出登录
          </button>
        </div>
      </aside>

      {/* 移动端遮罩 */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
    </>
  );
}

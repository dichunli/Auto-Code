"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useState } from "react";

const navItems = [
  { href: "/", label: "仪表盘" },
  { href: "/work-orders", label: "工单管理" },
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
];

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [mobileOpen, setMobileOpen] = useState(false);

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
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "block px-3 py-2 rounded-md text-sm font-medium transition-colors",
                pathname === item.href || pathname.startsWith(item.href + "/")
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
              )}
            >
              {item.label}
            </Link>
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

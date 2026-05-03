"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

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
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">修</span>
              </div>
              <span className="text-lg font-bold text-gray-900">汽修管家</span>
            </Link>
            <div className="hidden sm:flex items-center gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    pathname === item.href || pathname.startsWith(item.href + "/")
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
          <div className="flex items-center">
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
            >
              退出登录
            </button>
          </div>
        </div>
      </div>
      {/* 移动端导航 */}
      <div className="sm:hidden border-t border-gray-100 overflow-x-auto">
        <div className="flex gap-1 px-4 py-2">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors",
                pathname === item.href || pathname.startsWith(item.href + "/")
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
              )}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}

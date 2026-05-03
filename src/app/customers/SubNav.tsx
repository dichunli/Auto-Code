"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/customers", label: "客户管理" },
  { href: "/vehicles", label: "车辆管理" },
  { href: "/companies", label: "单位管理" },
];

export function SubNav({ active }: { active?: string }) {
  const pathname = usePathname();

  return (
    <div className="flex gap-1 mb-6 border-b border-gray-200">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
            pathname === tab.href || pathname.startsWith(tab.href + "/")
              ? "border-blue-600 text-blue-700"
              : "border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300"
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}

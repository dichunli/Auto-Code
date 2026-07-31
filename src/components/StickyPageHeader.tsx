"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/* 冻结页头容器：把页面标题/按钮区/标签栏包进来，向下滚动时固定在主内容区顶部。
 * 原理：主内容区（AppShell 的 main）是独立滚动容器，sticky top-0 相对它冻结；
 * 负 margin 抵消 main 的横向 padding，让背景色铺满整行（否则两侧会透出滚动的内容）；
 * pt-6 补偿原 main 的顶部留白（冻结后背景要盖住原本空白的区域）。
 * 同时把页头实际高度写入全局 CSS 变量 --sticky-header-h，供列表区内滚表格计算
 * max-h 使用（窗口缩放/按钮换行导致页头变高时自动跟随，保证列表标题栏不被遮挡）。
 * 注意：z-20 低于弹窗（z-50），不会遮挡模态框。 */
export function StickyPageHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const 写变量 = () =>
      document.documentElement.style.setProperty("--sticky-header-h", `${el.offsetHeight}px`);
    写变量();
    const ro = new ResizeObserver(写变量);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--sticky-header-h");
    };
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        "sticky top-0 z-20 bg-gray-50 pt-6 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8",
        className
      )}
    >
      {children}
    </div>
  );
}

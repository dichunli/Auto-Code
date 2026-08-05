"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import { cn } from "@/lib/utils";
import { Navbar } from "./Navbar";
import { PriceVisibilityProvider, usePriceVisibility } from "./PriceVisibilityContext";
import { 确保会话就绪, 记录登录健康检查 } from "@/lib/supabase/client";

function KeyboardHandler() {
  const { togglePrices } = usePriceVisibility();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        togglePrices();
      }
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [togglePrices]);

  return null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  /* 公开页（无需登录、无侧边导航）：登录页 + 供应商报价页 */
  const isLogin = pathname === "/login" || pathname.startsWith("/quote");

  /*
   * 进入应用先确保登录态注入到 Supabase 客户端，再渲染页面，
   * 否则软跳转进列表页时查询会因客户端无 session 被 RLS 过滤为空。
   * 登录页不需要等待。带超时兜底，避免网络异常时永久白屏。
   */
  const [会话就绪, set会话就绪] = useState(isLogin);

  useEffect(() => {
    if (isLogin) {
      set会话就绪(true);
      return;
    }
    let 已完成 = false;
    const 标记就绪 = () => {
      if (!已完成) {
        已完成 = true;
        set会话就绪(true);
      }
    };
    /* 正常路径：会话注入完成后放行 */
    确保会话就绪().then(() => {
      标记就绪();
      /* 会话注入完成后做一次只读健康检查，发现异常仅在控制台留日志，不打扰用户 */
      记录登录健康检查();
    });
    /* 兜底：最多等 3 秒，无论成败都放行，绝不卡住页面 */
    const 超时 = setTimeout(标记就绪, 3000);
    return () => clearTimeout(超时);
  }, [isLogin]);

  return (
    <PriceVisibilityProvider>
      <KeyboardHandler />
      <Suspense fallback={null}>
        {!isLogin && <Navbar />}
      </Suspense>
      <main
        className={cn(
          "flex-1 overflow-auto px-4 pb-6 sm:px-6 lg:px-8",
          isLogin ? "pt-0" : "pt-[calc(3.5rem+env(safe-area-inset-top))] md:pt-6"
        )}
      >
        {会话就绪 ? (
          children
        ) : (
          <div className="flex items-center justify-center py-20 text-sm text-gray-400">
            正在加载...
          </div>
        )}
      </main>
    </PriceVisibilityProvider>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * APP 环境登录守卫
 * 原因：APP 的 WebView 中 @supabase/ssr cookie 不工作，服务端无法做 auth 检查，
 * 所以 layout.tsx 跳过服务端检查。此组件在客户端补充检查，未登录则跳转到登录页。
 */
export function AppAuthGuard() {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    async function checkAuth() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        /* 未登录，跳转到登录页，带上当前路径用于登录后返回 */
        router.push(`/login?redirect=${encodeURIComponent(pathname)}`);
      } else {
        setChecking(false);
      }
    }
    checkAuth();
  }, [router, pathname]);

  if (checking) {
    return (
      <div className="fixed inset-0 z-50 bg-white flex flex-col items-center justify-center">
        <div className="text-gray-400 text-sm">检查登录状态...</div>
      </div>
    );
  }

  return null;
}

"use client";

/* 前端错误自动上报（2026-09-04）
 * window.onerror + unhandledrejection 全局监听，报错写入 app_error_logs 表。
 * 防刷屏：同一错误信息每分钟最多报一次（同一组件崩溃循环渲染会刷爆表）。 */

import { createClient } from "@/lib/supabase/client";
import { 是Capacitor环境 } from "@/lib/capacitorEnv";

const 最近上报 = new Map<string, number>();

export function 上报前端错误(消息: string, 堆栈?: string): void {
  try {
    /* 同一消息每分钟最多一次 */
    const 上次 = 最近上报.get(消息) || 0;
    if (Date.now() - 上次 < 60_000) return;
    最近上报.set(消息, Date.now());

    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      /* 未登录也报（user_id 留空）——登录页的错误同样想知道 */
      supabase
        .from("app_error_logs")
        .insert({
          user_id: data.user?.id || null,
          message: 消息.slice(0, 2000),
          stack: 堆栈?.slice(0, 4000) || null,
          url: typeof window !== "undefined" ? window.location.pathname : null,
          user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
          env: typeof window !== "undefined" && 是Capacitor环境() ? "APP" : "浏览器",
        })
        .then(() => { /* 火忘不管，上报失败不打扰用户 */ });
    });
  } catch {
    /* 上报自身报错绝不抛出，避免错误处理器引发循环 */
  }
}

/* 挂载全局监听（在 AppShell 里调一次） */
export function 挂载错误上报(): () => void {
  function onError(event: ErrorEvent) {
    上报前端错误(event.message || "未知错误", event.error instanceof Error ? event.error.stack : undefined);
  }
  function onRejection(event: PromiseRejectionEvent) {
    const 原因 = event.reason;
    上报前端错误(
      "未处理的 Promise 异常: " + (原因 instanceof Error ? 原因.message : String(原因)),
      原因 instanceof Error ? 原因.stack : undefined
    );
  }
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

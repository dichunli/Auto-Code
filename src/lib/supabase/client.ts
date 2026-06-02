import { createBrowserClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { 是Capacitor环境 } from "@/lib/capacitorEnv";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;
let capacitorClient: ReturnType<typeof createSupabaseClient> | null = null;

/* 从 Supabase URL 中提取项目引用 ID（用于构造 cookie 名称） */
function 获取项目引用(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return "";
  }
}

const 项目引用 = 获取项目引用();
/* Supabase 默认的 auth token 存储 key 格式：sb-<projectRef>-auth-token */
const 认证Cookie名称 = `sb-${项目引用}-auth-token`;

/*
 * APP 环境自定义存储：同时写入 localStorage 和 cookie
 * 这样服务端 middleware/layout 能从 cookie 读取 session，
 * 避免 APP 登录后被服务端踢回登录页的问题
 */
const APP存储 = {
  getItem: (key: string): string | null => {
    if (typeof window === "undefined") return null;
    /* 优先从 localStorage 读取 */
    const localValue = window.localStorage.getItem(key);
    if (localValue) return localValue;
    /* 回退到 cookie（auth token key） */
    if (key === 认证Cookie名称) {
      const match = document.cookie.match(
        new RegExp(`(?:^|; )${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`)
      );
      return match ? decodeURIComponent(match[1]) : null;
    }
    return null;
  },
  setItem: (key: string, value: string): void => {
    if (typeof window === "undefined") return;
    /* 写入 localStorage */
    window.localStorage.setItem(key, value);
    /* 同时写入 cookie（仅 auth token），让服务端能读取 */
    if (key === 认证Cookie名称) {
      const maxAge = 400 * 24 * 60 * 60; /* 400 天，与 @supabase/ssr 默认一致 */
      document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
    }
  },
  removeItem: (key: string): void => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
    if (key === 认证Cookie名称) {
      document.cookie = `${key}=; path=/; max-age=0`;
    }
  },
};

export function createClient() {
  if (是Capacitor环境()) {
    /* APP 环境：用 supabase-js + 自定义存储（localStorage + cookie） */
    if (!capacitorClient) {
      capacitorClient = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          auth: {
            /* 自定义存储，同时写入 localStorage 和 cookie */
            storage: APP存储,
            /* 显式指定 storage key，与服务端 @supabase/ssr 保持一致 */
            storageKey: 认证Cookie名称,
            /* 自动刷新 token */
            autoRefreshToken: true,
            /* 使用 implicit 流程 */
            flowType: "implicit",
            /* 不检测 URL 中的 session */
            detectSessionInUrl: false,
          },
        }
      );
    }
    return capacitorClient;
  }

  /* 浏览器环境：用 ssr 的 cookie 管理 */
  if (!browserClient) {
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return browserClient;
}

/* 导出环境检测，方便页面调试 */
export function 获取当前环境(): "APP" | "浏览器" | "服务端" {
  if (typeof window === "undefined") return "服务端";
  if (是Capacitor环境()) return "APP";
  return "浏览器";
}

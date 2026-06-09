import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";
import { 是Capacitor环境 } from "@/lib/capacitorEnv";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

/* 从 Supabase URL 中提取项目引用 ID（用于构造 storage key） */
function 获取项目引用(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return "";
  }
}

const 项目引用 = 获取项目引用();
const 认证存储Key = `sb-${项目引用}-auth-token`;
const APP认证存储Key = `sb-${项目引用}-auth-token-app`;

/*
 * 浏览器环境统一存储：localStorage 为主，同时同步 cookie 给 middleware 读取
 * 解决 @supabase/ssr 的 createBrowserClient 在 Next.js App Router 客户端路由中的 session 丢失问题
 */
const 浏览器存储 = {
  getItem: (key: string): string | null => {
    if (typeof window === "undefined") return null;
    /* 优先从 localStorage 读取 */
    const localValue = window.localStorage.getItem(key);
    if (localValue) return localValue;
    /* 回退到 cookie */
    if (key === 认证存储Key) {
      const match = document.cookie.match(
        new RegExp(`(?:^|; )${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`)
      );
      return match ? decodeURIComponent(match[1]) : null;
    }
    return null;
  },
  setItem: (key: string, value: string): void => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
    /* 同时写入 cookie，让服务端 middleware 能读取 session */
    if (key === 认证存储Key) {
      const maxAge = 400 * 24 * 60 * 60;
      document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
    }
  },
  removeItem: (key: string): void => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
    if (key === 认证存储Key) {
      document.cookie = `${key}=; path=/; max-age=0`;
    }
  },
};

/* APP 环境存储：只使用 localStorage，不碰 cookie */
const APP存储 = {
  getItem: (key: string): string | null => {
    if (typeof window === "undefined") return null;
    if (key === APP认证存储Key) {
      return window.localStorage.getItem(APP认证存储Key);
    }
    return null;
  },
  setItem: (key: string, value: string): void => {
    if (typeof window === "undefined") return;
    if (key === APP认证存储Key) {
      window.localStorage.setItem(APP认证存储Key, value);
      /* 同时写入 cookie，让服务端 @supabase/ssr 能读取 session */
      const maxAge = 400 * 24 * 60 * 60;
      document.cookie = `${认证存储Key}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
    }
  },
  removeItem: (key: string): void => {
    if (typeof window === "undefined") return;
    if (key === APP认证存储Key) {
      window.localStorage.removeItem(APP认证存储Key);
    }
  },
};

export function createClient() {
  if (是Capacitor环境()) {
    /*
     * APP 环境：不缓存单例，每次都创建新 client。
     * 原因：APP 中登录后只是客户端路由跳转（不刷新页面），
     * 如果缓存单例，登录前创建的无 session 实例会被复用，
     * 导致登录后仍然无法加载数据。
     * 每次创建新实例，确保从 localStorage 重新读取最新 token。
     */
    return createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          storage: APP存储,
          storageKey: APP认证存储Key,
          autoRefreshToken: true,
          flowType: "implicit",
          detectSessionInUrl: false,
        },
      }
    );
  }

  /*
   * 浏览器环境：使用 @supabase/ssr 的 createBrowserClient。
   * 原因：createBrowserClient 会自动分块管理 cookie（token 超 4KB 时），
   * 与服务端 createServerClient 的 cookie 读取机制完全兼容。
   * SSR 阶段（typeof window === "undefined"）仍用 createSupabaseClient，
   * 因为 createBrowserClient 依赖 document.cookie，在服务端不存在。
   */
  if (typeof window === "undefined") {
    return createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          storageKey: 认证存储Key,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      }
    );
  }

  if (!browserClient) {
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          storageKey: 认证存储Key,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      }
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

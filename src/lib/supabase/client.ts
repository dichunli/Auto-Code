import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { 是Capacitor环境 } from "@/lib/capacitorEnv";

let browserClient: ReturnType<typeof createSupabaseClient> | null = null;
let capacitorClient: ReturnType<typeof createSupabaseClient> | null = null;

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
    /* APP 环境：保留单例，WebView 中 localStorage 稳定 */
    if (!capacitorClient) {
      capacitorClient = createSupabaseClient(
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
    return capacitorClient;
  }

  /*
   * 浏览器环境：只在客户端缓存单例。
   * SSR 阶段（typeof window === "undefined"）创建临时实例，不缓存，
   * 避免服务端创建的无 session 实例被当成单例复用。
   * 客户端 hydration 时从 localStorage 重新读取 session，确保认证状态正确。
   */
  if (typeof window === "undefined") {
    return createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          storage: 浏览器存储,
          storageKey: 认证存储Key,
          autoRefreshToken: true,
          flowType: "implicit",
          detectSessionInUrl: false,
        },
      }
    );
  }

  if (!browserClient) {
    browserClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          storage: 浏览器存储,
          storageKey: 认证存储Key,
          autoRefreshToken: true,
          flowType: "implicit",
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

/*
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️  改动前必读 — 认证客户端是全局核心文件，动这里等于动所有用户的登录状态  ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  改这个文件之前，必须回答三个问题：                                    ║
 * ║  1. 这个改动只解决什么问题？不要"顺手"改看起来更好的东西              ║
 * ║  2. 已有用户的 session 存在哪（localStorage / cookie）？              ║
 * ║     新逻辑还能读到旧数据吗？读不到怎么办？                           ║
 * ║  3. 改完必须测：已登录用户刷新页面，数据还显示吗？                    ║
 * ║                                                                     ║
 * ║  历史教训：2026-06-09 把 createSupabaseClient 换成 createBrowserClient ║
 * ║  时移除了自定义 storage，导致已登录用户 session 无法读取，全站数据   ║
 * ║  加载为空。修复：createBrowserClient 配回兼容存储（先读cookie回退    ║
 * ║  localStorage）。                                                    ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { 是Capacitor环境 } from "@/lib/capacitorEnv";

let browserClient: ReturnType<typeof createSupabaseClient> | null = null;
let appClient: ReturnType<typeof createSupabaseClient> | null = null;

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
    /*
     * 优先从 localStorage 读取（无大小限制，不会被截断）。
     * 之前优先从 cookie 读取，但 cookie 有 4KB 限制，大 session 会被浏览器
     * 静默截断，导致 GoTrueClient 解析失败并调用 removeItem 清除 session
     *（连带 localStorage 中的完整 session 也被清除了）。
     */
    const localValue = window.localStorage.getItem(key);
    if (localValue) return localValue;
    /* 回退到 cookie（兼容仅从 cookie 登录的旧 session）*/
    if (key === 认证存储Key) {
      const match = document.cookie.match(
        new RegExp(`(?:^|; )${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`)
      );
      if (match) return decodeURIComponent(match[1]);
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
    /* APP 环境：缓存单例。登录后 onAuthStateChange 会自动更新 session，无需重复创建。 */
    if (!appClient) {
      appClient = createSupabaseClient(
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
    return appClient;
  }

  /*
   * 浏览器环境：使用 createSupabaseClient + 自定义 storage。
   * 原因：createBrowserClient 的默认 cookie 存储跟 createServerClient
   * 的读取机制在实际使用中对不上，导致服务端读不到 session。
   * createSupabaseClient + 自定义 storage（localStorage + cookie 同步）
   * 是本项目验证过的稳定方案。
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
    browserClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          storage: 浏览器存储,
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

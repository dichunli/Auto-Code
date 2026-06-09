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
import { stringFromBase64URL } from "@supabase/ssr";
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

/* base64url 解码（兼容 @supabase/ssr 的 cookie 编码，支持 UTF-8） */
function base64url解码(str: string): string {
  return stringFromBase64URL(str);
}

/* 解析 @supabase/ssr 格式的 cookie 值（支持 base64- 前缀和分段 cookie） */
function 从SSRCookie解析Session(key: string): string | null {
  /* 1. 尝试读取单个 cookie */
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`)
  );
  const cookieValue = match ? decodeURIComponent(match[1]) : null;

  if (cookieValue) {
    /* 1a. 直接是 JSON（当前自定义格式） */
    try {
      const parsed = JSON.parse(cookieValue);
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.access_token === "string" &&
        typeof parsed.refresh_token === "string" &&
        parsed.access_token.length > 0 &&
        parsed.refresh_token.length > 0
      ) {
        return cookieValue;
      }
    } catch {
      /* 不是纯 JSON，继续尝试 */
    }

    /* 1b. @supabase/ssr 的 base64url 格式 */
    if (cookieValue.startsWith("base64-")) {
      try {
        const decoded = base64url解码(cookieValue.substring("base64-".length));
        const parsed = JSON.parse(decoded);
        if (
          parsed &&
          typeof parsed === "object" &&
          typeof parsed.access_token === "string" &&
          typeof parsed.refresh_token === "string" &&
          parsed.access_token.length > 0 &&
          parsed.refresh_token.length > 0
        ) {
          return decoded;
        }
      } catch {
        /* 解码失败 */
      }
    }
  }

  /* 2. 尝试读取分段 cookie（sb-key.0, sb-key.1, ...） */
  const chunks: string[] = [];
  for (let i = 0; ; i++) {
    const chunkName = i === 0 ? key : `${key}.${i}`;
    const chunkMatch = document.cookie.match(
      new RegExp(`(?:^|; )${chunkName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`)
    );
    if (!chunkMatch) break;
    chunks.push(decodeURIComponent(chunkMatch[1]));
  }

  if (chunks.length > 0) {
    try {
      const combined = chunks.join("");
      let decoded: string;
      if (combined.startsWith("base64-")) {
        decoded = base64url解码(combined.substring("base64-".length));
      } else {
        decoded = combined;
      }
      const parsed = JSON.parse(decoded);
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.access_token === "string" &&
        typeof parsed.refresh_token === "string" &&
        parsed.access_token.length > 0 &&
        parsed.refresh_token.length > 0
      ) {
        return decoded;
      }
    } catch {
      /* 分段解析失败 */
    }
  }

  return null;
}

/*
 * 浏览器环境统一存储：localStorage 为主，同时同步 cookie 给 middleware 读取
 * 解决 @supabase/ssr 的 createBrowserClient 在 Next.js App Router 客户端路由中的 session 丢失问题
 */
const 浏览器存储 = {
  getItem: (key: string): string | null => {
    if (typeof window === "undefined") return null;
    /* 优先从 cookie 读取（兼容当前格式和 @supabase/ssr 的旧格式） */
    if (key === 认证存储Key) {
      const ssrValue = 从SSRCookie解析Session(key);
      if (ssrValue) {
        /* 如果读到了 @supabase/ssr 格式的数据，同步到 localStorage 以便后续读取 */
        window.localStorage.setItem(key, ssrValue);
        return ssrValue;
      }
    }
    /* 回退到 localStorage（完整数据，无大小限制）*/
    return window.localStorage.getItem(key);
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
            flowType: "pkce",
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
          flowType: "pkce",
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

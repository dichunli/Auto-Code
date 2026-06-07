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
/* 浏览器环境：@supabase/ssr 的 createBrowserClient 使用默认 cookie 管理 */
/* APP 环境：独立 storage key，避免和浏览器 cookie 格式冲突 */
const APP认证存储Key = `sb-${项目引用}-auth-token-app`;

/*
 * APP 环境自定义存储：只使用 localStorage，不碰 cookie
 * 避免和浏览器环境的 @supabase/ssr createBrowserClient 互相污染
 * APP 环境的服务端 auth 检查已由 middleware 跳过
 */
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
    /* APP 环境：用 supabase-js + 独立 localStorage 存储 */
    if (!capacitorClient) {
      capacitorClient = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          auth: {
            /* APP 环境独立存储，避免和浏览器 @supabase/ssr cookie 格式冲突 */
            storage: APP存储,
            storageKey: APP认证存储Key,
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

  /* 浏览器环境：用 ssr 的 cookie 管理，单例避免重复创建 */
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

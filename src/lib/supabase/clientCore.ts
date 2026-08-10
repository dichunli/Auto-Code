/* ═══ createClient 三环境入口（APP / 浏览器 / 服务端） ═══
 * 从 client.ts 拆出（2026-08 认证层重构，纯搬家零行为变化）
 *
 * ⚠️ 改动前必读 — 认证客户端是全局核心，动这里等于动所有用户的登录状态：
 * 1. 这个改动只解决什么问题？不要"顺手"改看起来更好的东西
 * 2. 已有用户的 session 存在哪（localStorage / cookie）？新逻辑还能读到旧数据吗？
 * 3. 改完必须测：已登录用户刷新页面，数据还显示吗？
 * 历史教训见 client.ts 头注（2026-06-09 storage 丢失事故、2026-06-11 cookie 分段根治） */
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { 是Capacitor环境 } from "@/lib/capacitorEnv";
import { 包装写操作标记 } from "./clientWriteMarker";
import { 认证存储Key, APP认证存储Key, 浏览器存储, APP存储 } from "./sessionStorage";

/* 裸 SupabaseClient（默认泛型）：与 createSupabaseClient(url, key) 推导出的实例类型一致。
 * 不能用 ReturnType<typeof createSupabaseClient>——泛型函数 typeof 的 ReturnType 会按 unknown 实例化，太窄 */
let browserClient: SupabaseClient | null = null;
let appClient: SupabaseClient | null = null;

export function createClient() {
  if (是Capacitor环境()) {
    /* APP 环境：缓存单例。登录后 onAuthStateChange 会自动更新 session，无需重复创建。 */
    if (!appClient) {
      appClient = 包装写操作标记(createSupabaseClient(
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
      ));
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
    browserClient = 包装写操作标记(createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          storage: 浏览器存储,
          storageKey: 认证存储Key,
          autoRefreshToken: true,
          flowType: "pkce",
          detectSessionInUrl: false,
        },
      }
    ));
  }
  return browserClient;
}

/* 导出环境检测，方便页面调试 */
export function 获取当前环境(): "APP" | "浏览器" | "服务端" {
  if (typeof window === "undefined") return "服务端";
  if (是Capacitor环境()) return "APP";
  return "浏览器";
}

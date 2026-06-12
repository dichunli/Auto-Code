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
 * ║  2026-06-11 统一写 cookie 格式：改用 @supabase/ssr 官方 createChunks ║
 * ║  + base64- 编码分段写入，与服务端读取格式一致，根治单条 cookie 超 4KB ║
 * ║  被浏览器静默截断导致服务端读不到 session 的偶发问题。localStorage   ║
 * ║  仍为主仓库（读取优先），老用户不掉线。                              ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { stringFromBase64URL, stringToBase64URL, createChunks } from "@supabase/ssr";
import { 是Capacitor环境 } from "@/lib/capacitorEnv";

/*
 * cookie 单段最大字节数：与 @supabase/ssr 的 createChunks 默认值（MAX_CHUNK_SIZE=3180）保持一致。
 * 浏览器单条 cookie 上限约 4KB，3180 留足了 cookie 名、编码膨胀和分隔符的余量。
 */
const COOKIE最大段大小 = 3180;

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

/*
 * 写入 session cookie（与 @supabase/ssr 服务端读取格式完全一致）：
 * 1. 用 base64- 前缀 + base64url 编码（服务端 createServerClient 认这种格式）
 * 2. 超过单段上限时，用官方 createChunks 切成 key.0、key.1… 多段写入
 *    —— 解决「单条 cookie 超 4KB 被浏览器静默截断 → 服务端读不到 session」的隐患
 * 写入前先清掉旧的分段，避免上次 3 段、这次 2 段时残留第 3 段导致解析错乱。
 */
function 写入Session到Cookie(key: string, value: string): void {
  清除Session的Cookie(key);
  const 编码值 = "base64-" + stringToBase64URL(value);
  const maxAge = 400 * 24 * 60 * 60;
  const chunks = createChunks(key, 编码值, COOKIE最大段大小);
  for (const chunk of chunks) {
    document.cookie = `${chunk.name}=${encodeURIComponent(chunk.value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
  }
}

/*
 * 清除 session cookie：单条 + 所有分段（key、key.0、key.1…）一并删除，
 * 防止退出登录或重新登录后残留旧 cookie 段。
 */
function 清除Session的Cookie(key: string): void {
  document.cookie = `${key}=; path=/; max-age=0`;
  for (let i = 0; i < 10; i++) {
    document.cookie = `${key}.${i}=; path=/; max-age=0`;
  }
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
    /*
     * 优先从 localStorage 读取（无大小限制，不会被截断）。
     * 之前优先从 cookie 读取，但 cookie 有 4KB 限制，大 session 会被浏览器
     * 静默截断，导致 GoTrueClient 解析失败并调用 removeItem 清除 session
     *（连带 localStorage 中的完整 session 也被清除了）。
     */
    const localValue = window.localStorage.getItem(key);
    if (localValue) return localValue;
    /*
     * 回退到 cookie（兼容仅从 cookie 登录的旧 session，包括 @supabase/ssr 格式）。
     * 如果读到了有效数据，同步到 localStorage 以便后续优先读取。
     */
    if (key === 认证存储Key) {
      const ssrValue = 从SSRCookie解析Session(key);
      if (ssrValue) {
        window.localStorage.setItem(key, ssrValue);
        return ssrValue;
      }
    }
    return null;
  },
  setItem: (key: string, value: string): void => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
    /* 同时写入 cookie（base64-+分段，与服务端 @supabase/ssr 读取格式一致），让服务端能读取 session */
    if (key === 认证存储Key) {
      写入Session到Cookie(key, value);
    }
  },
  removeItem: (key: string): void => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
    if (key === 认证存储Key) {
      清除Session的Cookie(key);
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
      /* 同时写入 cookie（base64-+分段，与服务端 @supabase/ssr 读取格式一致），让服务端能读取 session */
      写入Session到Cookie(认证存储Key, value);
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
          flowType: "pkce",
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

/*
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  确保会话就绪 — 修复「点菜单软跳转进列表页，数据为空，刷新才出来」    ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  根因：localStorage 里有有效 session（未过期、字段完整），但客户端   ║
 * ║  单例实例在软跳转时未把它读入内存，getSession() 返回空，查询被 RLS   ║
 * ║  当作未登录过滤，返回 0 条（HTTP 200 但无数据，不报错）。F5 整页刷新 ║
 * ║  会重建客户端、重新读取，所以刷新就正常。                            ║
 * ║  修复：进入应用时（AppShell 挂载）先调用本函数——若客户端无 session   ║
 * ║  但 localStorage/cookie 里有有效的，手动 setSession 注入，再放行页面 ║
 * ║  查询。结果用 Promise 缓存，全站只跑一次，不阻塞后续导航。           ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */
let 会话就绪Promise: Promise<void> | null = null;

export function 确保会话就绪(): Promise<void> {
  /* 服务端无 localStorage，APP 环境由 onAuthStateChange 自管，均无需处理 */
  if (typeof window === "undefined" || 是Capacitor环境()) {
    return Promise.resolve();
  }
  /* 缓存：全站只执行一次注入，后续导航直接复用结果 */
  if (会话就绪Promise) return 会话就绪Promise;

  会话就绪Promise = (async () => {
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      /* 客户端已有 session，无需注入 */
      if (data.session) return;

      /* 客户端没读到，但本地存储里可能有（getItem 已含 cookie 回退逻辑） */
      const 原始值 = 浏览器存储.getItem(认证存储Key);
      if (!原始值) return;

      const 会话 = JSON.parse(原始值) as {
        access_token?: string;
        refresh_token?: string;
      };
      if (!会话.access_token || !会话.refresh_token) return;

      /* 手动注入：让客户端实例认得这份登录态，后续查询才会带上 token */
      await supabase.auth.setSession({
        access_token: 会话.access_token,
        refresh_token: 会话.refresh_token,
      });
    } catch (err: unknown) {
      console.log("[会话就绪] 异常:", err instanceof Error ? err.message : String(err));
      /* 注入失败（数据损坏/网络异常）静默放行，不阻塞页面，按未登录处理 */
    }
  })();

  return 会话就绪Promise;
}

/*
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  确保有 session — 修复「登录后 getSession 返回空，数据加载为空」      ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  根因：supabase-js 后台自动刷新 token 时因网络超时失败，清空了内存   ║
 * ║  中的 session，但 localStorage 里还有完整数据。导致 getSession()     ║
 * ║  返回 null → 查询不带 token → RLS 过滤 → 数据为空。                  ║
 * ║  修复：每次页面查询前调用本函数——若内存中无 session 但 localStorage   ║
 * ║  有完整的，重新 setSession 注入，确保后续查询带 token。               ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */
export async function 确保有session(): Promise<void> {
  if (typeof window === "undefined" || 是Capacitor环境()) return;

  try {
    const supabase = createClient();
    /* 不检查内存中的 getSession，直接读 localStorage 强制注入。
     * 原因：supabase-js 后台 token 刷新可能因网络超时清空内存 session，
     * 而 localStorage 里数据完好。两个 await 之间的微任务窗口就能触发清除。 */
    const 原始值 = 浏览器存储.getItem(认证存储Key);
    if (!原始值) return;

    const 会话 = JSON.parse(原始值) as {
      access_token?: string;
      refresh_token?: string;
      expires_at?: number;
    };
    if (!会话.access_token || !会话.refresh_token) return;

    /* access_token 过期（当前时间超过 expires_at）也跳过，避免注入已过期 token */
    if (会话.expires_at && Date.now() / 1000 >= 会话.expires_at) return;

    /* 强制注入：不管内存有没有，一律覆盖，确保后续查询一定带 token */
    await supabase.auth.setSession({
      access_token: 会话.access_token,
      refresh_token: 会话.refresh_token,
    });
  } catch {
    /* 静默忽略 */
  }
}


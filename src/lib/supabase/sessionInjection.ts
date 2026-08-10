/* ═══ 会话注入（确保会话就绪 / 确保有session / 获取访问令牌） ═══
 * 从 client.ts 拆出（2026-08 认证层重构，纯搬家零行为变化）
 *
 * 修复的历史问题：
 * - 「软跳转进列表页数据为空，刷新才出来」：客户端单例未把 localStorage 的
 *   session 读入内存，getSession() 返回空被 RLS 当未登录过滤
 * - 「token 过期后保存被拒（401/42501）」：曾有过"过期就放弃注入"的判断，
 *   已删除——过期令牌交给 setSession 自动续期
 * 两个对外函数的唯一区别是调用时机：确保会话就绪 全站只跑一次且先看内存，
 * 确保有session 在写库/查询前每次强制注入。 */
import { 是Capacitor环境 } from "@/lib/capacitorEnv";
import { 从SSRCookie解析Session } from "./sessionCookie";
import { 认证存储Key, APP认证存储Key } from "./sessionStorage";
import { createClient } from "./clientCore";

/* 判断本地 session 字符串是否已过期 */
function isSessionExpired(raw: string): boolean {
  try {
    const session = JSON.parse(raw) as { expires_at?: number };
    if (session.expires_at && Date.now() / 1000 >= session.expires_at) return true;
  } catch {
    /* 解析失败视为过期，让调用方尝试其它来源 */
    return true;
  }
  return false;
}

/*
 * ═══ 统一的会话注入核心（确保会话就绪 / 确保有session 共用）═══
 * 从本地存储读出完整会话并 setSession 注入客户端实例：
 * 1. 优先读 localStorage（主仓库，无 4KB 截断风险）
 * 2. localStorage 没有或已过期时，回退读 SSR cookie（含分段/base64- 解析）
 * 3. cookie 补救来的会话同步回 localStorage，避免下次再绕
 * 即使 access_token 已过期也照常注入 —— setSession 会自动用 refresh_token 续期。
 */
async function 注入本地存储会话(
  supabase: ReturnType<typeof createClient>
): Promise<void> {
  /* 优先读 localStorage */
  let 原始值: string | null = window.localStorage.getItem(认证存储Key);
  let 来自Cookie = false;

  /* 如果 localStorage 没有，或者里面的 session 已过期，尝试从 cookie 补救 */
  if (!原始值 || isSessionExpired(原始值)) {
    const cookieValue = 从SSRCookie解析Session(认证存储Key);
    if (cookieValue && !isSessionExpired(cookieValue)) {
      原始值 = cookieValue;
      来自Cookie = true;
    }
  }

  if (!原始值) return;

  const 会话 = JSON.parse(原始值) as {
    access_token?: string;
    refresh_token?: string;
  };
  if (!会话.access_token || !会话.refresh_token) return;

  /* 强制注入：把 access_token + refresh_token 交给 setSession，过期令牌由它自动续期 */
  await supabase.auth.setSession({
    access_token: 会话.access_token,
    refresh_token: 会话.refresh_token,
  });

  /* 如果用了 cookie 里的 session，同步回 localStorage，避免下次再从 cookie 绕 */
  if (来自Cookie) {
    window.localStorage.setItem(认证存储Key, 原始值);
  }
}

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

      /* 客户端没读到，从本地存储（localStorage / cookie）注入 */
      await 注入本地存储会话(supabase);
    } catch (err: unknown) {
      console.log("[会话就绪] 异常:", err instanceof Error ? err.message : String(err));
      /* 注入失败（数据损坏/网络异常）静默放行，不阻塞页面，按未登录处理 */
    }
  })();

  return 会话就绪Promise;
}

/*
 * 确保有 session —— 修复「登录后 getSession 返回空，数据加载为空」。
 * supabase-js 后台自动刷新 token 时因网络超时失败，清空了内存中的 session，
 * 但 localStorage 里还有完整数据。每次页面查询前调用本函数强制注入。
 */
export async function 确保有session(): Promise<void> {
  if (typeof window === "undefined" || 是Capacitor环境()) return;

  try {
    const supabase = createClient();
    /* 与 确保会话就绪 共用同一套注入逻辑，区别仅在于本函数每次都强制注入 */
    await 注入本地存储会话(supabase);
  } catch {
    /* 静默忽略 */
  }
}

/*
 * 获取当前 access_token（用于 API 请求头）。
 * APP 环境优先读 APP 专属 localStorage key，浏览器环境读通用 key。
 * 过期 token 会被跳过。
 */
export function 获取访问令牌(): string | null {
  if (typeof window === "undefined") return null;
  const keys = [APP认证存储Key, 认证存储Key];
  for (const key of keys) {
    const raw = window.localStorage.getItem(key);
    if (!raw) continue;
    try {
      const session = JSON.parse(raw) as { access_token?: string; expires_at?: number };
      if (session.access_token) {
        if (session.expires_at && Date.now() / 1000 >= session.expires_at) continue;
        return session.access_token;
      }
    } catch {
      /* 解析失败继续下一个 key */
    }
  }
  return null;
}

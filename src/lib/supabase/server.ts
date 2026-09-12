import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { createClient as 创建一次性客户端, type User } from "@supabase/supabase-js";

/* 从 Supabase URL 中提取项目引用 ID，确保服务端 cookie 名称与客户端一致 */
function 获取项目引用(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return "";
  }
}

export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw new Error("Missing env NEXT_PUBLIC_SUPABASE_URL");
  if (!key) throw new Error("Missing env NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const cookieStore = await cookies();

  /* 生产环境 / HTTPS 下启用 Secure；HttpOnly 只能由服务端设置 */
  const isSecure = process.env.NODE_ENV === "production" || url.startsWith("https://");

  /* cookie 名称必须与客户端写入的名称完全一致，否则服务端读不到 session */
  const 认证Cookie名称 = `sb-${获取项目引用()}-auth-token`;

  return createServerClient(url, key, {
    cookieOptions: {
      name: 认证Cookie名称,
      secure: isSecure,
      httpOnly: true,
      /* SameSite 属性值浏览器不区分大小写，类型定义要求小写 */
      sameSite: "lax",
      path: "/",
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, {
              ...options,
              secure: isSecure,
              httpOnly: true,
              sameSite: "lax",
              path: "/",
            })
          );
        } catch {
          // 在 Server Component 中 set cookie 会报错，忽略即可
        }
      },
    },
  });
}

/*
 * 验证当前请求是否已登录。
 * Server Action / API Route 中先用这个函数确认用户身份，
 * 不要把 session 有效性完全交给 RLS 兜底。
 */
export async function 验证用户已登录(): Promise<{ user: User | null; error?: string }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return { user: null, error: "未登录或登录已过期，请重新登录" };
    }
    return { user: data.user };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "未知错误";
    return { user: null, error: "验证登录状态失败: " + msg };
  }
}

/*
 * 验证接口调用者已登录（cookie 会话 或 Bearer token 二选一）。
 * 用途：「"use server" 的付费接口文件」（17VIN、百度OCR 等）的统一门禁——
 * 2026-09-12 诊断发现这些文件所有导出函数零鉴权，任何人可匿名盗刷付费额度。
 *
 * 两条路径都要的原因：
 * - 浏览器 / APP WebView 直接调 Server Action → 带 cookie（APP 有镜像 cookie，见 clientCore.ts）
 * - APP 走 API 路由（如 /api/vin-ocr）用 Bearer 认证后，路由内部转调 action → 只有 Bearer
 */
export async function 验证接口调用者已登录(): Promise<{ user: User | null; error?: string }> {
  /* 先走 cookie 会话（覆盖浏览器和 APP WebView） */
  const cookie结果 = await 验证用户已登录();
  if (cookie结果.user) return cookie结果;

  /* 再走 Bearer token（API 路由内部转调场景） */
  try {
    const h = await headers();
    const auth = h.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) {
      return { user: null, error: cookie结果.error || "未登录或登录已过期，请重新登录" };
    }
    const token = auth.slice(7);
    if (!token || token === "undefined" || token === "null") {
      return { user: null, error: "未登录或登录已过期，请重新登录" };
    }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return { user: null, error: "服务端缺少 Supabase 配置" };
    const 一次性 = 创建一次性客户端(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await 一次性.auth.getUser(token);
    if (error || !data.user) return { user: null, error: "登录已过期，请重新登录" };
    return { user: data.user };
  } catch {
    return { user: null, error: cookie结果.error || "未登录或登录已过期，请重新登录" };
  }
}

/*
 * 包装 Server Action 的通用异常处理：
 * 捕获未处理的异常，返回统一格式，避免泄露堆栈或敏感信息。
 */
export function 包装ServerAction错误<T>(
  执行: () => Promise<T>
): Promise<T | { success: false; error: string }> {
  return 执行().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : "系统异常，请稍后重试";
    return { success: false, error: msg };
  });
}

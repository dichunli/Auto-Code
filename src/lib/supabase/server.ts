import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { type User } from "@supabase/supabase-js";

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

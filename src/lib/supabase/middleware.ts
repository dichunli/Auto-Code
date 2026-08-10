import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser() 可能因网络超时而卡住，加 5 秒保护
  let user = null;
  let getUser失败于网络 = false;
  try {
    const getUserPromise = supabase.auth.getUser();
    const timeoutPromise = new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error("getUser timeout")), 5000)
    );
    const result = (await Promise.race([getUserPromise, timeoutPromise])) as { data?: { user?: unknown } | null };
    user = result.data?.user || null;
  } catch {
    getUser失败于网络 = true;
    user = null;
  }

  /*
   * 区分两种"无用户"场景：
   * 1. 真的没登录（没有 session cookie） → 跳登录页
   * 2. 有 session cookie 但 getUser() 网络超时 → 放行，让客户端自己处理 session 恢复
   *    修复：首次登录后 getUser() 偶发超时导致被踢回登录页、清空表单的问题
   */
  const 请求中有SessionCookie = request.cookies.getAll().some(
    (c) => c.name.includes("-auth-token") && c.value.length > 0
  );

  /*
   * 公开路径白名单：/login 自不必说；/quote/ 是供应商报价页（token 即凭证，免登录）。
   * 注意必须用 "/quote/"（带斜杠）：/quote-sheets 是内部管理页，仍要求登录。
   * /api/cron/ 是 Windows 计划任务调用的定时同步接口（无登录态，接口内部自带 CRON_SECRET 校验）。
   */
  const 是公开路径 =
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/quote/") ||
    request.nextUrl.pathname.startsWith("/api/cron/");

  if (!user && !是公开路径) {
    if (getUser失败于网络 && 请求中有SessionCookie) {
      // 网络临时故障但 session cookie 存在，放行不踢回登录页
      return supabaseResponse;
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

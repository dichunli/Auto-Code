import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

function 是移动设备(userAgent: string): boolean {
  return /Mobile|Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(userAgent);
}

function 是APP环境(userAgent: string): boolean {
  return (
    userAgent.includes("wv") || /* Android WebView 标识 */
    userAgent.includes("Capacitor") ||
    (!userAgent.includes("Chrome/") && userAgent.includes("Linux; Android")) /* 无 Chrome 版本号的 Android WebView */
  );
}

export async function middleware(request: NextRequest) {
  const userAgent = request.headers.get("user-agent") || "";
  const { pathname } = request.nextUrl;

  /* ========== APP 环境：跳过服务端 auth 检查，由客户端自行处理 ==========
   * 原因：@supabase/ssr 的 cookie 机制在 WebView 中不可靠，APP 环境完全由
   * 客户端 createClient()（supabase-js + localStorage）管理认证状态。
   * 包括 /work-orders、/work-orders/:id 等非 /m 路径，在 APP 中也会被访问。
   */
  if (是APP环境(userAgent)) {
    return NextResponse.next();
  }

  /* ========== 先处理 Supabase 会话（登录状态、Cookie 刷新） ========== */
  const sessionResponse = await updateSession(request);

  /* 如果会话逻辑已经触发重定向（如未登录去登录页），直接返回 */
  if (sessionResponse.status !== 200) {
    return sessionResponse;
  }

  /* ========== 移动端重定向逻辑（来自原来的 proxy.ts） ========== */
  if (!是移动设备(userAgent)) {
    return sessionResponse;
  }

  /* 已经是移动端页面或登录页、API，不再重定向 */
  if (pathname.startsWith("/m/") || pathname.startsWith("/login") || pathname.startsWith("/api/")) {
    return sessionResponse;
  }

  /* 用户手动选择桌面版，记录 30 天偏好 */
  if (request.nextUrl.searchParams.has("desktop")) {
    const response = NextResponse.next();
    response.cookies.set("prefer-desktop", "1", { maxAge: 60 * 60 * 24 * 30 });
    return response;
  }

  /* 用户设置了桌面版偏好，尊重选择 */
  if (request.cookies.get("prefer-desktop")?.value === "1") {
    return sessionResponse;
  }

  /* 移动端访问首页，自动跳转到手机工作台 */
  if (pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/m/";
    return NextResponse.redirect(url);
  }

  return sessionResponse;
}

export const config = {
  matcher: [
    /*
     * 匹配所有路径，排除静态资源
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|css|woff|woff2|ttf)$).*)",
  ],
};

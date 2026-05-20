import { NextResponse } from "next/server";
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

function isMobileDevice(userAgent: string): boolean {
  return /Mobile|Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(userAgent);
}

export async function proxy(request: NextRequest) {
  /* 先处理 Supabase 会话（登录状态、Cookie 刷新） */
  const sessionResponse = await updateSession(request);

  /* 如果会话逻辑已经触发重定向（如未登录去登录页），直接返回 */
  if (sessionResponse.status !== 200) {
    return sessionResponse;
  }

  const { pathname } = request.nextUrl;
  const userAgent = request.headers.get("user-agent") || "";

  /* 非移动端设备不处理 */
  if (!isMobileDevice(userAgent)) {
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
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|css|woff|woff2|ttf)$).*)",
  ],
};

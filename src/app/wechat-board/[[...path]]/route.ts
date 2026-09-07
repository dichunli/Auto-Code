import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import fs from "fs/promises";
import path from "path";

/*
 * 配件需求看板文件服务（微信群采集工具 poller2.py 生成的静态文件）
 * 为什么不用 public/ 目录：Next.js 生产模式只认构建时存在的静态文件，
 * 采集工具运行期不断生成新图片，放 public 里会 404。这里改成路由实时读磁盘。
 * 文件根目录：scripts/wechat-poller/输出（相对项目根目录，不进 public 防泄露）
 */

const 看板根目录 = path.join(process.cwd(), "scripts", "wechat-poller", "输出");

const 类型表: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  // 权限校验：图片等扩展名的请求不走中间件，必须在这里自己验登录（双保险）
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const { path: 路径段们 } = await params;
  // 直接访问 /wechat-board 时默认打开看板主页
  const 相对路径 = (路径段们 ?? []).join("/") || "配件需求看板.html";

  // 防目录穿越（拒绝 ../ 之类的请求）
  const 绝对路径 = path.resolve(看板根目录, 相对路径);
  if (!绝对路径.startsWith(看板根目录 + path.sep) && 绝对路径 !== 看板根目录) {
    return new NextResponse("禁止访问", { status: 403 });
  }

  try {
    const 内容 = await fs.readFile(绝对路径);
    const 扩展名 = path.extname(绝对路径).toLowerCase();
    return new NextResponse(new Uint8Array(内容), {
      headers: {
        "Content-Type": 类型表[扩展名] ?? "application/octet-stream",
        "Cache-Control": "no-cache", // 看板每 30 秒更新，禁止缓存
      },
    });
  } catch {
    return new NextResponse("文件不存在（采集工具可能还没生成）", { status: 404 });
  }
}

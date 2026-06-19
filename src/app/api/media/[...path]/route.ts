import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { createClient } from "@/lib/supabase/server";

/* 本地附件存储根目录（可通过环境变量 UPLOAD_DIR 配置） */
const UPLOAD_DIR = process.env.UPLOAD_DIR || "E:/autorepair-uploads";

/* 判断是否为 APP（安卓 WebView）环境。
 * 逻辑与 src/middleware.ts 的「是APP环境」保持一致：
 * APP 用 localStorage 管理登录态、cookie 不可用，<img>/<video> 请求带不上身份，
 * 因此 APP 环境放行（与 middleware 整站放行 APP 的策略一致），否则 APP 内图片会全部裂图。 */
function 是APP环境(userAgent: string): boolean {
  return (
    userAgent.includes("wv") || /* Android WebView 标识 */
    userAgent.includes("Capacitor") ||
    (!userAgent.includes("Chrome/") && userAgent.includes("Linux; Android")) /* 无 Chrome 版本号的 Android WebView */
  );
}

const mimeTypes: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".3gp": "video/3gpp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    /* 认证检查：浏览器环境必须登录（<img>/<video> 会自动带 cookie）；
     * APP（WebView）环境放行，因其用 localStorage 管理登录态、cookie 不可用。 */
    const userAgent = request.headers.get("user-agent") || "";
    if (!是APP环境(userAgent)) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return NextResponse.json({ error: "未登录" }, { status: 401 });
      }
    }

    const { path: pathSegments } = await params;
    const filePath = path.join(UPLOAD_DIR, ...pathSegments);

    /* 安全检查：防止目录遍历 */
    const resolvedPath = path.resolve(filePath);
    const resolvedUploadDir = path.resolve(UPLOAD_DIR);
    if (!resolvedPath.startsWith(resolvedUploadDir)) {
      return NextResponse.json({ error: "非法路径" }, { status: 403 });
    }

    const buffer = await readFile(resolvedPath);

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || "application/octet-stream";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000",
      },
    });
  } catch {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }
}

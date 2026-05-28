import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

/* 使用 Node.js 运行时 */
export const runtime = "nodejs";

const UPLOAD_DIR = "E:/autorepair-uploads";

/* 允许的图片 MIME 类型 */
const 允许的图片类型 = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export async function POST(request: Request) {
  try {
    const { url } = await request.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "缺少 URL 参数" }, { status: 400 });
    }

    /* 安全校验：必须是 http/https */
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json({ error: "非法 URL" }, { status: 400 });
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return NextResponse.json({ error: "仅支持 HTTP/HTTPS" }, { status: 400 });
    }

    /* 下载图片 */
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `下载失败: HTTP ${response.status}` },
        { status: 502 }
      );
    }

    /* 校验 Content-Type */
    const contentType = response.headers.get("content-type") || "";
    const mimeType = contentType.split(";")[0].trim().toLowerCase();
    if (!允许的图片类型.has(mimeType)) {
      return NextResponse.json(
        { error: `不支持的文件类型: ${mimeType}` },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    /* 限制文件大小 30MB */
    if (buffer.length > 30 * 1024 * 1024) {
      return NextResponse.json({ error: "文件超过 30MB" }, { status: 400 });
    }

    /* 按日期分目录 */
    const now = new Date();
    const dateDir = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const dir = path.join(UPLOAD_DIR, dateDir);
    await mkdir(dir, { recursive: true });

    /* 确定扩展名 */
    const extMap: Record<string, string> = {
      "image/jpeg": ".jpg",
      "image/jpg": ".jpg",
      "image/png": ".png",
      "image/gif": ".gif",
      "image/webp": ".webp",
    };
    const ext = extMap[mimeType] || ".jpg";
    const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
    const filePath = path.join(dir, fileName);

    await writeFile(filePath, buffer);

    const relativePath = `${dateDir}/${fileName}`;
    return NextResponse.json({ path: `/api/media/${relativePath}` });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "处理失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

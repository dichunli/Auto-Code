import { NextResponse } from "next/server";
import { stat } from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { Readable } from "stream";

/* 本地附件存储根目录（可通过环境变量 UPLOAD_DIR 配置） */
const UPLOAD_DIR = process.env.UPLOAD_DIR || "E:/autorepair-uploads";

/* 判断是否为 APP（安卓 WebView）环境 */
function 是APP环境(userAgent: string): boolean {
  return (
    userAgent.includes("wv") ||
    userAgent.includes("Capacitor") ||
    (!userAgent.includes("Chrome/") && userAgent.includes("Linux; Android"))
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

/* 视频/音频扩展名 */
const 视频音频扩展名 = new Set([".mp4", ".webm", ".mov", ".3gp", ".mp3", ".wav"]);

/**
 * 检查请求是否带有有效 session cookie（不调 Supabase，纯本地检查，避免网络延迟）
 * 媒体文件 URL 使用随机文件名，无法被猜测，安全性可接受
 */
function 有SessionCookie(request: Request): boolean {
  const cookies = request.headers.get("cookie") || "";
  /* 检查是否包含 Supabase auth token cookie */
  return cookies.includes("-auth-token");
}

/**
 * 将 Node.js Readable Stream 转为 Web ReadableStream
 */
function nodeStreamToWebStream(nodeStream: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      nodeStream.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      nodeStream.on("end", () => {
        controller.close();
      });
      nodeStream.on("error", (err: Error) => {
        controller.error(err);
      });
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    /* ── 轻量级认证：只检查 cookie 存在性，不调 Supabase 远程验证 ── */
    const userAgent = request.headers.get("user-agent") || "";
    if (!是APP环境(userAgent) && !有SessionCookie(request)) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { path: pathSegments } = await params;
    const filePath = path.join(UPLOAD_DIR, ...pathSegments);

    /* 安全检查：防止目录遍历 */
    const resolvedPath = path.resolve(filePath);
    const resolvedUploadDir = path.resolve(UPLOAD_DIR);
    if (!resolvedPath.startsWith(resolvedUploadDir)) {
      return NextResponse.json({ error: "非法路径" }, { status: 403 });
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || "application/octet-stream";

    /* 获取文件大小 */
    let fileStats;
    try {
      fileStats = await stat(resolvedPath);
    } catch {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }
    const fileSize = fileStats.size;
    const 是视频音频 = 视频音频扩展名.has(ext);

    /* ── 视频/音频：流式传输 + Range 支持 ── */
    if (是视频音频) {
      const rangeHeader = request.headers.get("range");

      if (rangeHeader) {
        /* Range 请求：只传输指定范围 */
        const parts = rangeHeader.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize || start > end) {
          return new NextResponse("范围不合法", {
            status: 416,
            headers: { "Content-Range": `bytes */${fileSize}` },
          });
        }

        if (end >= fileSize) end = fileSize - 1;

        /* 用 createReadStream 的 start/end 选项，直接从磁盘流式读取指定范围 */
        const nodeStream = createReadStream(resolvedPath, { start, end });
        const webStream = nodeStreamToWebStream(nodeStream);

        return new NextResponse(webStream, {
          status: 206,
          headers: {
            "Content-Type": contentType,
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Content-Length": String(end - start + 1),
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=86400",
          },
        });
      }

      /* 无 Range 请求：流式传输整个文件 */
      const nodeStream = createReadStream(resolvedPath);
      const webStream = nodeStreamToWebStream(nodeStream);

      return new NextResponse(webStream, {
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(fileSize),
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    /* ── 图片和其他文件：也改为流式传输 ── */
    const nodeStream = createReadStream(resolvedPath);
    const webStream = nodeStreamToWebStream(nodeStream);

    return new NextResponse(webStream, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(fileSize),
        "Cache-Control": "public, max-age=31536000",
      },
    });
  } catch {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }
}

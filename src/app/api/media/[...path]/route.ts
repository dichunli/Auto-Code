import { NextResponse } from "next/server";
import { stat, access } from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { Readable } from "stream";

/* 本地附件存储根目录（可通过环境变量 UPLOAD_DIR 配置） */
const UPLOAD_DIR = process.env.UPLOAD_DIR || "E:/autorepair-uploads";

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
 * 校验请求是否带有真实有效的 session（纯本地解析，不联网，性能无损）
 * 历史教训：此前只检查 cookie「存在性」，任何人手工放个同名 cookie 就能看照片。
 * 现在：解析 cookie 内容 → 校验双令牌结构 + JWT 过期时间（过期留 1 天续期宽限）。
 * 支持分段 cookie（大 session 被切成 key.0/key.1… 的情况拼接还原）。
 */
function 有有效会话(request: Request): boolean {
  const cookieHeader = request.headers.get("cookie") || "";

  /* 找 sb-*-auth-token 的基名 */
  const 名匹配 = cookieHeader.match(/sb-[^=;\s]+-auth-token/);
  if (!名匹配) return false;
  const 基名 = 名匹配[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /* 先尝试单条 cookie，没有再拼接分段 */
  let 原始值: string | null = null;
  const 单条 = cookieHeader.match(new RegExp(`(?:^|; )${基名}=([^;]*)`));
  if (单条 && 单条[1]) {
    原始值 = decodeURIComponent(单条[1]);
  } else {
    const 段们: string[] = [];
    for (let i = 0; ; i++) {
      const m = cookieHeader.match(new RegExp(`(?:^|; )${基名}\\.${i}=([^;]*)`));
      if (!m) break;
      段们.push(decodeURIComponent(m[1]));
    }
    if (段们.length > 0) 原始值 = 段们.join("");
  }
  if (!原始值) return false;

  try {
    /* base64- 前缀的 SSR 格式先解码 */
    let 文本 = 原始值;
    if (文本.startsWith("base64-")) {
      文本 = Buffer.from(文本.slice("base64-".length), "base64url").toString("utf8");
    }
    const session = JSON.parse(文本);
    /* 结构校验：双令牌必须在场 */
    if (typeof session.access_token !== "string" || typeof session.refresh_token !== "string") return false;
    if (!session.access_token || !session.refresh_token) return false;

    /* 过期校验：解析 JWT payload 的 exp（不验签名，本地零成本防伪造空 cookie） */
    const parts = session.access_token.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    /* 过期超 1 天视为无效（客户端会自动续期，宽限覆盖续期窗口） */
    if (payload.exp && Date.now() / 1000 > payload.exp + 86400) return false;
    return true;
  } catch {
    return false;
  }
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
    const { path: pathSegments } = await params;

    /* quote/ 目录是供应商报价图片：文件名为随机串不可猜测，免登录公开可读
     *（供应商打开询价链接时没有登录态，看不到图就没法核对） */
    const 是公开报价图片 = pathSegments[0] === "quote";

    /* ── 认证：本地校验 session 真伪（不联网），伪造空 cookie 无法通过 ──
     * 2026-08-29 删除 UA 放行（待办清单第1项）：原来 APP 环境靠 User-Agent 判断免校验，
     * 任何人改 UA 就能免登录下载私有照片。现在 APP 登录后会把 session 镜像成 cookie
     * （见 clientCore.ts），APP 与浏览器统一走同一套 cookie 校验。 */
    if (!是公开报价图片) {
      if (!有有效会话(request)) {
        return NextResponse.json({ error: "未登录" }, { status: 401 });
      }
    }

    const filePath = path.join(UPLOAD_DIR, ...pathSegments);

    /* 安全检查：防止目录遍历 */
    const resolvedPath = path.resolve(filePath);
    const resolvedUploadDir = path.resolve(UPLOAD_DIR);
    if (!resolvedPath.startsWith(resolvedUploadDir)) {
      return NextResponse.json({ error: "非法路径" }, { status: 403 });
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || "application/octet-stream";

    /* 视频：存在转码压缩版（.opt.mp4）时优先分发，原文件保留但不再直接流出 */
    let 分发路径 = resolvedPath;
    const 是视频音频 = 视频音频扩展名.has(ext);
    if (是视频音频) {
      const 压缩版路径 = `${resolvedPath}.opt.mp4`;
      try {
        await access(压缩版路径);
        分发路径 = 压缩版路径;
      } catch { /* 没有压缩版就用原文件 */ }
    }

    /* 获取文件大小 */
    let fileStats;
    try {
      fileStats = await stat(分发路径);
    } catch {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }
    const fileSize = fileStats.size;

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
        const nodeStream = createReadStream(分发路径, { start, end });
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
      const nodeStream = createReadStream(分发路径);
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

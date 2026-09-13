import { NextResponse } from "next/server";
import { stat, access } from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { Readable } from "stream";
import { createClient as 创建一次性客户端 } from "@supabase/supabase-js";

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
 * 校验请求是否带有真实有效的 session。
 * 两步：先本地解析（结构 + 过期时间），再把 access_token 交给 Supabase 认证服务验签。
 *
 * 历史教训：
 * 1. 最早只检查 cookie「存在性」，任何人手工放个同名 cookie 就能看照片；
 * 2. 2026-08-29 改本地解析但「只验形状不验签名」，伪造三段式 JWT 照样通过
 *    （2026-09-12 诊断报告指出，身份证/行驶证照片可被未登录者下载）；
 * 3. 现在联网验签保真，加 5 分钟内存缓存——一个页面几十张图同时请求，
 *    逐张联网会把认证服务打爆。
 * 支持分段 cookie（大 session 被切成 key.0/key.1… 的情况拼接还原）。
 */

/* 验签通过的 token 缓存：值 = 缓存失效时间戳 */
const 验签缓存 = new Map<string, number>();
const 缓存时长毫秒 = 5 * 60 * 1000;
const 缓存上限 = 500;

async function 服务端验签(accessToken: string): Promise<boolean> {
  const 现在 = Date.now();
  const 命中 = 验签缓存.get(accessToken);
  if (命中 && 命中 > 现在) return true;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return false;

  try {
    const 一次性 = 创建一次性客户端(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await 一次性.auth.getUser(accessToken);
    if (error || !data.user) return false;
    if (验签缓存.size >= 缓存上限) 验签缓存.clear(); /* 到顶整体清空，防内存膨胀 */
    验签缓存.set(accessToken, 现在 + 缓存时长毫秒);
    return true;
  } catch {
    return false;
  }
}

async function 有有效会话(request: Request): Promise<boolean> {
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

    /* 过期校验：解析 JWT payload 的 exp（本地快速挡掉过期票） */
    const parts = session.access_token.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    /* 过期超 1 天视为无效（客户端会自动续期，宽限覆盖续期窗口） */
    if (payload.exp && Date.now() / 1000 > payload.exp + 86400) return false;

    /* 验签：确认令牌真是认证服务签发的，伪造 cookie 到此为止 */
    return await 服务端验签(session.access_token);
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

    /* ── 认证：cookie 解析 + 服务端验签，伪造 cookie 无法通过 ──
     * 2026-08-29 删除 UA 放行（待办清单第1项）：APP 登录后会把 session 镜像成 cookie
     * （见 clientCore.ts），APP 与浏览器统一走同一套 cookie 校验。
     * 2026-09-12 补上验签环节：原来只解析不验签，伪造三段式 JWT 即可通过。 */
    if (!是公开报价图片) {
      if (!(await 有有效会话(request))) {
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
            /* 私有文件不走公开缓存（待办清单第4项），报价图片（quote/）仍公开缓存 */
            "Cache-Control": 是公开报价图片 ? "public, max-age=86400" : "private, max-age=86400",
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
          "Cache-Control": 是公开报价图片 ? "public, max-age=86400" : "private, max-age=86400",
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
        "Cache-Control": 是公开报价图片 ? "public, max-age=31536000" : "private, max-age=31536000",
      },
    });
  } catch {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }
}

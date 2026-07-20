import { writeFile, mkdir, access, unlink } from "fs/promises";
import { createWriteStream } from "fs";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { 解析Multipart请求 } from "@/lib/parseMultipart";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const execFileAsync = promisify(execFile);

/* 本地附件存储根目录 */
const UPLOAD_DIR = process.env.UPLOAD_DIR || "E:/autorepair-uploads";

/* multipart 路径（图片等小文件）最大 550MB：整段读内存，仅用于图片 */
const MAX_FILE_SIZE = 550 * 1024 * 1024;

/* 视频等大文件走裸 body 流式写盘，上限 1GB（前端限 1GB，服务端留余量到约 1.05GB） */
const MAX_STREAM_SIZE = 1080 * 1024 * 1024;

/* Office 文件扩展名 */
const officeExts = [".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"];

/* 允许的文件扩展名白名单 */
const 允许的扩展名 = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".gif",
  ".mp4", ".webm", ".mov", ".3gp",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".pdf",
]);

/* LibreOffice 路径 */
const sofficePaths = [
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
];

async function findSoffice(): Promise<string | null> {
  for (const p of sofficePaths) {
    try { await access(p); return p; } catch { /* 继续 */ }
  }
  return null;
}

async function convertToPdf(inputPath: string, outputDir: string): Promise<string | null> {
  const soffice = await findSoffice();
  if (!soffice) return null;

  try {
    await execFileAsync(soffice, ["--headless", "--convert-to", "pdf", "--outdir", outputDir, inputPath], {
      timeout: 60000,
      windowsHide: true,
    });
    const baseName = path.basename(inputPath, path.extname(inputPath));
    const pdfPath = path.join(outputDir, `${baseName}.pdf`);
    try { await access(pdfPath); return pdfPath; } catch { return null; }
  } catch { return null; }
}

export async function POST(request: Request) {
  try {
    /* ── 认证 ── */
    let userId = "";
    const authHeader = request.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      if (token && token !== "undefined" && token !== "null") {
        const tempClient = createSupabaseClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL || "",
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
          { auth: { autoRefreshToken: false, persistSession: false } }
        );
        const { data, error } = await tempClient.auth.getUser(token);
        if (!error && data.user) {
          userId = data.user.id;
        }
      }
    }

    if (!userId) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return Response.json({ error: "未登录" }, { status: 401 });
      }
      userId = user.id;
    }

    /* ── 视频等大文件：裸 body 流式写盘（不占内存，边收边写硬盘）── */
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return await 处理流式上传(request);
    }

    /* ── 大小预检 ── */
    const contentLength = request.headers.get("content-length");
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (!isNaN(size) && size > MAX_FILE_SIZE) {
        return Response.json({ error: `文件超过限制（最大 ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB）` }, { status: 400 });
      }
    }

    /* ── 解析 multipart 请求体 ── */
    const multipart = await 解析Multipart请求(request, MAX_FILE_SIZE);
    const { file } = multipart;
    let folder = multipart.folder;

    if (!file || file.data.length === 0) {
      return Response.json({ error: "没有文件" }, { status: 400 });
    }

    /* ── 校验文件扩展名 ── */
    const ext = path.extname(file.filename).toLowerCase();
    if (!允许的扩展名.has(ext)) {
      return Response.json({ error: `不支持的文件类型: ${ext}` }, { status: 400 });
    }

    /* 清理 folder 参数 */
    if (folder) {
      folder = folder.replace(/[/\\]|\.\./g, "").slice(0, 50);
      if (folder.length === 0) folder = "";
    }

    const fileBuffer = file.data;

    /* 按日期分目录 */
    const now = new Date();
    const dateDir = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const subDir = folder === "training" ? `training/${dateDir}` : dateDir;
    const dir = path.join(UPLOAD_DIR, subDir);
    await mkdir(dir, { recursive: true });

    /* 生成唯一文件名 */
    const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
    const finalPath = path.join(dir, fileName);

    await writeFile(finalPath, fileBuffer);

    /* 返回相对路径 */
    const relativePath = `${subDir}/${fileName}`;
    const result: { path: string; pdfPath?: string } = { path: `/api/media/${relativePath}` };

    /* Office 文件转 PDF */
    if (officeExts.includes(ext)) {
      const pdfFullPath = await convertToPdf(finalPath, dir);
      if (pdfFullPath) {
        const pdfRelative = path.relative(UPLOAD_DIR, pdfFullPath).replace(/\\/g, "/");
        result.pdfPath = `/api/media/${pdfRelative}`;
      }
    }

    return Response.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "上传失败";
    console.error("[upload] error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

/* 裸 body 流式写盘：用于视频等大文件，边接收边写硬盘，不把整个文件读进内存 */
async function 处理流式上传(request: Request): Promise<Response> {
  /* 文件名从请求头取（前端 encodeURIComponent 编码，支持中文名） */
  const rawName = request.headers.get("x-file-name");
  const filename = rawName ? decodeURIComponent(rawName) : `upload_${Date.now()}.mp4`;
  const ext = path.extname(filename).toLowerCase();
  if (!允许的扩展名.has(ext)) {
    return Response.json({ error: `不支持的文件类型: ${ext}` }, { status: 400 });
  }

  /* content-length 预检：超大直接拒绝，不开始接收 */
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (!isNaN(size) && size > MAX_STREAM_SIZE) {
      return Response.json({ error: `视频超过限制（最大 ${Math.round(MAX_STREAM_SIZE / 1024 / 1024)}MB）` }, { status: 400 });
    }
  }

  if (!request.body) {
    return Response.json({ error: "没有文件内容" }, { status: 400 });
  }

  /* folder 清理 */
  let folder = request.headers.get("x-folder") || "";
  if (folder) folder = folder.replace(/[/\\]|\.\./g, "").slice(0, 50);

  /* 按日期分目录 */
  const now = new Date();
  const dateDir = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const subDir = folder === "training" ? `training/${dateDir}` : dateDir;
  const dir = path.join(UPLOAD_DIR, subDir);
  await mkdir(dir, { recursive: true });

  /* 生成唯一文件名 */
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
  const finalPath = path.join(dir, fileName);

  /* 边写边累计字节数，超限时中止管道 */
  let 已写字节 = 0;
  let 超限 = false;
  const 计数器 = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      已写字节 += chunk.length;
      if (已写字节 > MAX_STREAM_SIZE) {
        超限 = true;
        cb(new Error("文件超过大小限制"));
        return;
      }
      cb(null, chunk);
    },
  });

  const nodeStream = Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]);
  const writeStream = createWriteStream(finalPath);

  try {
    await pipeline(nodeStream, 计数器, writeStream);
  } catch (err: unknown) {
    /* 出错或超限：删除半截文件 */
    try { await unlink(finalPath); } catch { /* 忽略删除失败 */ }
    if (超限) {
      return Response.json({ error: `视频超过限制（最大 ${Math.round(MAX_STREAM_SIZE / 1024 / 1024)}MB）` }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "上传失败";
    console.error("[upload-stream] error:", message);
    return Response.json({ error: message }, { status: 500 });
  }

  const relativePath = `${subDir}/${fileName}`;
  return Response.json({ path: `/api/media/${relativePath}` });
}
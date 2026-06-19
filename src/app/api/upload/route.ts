import { writeFile, mkdir, access } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { 解析Multipart请求 } from "@/lib/parseMultipart";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const execFileAsync = promisify(execFile);

/* 本地附件存储根目录（可通过环境变量 UPLOAD_DIR 配置） */
const UPLOAD_DIR = process.env.UPLOAD_DIR || "E:/autorepair-uploads";

/* 最大文件大小 500MB */
const MAX_FILE_SIZE = 500 * 1024 * 1024;

/* Office 文件扩展名 */
const officeExts = [".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"];

/* 允许的文件扩展名白名单 */
const 允许的扩展名 = new Set([
  /* 图片 */
  ".jpg", ".jpeg", ".png", ".webp", ".gif",
  /* 视频 */
  ".mp4", ".webm", ".mov", ".3gp",
  /* 文档 */
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".pdf",
]);

/* Windows 上常见的 LibreOffice 安装路径 */
const sofficePaths = [
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
];

async function findSoffice(): Promise<string | null> {
  for (const p of sofficePaths) {
    try {
      await access(p);
      return p;
    } catch {
      /* 路径不存在，继续找下一个 */
    }
  }
  return null;
}

async function convertToPdf(inputPath: string, outputDir: string): Promise<string | null> {
  const soffice = await findSoffice();
  if (!soffice) return null;

  try {
    await execFileAsync(soffice, [
      "--headless",
      "--convert-to", "pdf",
      "--outdir", outputDir,
      inputPath,
    ]);

    const baseName = path.basename(inputPath, path.extname(inputPath));
    const pdfPath = path.join(outputDir, `${baseName}.pdf`);
    await access(pdfPath);
    return pdfPath;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    /* 认证检查：优先从 Authorization 头取 token（APP 环境），其次读 cookie */
    let userId: string | null = null;
    const authHeader = request.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (url && key) {
        const tempClient = createSupabaseClient(url, key);
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

    /* 文件大小预检（通过 Content-Length 头） */
    const contentLength = request.headers.get("content-length");
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (!isNaN(size) && size > MAX_FILE_SIZE) {
        return Response.json({ error: `文件超过限制（最大 500MB）` }, { status: 400 });
      }
    }

    const multipart = await 解析Multipart请求(request, MAX_FILE_SIZE);
    const { file } = multipart;
    let folder = multipart.folder;

    if (!file || file.data.length === 0) {
      return Response.json({ error: "没有文件" }, { status: 400 });
    }

    /* 校验文件扩展名 */
    const ext = path.extname(file.filename).toLowerCase();
    if (!允许的扩展名.has(ext)) {
      return Response.json({ error: `不支持的文件类型: ${ext}` }, { status: 400 });
    }

    /* 清理 folder 参数：去掉路径分隔符和 .. */
    if (folder) {
      folder = folder.replace(/[/\\]|\.\./g, "").slice(0, 50);
      if (folder.length === 0) folder = "";
    }

    const buffer = file.data;

    /* 按日期分目录，避免单目录文件过多 */
    const now = new Date();
    const dateDir = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    /* 培训视频存到 training/ 子目录 */
    const subDir = folder === "training" ? `training/${dateDir}` : dateDir;
    const dir = path.join(UPLOAD_DIR, subDir);
    await mkdir(dir, { recursive: true });

    /* 生成唯一文件名 */
    const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
    const filePath = path.join(dir, fileName);

    await writeFile(filePath, buffer);

    /* 返回相对路径，供前端通过 /api/media/... 访问 */
    const relativePath = `${subDir}/${fileName}`;
    const result: { path: string; pdfPath?: string } = { path: `/api/media/${relativePath}` };

    /* 如果是 Office 文件，尝试转 PDF */
    if (officeExts.includes(ext)) {
      const pdfFullPath = await convertToPdf(filePath, dir);
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

import { mkdir, writeFile, readdir, readFile, rm } from "fs/promises";
import path from "path";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/* ======================== 分片元数据 ======================== */

interface 分片元数据 {
  uploadId: string;
  userId: string;
  fileName: string;       /* 原始文件名 */
  fileSize: number;        /* 总字节数 */
  fileType: string;        /* MIME */
  folder: string;          /* 子目录 */
  totalChunks: number;
  chunkSize: number;       /* 5MB */
  completedChunks: number[];
  createdAt: number;
  updatedAt: number;
}

/* ======================== 常量 ======================== */

const UPLOAD_DIR = process.env.UPLOAD_DIR || "E:/autorepair-uploads";
const CHUNK_DIR = path.join(UPLOAD_DIR, ".chunks");
const CHUNK_SIZE = 5 * 1024 * 1024; /* 5MB */
const 过期时间 = 24 * 60 * 60 * 1000; /* 24 小时 */

/* 允许的文件扩展名（与 /api/upload 一致） */
const 允许的扩展名 = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".gif",
  ".mp4", ".webm", ".mov", ".3gp",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".pdf",
]);

/* ======================== 认证 ======================== */

async function 验证身份(request: Request): Promise<{ userId: string; error?: Response }> {
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
      return { userId: "", error: Response.json({ error: "未登录" }, { status: 401 }) };
    }
    userId = user.id;
  }

  return { userId };
}

/* ======================== 工具函数 ======================== */

function 生成UploadId(userId: string): string {
  return `chunk_${userId.slice(0, 8)}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function 获取分片目录(uploadId: string): string {
  return path.join(CHUNK_DIR, uploadId);
}

function 获取元数据路径(uploadId: string): string {
  return path.join(获取分片目录(uploadId), "meta.json");
}

async function 读取元数据(uploadId: string): Promise<分片元数据 | null> {
  try {
    const raw = await readFile(获取元数据路径(uploadId), "utf-8");
    return JSON.parse(raw) as 分片元数据;
  } catch {
    return null;
  }
}

async function 写入元数据(uploadId: string, meta: 分片元数据): Promise<void> {
  await mkdir(获取分片目录(uploadId), { recursive: true });
  await writeFile(获取元数据路径(uploadId), JSON.stringify(meta, null, 2), "utf-8");
}

async function 删除分片目录(uploadId: string): Promise<void> {
  try {
    await rm(获取分片目录(uploadId), { recursive: true, force: true });
  } catch {
    /* 删除失败不影响主流程 */
  }
}

/* 从磁盘检查已完成的分片（不依赖 meta.json 的 completedChunks，避免并发写冲突） */
async function 获取已完成分片(uploadId: string, totalChunks: number): Promise<number[]> {
  const completed: number[] = [];
  const dir = 获取分片目录(uploadId);
  for (let i = 0; i < totalChunks; i++) {
    try {
      await access(path.join(dir, `chunk_${i}`));
      completed.push(i);
    } catch {
      /* 分片文件不存在 */
    }
  }
  return completed;
}

async function 清理过期分片(): Promise<void> {
  try {
    const entries = await readdir(CHUNK_DIR, { withFileTypes: true });
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = await 读取元数据(entry.name);
      if (!meta || now - meta.updatedAt > 过期时间) {
        await 删除分片目录(entry.name);
        console.log(`[chunk-cleanup] 已清理过期分片: ${entry.name}`);
      }
    }
  } catch {
    /* .chunks 目录不存在时忽略 */
  }
}

/* ======================== POST: 初始化分片上传 ======================== */

export async function POST(request: Request) {
  const { userId, error: authError } = await 验证身份(request);
  if (authError) return authError;

  /* 顺带清理过期分片 */
  清理过期分片().catch(() => {});

  try {
    const body = await request.json() as {
      fileName?: string;
      fileSize?: number;
      fileType?: string;
      folder?: string;
      uploadId?: string;
    };

    const { fileName, fileSize, fileType, folder: rawFolder, uploadId: existingId } = body;

    /* 断点续传：如果传了 uploadId，先检查已有会话 */
    if (existingId) {
      const existingMeta = await 读取元数据(existingId);
      if (existingMeta && existingMeta.userId === userId) {
        /* 从磁盘检查已完成分片（不依赖 meta.json，避免并发写冲突） */
        const completed = await 获取已完成分片(existingId, existingMeta.totalChunks);
        existingMeta.updatedAt = Date.now();
        await 写入元数据(existingId, existingMeta);
        return Response.json({
          uploadId: existingMeta.uploadId,
          chunkSize: existingMeta.chunkSize,
          totalChunks: existingMeta.totalChunks,
          uploadedChunks: completed,
          fileName: existingMeta.fileName,
          fileSize: existingMeta.fileSize,
        });
      }
    }

    /* 新上传：校验参数 */
    if (!fileName || !fileSize || fileSize <= 0) {
      return Response.json({ error: "缺少文件名或文件大小" }, { status: 400 });
    }

    const ext = path.extname(fileName).toLowerCase();
    if (!允许的扩展名.has(ext)) {
      return Response.json({ error: `不支持的文件类型: ${ext}` }, { status: 400 });
    }

    /* 清理 folder */
    const folder = (rawFolder || "").replace(/[/\\]|\.\./g, "").slice(0, 50);

    const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
    const uploadId = 生成UploadId(userId);

    const meta: 分片元数据 = {
      uploadId,
      userId,
      fileName,
      fileSize,
      fileType: fileType || "application/octet-stream",
      folder,
      totalChunks,
      chunkSize: CHUNK_SIZE,
      completedChunks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await 写入元数据(uploadId, meta);

    return Response.json({
      uploadId,
      chunkSize: CHUNK_SIZE,
      totalChunks,
      uploadedChunks: [],
      fileName,
      fileSize,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "初始化失败";
    console.error("[chunk-init] error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

/* 导出供其他端点使用 */
export { CHUNK_DIR, CHUNK_SIZE, UPLOAD_DIR, 分片元数据, 验证身份, 读取元数据, 写入元数据, 删除分片目录, 获取分片目录, 允许的扩展名 };
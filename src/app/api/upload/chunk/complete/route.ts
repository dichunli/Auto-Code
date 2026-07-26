import { mkdir, writeFile, access } from "fs/promises";
import { createWriteStream, createReadStream } from "fs";
import { pipeline } from "stream/promises";
import path from "path";
import {
  验证身份, 读取元数据, 删除分片目录, 获取分片目录,
  UPLOAD_DIR, 允许的扩展名,
} from "../init/route";

/* ======================== POST: 合并分片 ======================== */

export async function POST(request: Request) {
  const { userId, error: authError } = await 验证身份(request);
  if (authError) return authError;

  try {
    const body = await request.json() as { uploadId?: string };
    const { uploadId } = body;

    if (!uploadId) {
      return Response.json({ error: "缺少 uploadId" }, { status: 400 });
    }

    const meta = await 读取元数据(uploadId);
    if (!meta) {
      return Response.json({ error: "上传会话不存在或已过期" }, { status: 404 });
    }
    if (meta.userId !== userId) {
      return Response.json({ error: "无权操作此上传会话" }, { status: 403 });
    }

    /* 验证所有分片都存在 */
    const 分片目录 = 获取分片目录(uploadId);
    const 缺失分片: number[] = [];
    for (let i = 0; i < meta.totalChunks; i++) {
      const 分片路径 = path.join(分片目录, `chunk_${i}`);
      try {
        await access(分片路径);
      } catch {
        缺失分片.push(i);
      }
    }

    if (缺失分片.length > 0) {
      return Response.json({
        error: `还有 ${缺失分片.length} 个分片未上传，请继续上传后重试`,
        missingChunks: 缺失分片,
      }, { status: 400 });
    }

    /* 构建最终文件路径（与 /api/upload 一致） */
    const ext = path.extname(meta.fileName).toLowerCase();
    if (!允许的扩展名.has(ext)) {
      return Response.json({ error: `不支持的文件类型: ${ext}` }, { status: 400 });
    }

    const now = new Date();
    const dateDir = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const subDir = meta.folder === "training" ? `training/${dateDir}` : dateDir;
    const dir = path.join(UPLOAD_DIR, subDir);
    await mkdir(dir, { recursive: true });

    const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
    const finalPath = path.join(dir, fileName);

    /* 合并分片：按顺序逐个追加到最终文件 */
    const writeStream = createWriteStream(finalPath);
    for (let i = 0; i < meta.totalChunks; i++) {
      const 分片路径 = path.join(分片目录, `chunk_${i}`);
      const readStream = createReadStream(分片路径);
      await pipeline(readStream, writeStream, { end: false });
    }
    /* 所有分片追加完毕，关闭写入流 */
    await new Promise<void>((resolve, reject) => {
      writeStream.end((err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });

    /* 删除分片目录 */
    await 删除分片目录(uploadId);

    const relativePath = `${subDir}/${fileName}`;
    return Response.json({ path: `/api/media/${relativePath}` });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "合并失败";
    console.error("[chunk-complete] error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
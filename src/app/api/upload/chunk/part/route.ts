import { writeFile, access } from "fs/promises";
import { createWriteStream } from "fs";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import path from "path";
import {
  验证身份, 读取元数据, 获取分片目录,
  CHUNK_SIZE,
} from "../init/route";

/* ======================== POST: 上传单个分片 ======================== */

export async function POST(request: Request) {
  const { userId, error: authError } = await 验证身份(request);
  if (authError) return authError;

  const uploadId = request.headers.get("x-upload-id");
  const chunkIndexStr = request.headers.get("x-chunk-index");

  if (!uploadId || chunkIndexStr === null) {
    return Response.json({ error: "缺少 uploadId 或 chunkIndex" }, { status: 400 });
  }

  const chunkIndex = parseInt(chunkIndexStr, 10);
  if (isNaN(chunkIndex) || chunkIndex < 0) {
    return Response.json({ error: "无效的 chunkIndex" }, { status: 400 });
  }

  /* 验证上传会话存在 */
  const meta = await 读取元数据(uploadId);
  if (!meta) {
    return Response.json({ error: "上传会话不存在或已过期，请重新初始化" }, { status: 404 });
  }
  if (meta.userId !== userId) {
    return Response.json({ error: "无权操作此上传会话" }, { status: 403 });
  }
  if (chunkIndex >= meta.totalChunks) {
    return Response.json({ error: `chunkIndex 超出范围（最大 ${meta.totalChunks - 1}）` }, { status: 400 });
  }

  /* 若分片已存在，直接返回成功（幂等） */
  const 分片目录 = 获取分片目录(uploadId);
  const 分片路径 = path.join(分片目录, `chunk_${chunkIndex}`);
  try {
    await access(分片路径);
    /* 分片已存在，标记为已完成 */
    if (!meta.completedChunks.includes(chunkIndex)) {
      meta.completedChunks.push(chunkIndex);
      meta.updatedAt = Date.now();
      await 写入元数据(uploadId, meta);
    }
    return Response.json({ index: chunkIndex, received: true });
  } catch {
    /* 分片不存在，继续上传 */
  }

  if (!request.body) {
    return Response.json({ error: "没有分片数据" }, { status: 400 });
  }

  /* 流式写分片到磁盘，边写边计数防超限 */
  let 已写字节 = 0;
  let 超限 = false;
  const 计数器 = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      已写字节 += chunk.length;
      if (已写字节 > CHUNK_SIZE + 1024 * 10) { /* 留 10KB 余量，容许多余的请求头开销 */
        超限 = true;
        cb(new Error("分片大小超限"));
        return;
      }
      cb(null, chunk);
    },
  });

  const nodeStream = Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]);
  const writeStream = createWriteStream(分片路径);

  try {
    await pipeline(nodeStream, 计数器, writeStream);
  } catch (err: unknown) {
    /* 出错或超限：删除残缺分片 */
    try {
      const { unlink } = await import("fs/promises");
      await unlink(分片路径);
    } catch { /* 忽略 */ }
    if (超限) {
      return Response.json({ error: "分片大小超限" }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "上传分片失败";
    console.error("[chunk-part] error:", message);
    return Response.json({ error: message }, { status: 500 });
  }

  /* 分片已写入磁盘，无需更新 meta.json（避免并发写冲突） */
  /* 完成状态通过检查磁盘上的分片文件来判定 */

  return Response.json({ index: chunkIndex, received: true });
}
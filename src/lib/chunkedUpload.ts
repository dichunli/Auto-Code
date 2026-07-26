/* 分片上传工具：文件 > 100MB 自动走分片，支持断点续传 */

import { 获取访问令牌 } from "@/lib/supabase/client";

const CHUNK_SIZE = 5 * 1024 * 1024;          /* 5MB */
const 并发数 = 3;                              /* 同时上传 3 个分片 */
const 最大重试次数 = 3;                         /* 每个分片最多重试 3 次 */
const 分片阈值 = 100 * 1024 * 1024;           /* 100MB 以上走分片 */

/* sessionStorage 键前缀，用于断点续传 */
const 续传键前缀 = "chunk_upload_";

interface 分片上传结果 {
  path: string;
}

/* 文件标识：用于断点续传匹配 */
function 文件标识(file: File): string {
  return `${file.name}_${file.size}_${file.lastModified}`;
}

/* 保存续传信息到 sessionStorage */
function 保存续传信息(文件键: string, uploadId: string): void {
  try {
    sessionStorage.setItem(`${续传键前缀}${文件键}`, uploadId);
  } catch {
    /* sessionStorage 不可用时忽略 */
  }
}

/* 获取续传信息 */
function 获取续传信息(文件键: string): string | null {
  try {
    return sessionStorage.getItem(`${续传键前缀}${文件键}`);
  } catch {
    return null;
  }
}

/* 清除续传信息 */
function 清除续传信息(文件键: string): void {
  try {
    sessionStorage.removeItem(`${续传键前缀}${文件键}`);
  } catch {
    /* 忽略 */
  }
}

/* 带认证头的 fetch */
function 认证fetch(url: string, options: RequestInit = {}): ReturnType<typeof fetch> {
  const token = 获取访问令牌();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
  return fetch(url, { ...options, headers });
}

/* 上传单个分片 */
async function 上传分片(
  uploadId: string,
  chunkIndex: number,
  chunkData: Blob,
  signal?: AbortSignal,
): Promise<boolean> {
  const res = await 认证fetch("/api/upload/chunk/part", {
    method: "POST",
    body: chunkData,
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Upload-Id": uploadId,
      "X-Chunk-Index": String(chunkIndex),
    },
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "分片上传失败" }));
    throw new Error(err.error || "分片上传失败");
  }
  return true;
}

/* 带重试的分片上传 */
async function 上传分片带重试(
  uploadId: string,
  chunkIndex: number,
  chunkData: Blob,
  总重试次数: number,
  signal?: AbortSignal,
): Promise<boolean> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 总重试次数; attempt++) {
    try {
      return await 上传分片(uploadId, chunkIndex, chunkData, signal);
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < 总重试次数 - 1) {
        /* 指数退避：1s、2s、4s */
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError;
}

/* 并发池：控制同时上传的分片数 */
async function 并发上传分片(
  uploadId: string,
  待上传分片: number[],
  文件: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const 总分片数 = Math.ceil(文件.size / CHUNK_SIZE);
  let 已完成分片 = 0;
  const 开始已完成 = 总分片数 - 待上传分片.length;

  /* 并发池 */
  const 执行中: Promise<void>[] = [];
  let 当前索引 = 0;

  async function 处理下一个分片(): Promise<void> {
    if (当前索引 >= 待上传分片.length) return;
    const index = 当前索引;
    当前索引 += 1;
    const chunkIndex = 待上传分片[index];

    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, 文件.size);
    const chunkData = 文件.slice(start, end);

    await 上传分片带重试(uploadId, chunkIndex, chunkData, 最大重试次数, signal);

    已完成分片 += 1;
    const total = 开始已完成 + 已完成分片;
    const pct = Math.round((total / 总分片数) * 100);
    if (onProgress) onProgress(pct);
  }

  /* 用并发池控制并发数 */
  while (当前索引 < 待上传分片.length) {
    while (执行中.length < 并发数 && 当前索引 < 待上传分片.length) {
      const task = 处理下一个分片();
      执行中.push(task);
      /* 任务完成后自动从池中移除 */
      task.then(() => {
        const idx = 执行中.indexOf(task);
        if (idx !== -1) 执行中.splice(idx, 1);
      });
    }
    if (执行中.length >= 并发数) {
      await Promise.race(执行中);
    }
  }
  /* 等待所有剩余任务完成 */
  await Promise.all(执行中);
}

/* ======================== 主函数 ======================== */

export async function 分片上传文件(
  file: File,
  folder?: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<分片上传结果> {
  /* 初始化或恢复上传会话 */
  const 文件键 = 文件标识(file);
  const 已有uploadId = 获取续传信息(文件键);

  const initRes = await 认证fetch("/api/upload/chunk/init", {
    method: "POST",
    body: JSON.stringify({
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      folder: folder || "",
      uploadId: 已有uploadId || undefined,
    }),
  });

  if (!initRes.ok) {
    const err = await initRes.json().catch(() => ({ error: "初始化失败" }));
    throw new Error(err.error || "初始化分片上传失败");
  }

  const initData = await initRes.json() as {
    uploadId: string;
    totalChunks: number;
    uploadedChunks: number[];
  };

  const { uploadId, totalChunks, uploadedChunks } = initData;

  /* 保存续传信息 */
  保存续传信息(文件键, uploadId);

  /* 确定待上传分片 */
  const 待上传分片: number[] = [];
  for (let i = 0; i < totalChunks; i++) {
    if (!uploadedChunks.includes(i)) {
      待上传分片.push(i);
    }
  }

  if (待上传分片.length > 0) {
    /* 已有断点续传：先显示当前进度 */
    if (uploadedChunks.length > 0 && onProgress) {
      onProgress(Math.round((uploadedChunks.length / totalChunks) * 100));
    }
    await 并发上传分片(uploadId, 待上传分片, file, onProgress, signal);
  }

  /* 全部分片上传完毕，合并 */
  if (onProgress) onProgress(99); /* 正在合并 */

  const completeRes = await 认证fetch("/api/upload/chunk/complete", {
    method: "POST",
    body: JSON.stringify({ uploadId }),
  });

  if (!completeRes.ok) {
    const err = await completeRes.json().catch(() => ({ error: "合并失败" }));
    throw new Error(err.error || "合并失败");
  }

  /* 清除续传信息 */
  清除续传信息(文件键);

  if (onProgress) onProgress(100);

  return completeRes.json() as Promise<分片上传结果>;
}

/* 判断文件是否需要走分片上传 */
export function 需要分片上传(file: File): boolean {
  return file.size > 分片阈值;
}
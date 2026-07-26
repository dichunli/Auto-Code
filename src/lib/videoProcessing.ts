/* ============================================================
 * 视频上传后处理：生成封面图 + 转码压缩
 *
 * 手机拍的视频码率很高（100MB/分钟），直接播放加载慢。
 * 上传完成后异步处理（不阻塞上传响应）：
 *   1. 抽第 1 秒画面生成封面图 <文件>.poster.jpg（播放前展示）
 *   2. 转码压缩为 H.264 CRF26 + faststart <文件>.opt.mp4
 *      （约为原体积 10-20%，moov 前置支持边下边播）
 * 原文件保留不动，媒体接口优先返回压缩版。
 * ============================================================ */

import { execFile } from "child_process";
import { access } from "fs/promises";
import path from "path";

/* ffmpeg-static 包内的可执行文件路径 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPath: string = require("ffmpeg-static");

function 运行ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { timeout: 10 * 60 * 1000 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`ffmpeg 失败: ${stderr?.slice(-300) || err.message}`));
      else resolve();
    });
  });
}

async function 文件存在(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/* 生成封面图：取第 1 秒画面（黑屏开头时仍能拿到有效帧） */
async function 生成封面(视频路径: string): Promise<void> {
  const 封面路径 = `${视频路径}.poster.jpg`;
  if (await 文件存在(封面路径)) return;
  await 运行ffmpeg([
    "-y",
    "-ss", "1",
    "-i", 视频路径,
    "-frames:v", "1",
    "-q:v", "3",
    封面路径,
  ]);
}

/* 转码压缩：H.264 CRF26（手机视频约缩到 1/5 ~ 1/10），moov 前置 */
async function 转码压缩(视频路径: string): Promise<void> {
  const 输出路径 = `${视频路径}.opt.mp4`;
  if (await 文件存在(输出路径)) return;
  await 运行ffmpeg([
    "-y",
    "-i", 视频路径,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "26",
    "-c:a", "aac",
    "-b:a", "96k",
    "-movflags", "+faststart",
    输出路径,
  ]);
}

/**
 * 上传完成后调用：异步生成封面 + 转码，不阻塞上传接口返回。
 * 失败只记日志，不影响上传成功的事实（原文件始终可用）。
 */
export function 异步处理视频(视频绝对路径: string): void {
  const ext = path.extname(视频绝对路径).toLowerCase();
  if (![".mp4", ".webm", ".mov", ".3gp"].includes(ext)) return;

  (async () => {
    try {
      await 生成封面(视频绝对路径);
    } catch (e) {
      console.error("[视频处理] 封面生成失败:", e instanceof Error ? e.message : e);
    }
    try {
      await 转码压缩(视频绝对路径);
    } catch (e) {
      console.error("[视频处理] 转码压缩失败:", e instanceof Error ? e.message : e);
    }
  })();
}

"use client";

import { useState, useCallback } from "react";
import { useUpload } from "@/hooks/useUpload";
import { 是Capacitor环境 } from "@/lib/capacitorEnv";
import { 启动原生录像, 启动原生视频选择, 本地文件路径转URL } from "@/lib/androidVideoCapture";

interface Props {
  onUpload: (paths: string[]) => void;
  onDelete?: (path: string) => void;
  existingVideos?: string[];
  maxVideos?: number;
  maxFileSizeMB?: number;
  maxDurationSeconds?: number;
  timeoutMs?: number;
  folder?: string;
}

export function VideoUploader({
  onUpload,
  onDelete,
  existingVideos = [],
  maxVideos = 3,
  maxFileSizeMB = 100,
  maxDurationSeconds = 60,
  timeoutMs = 60000,
  folder,
}: Props) {
  const [videos, setVideos] = useState<string[]>(existingVideos);
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);

  const {
    上传,
    上传中,
    总进度,
    错误: uploadError,
  } = useUpload({
    mediaType: "video",
    maxFileSizeMB,
    maxDurationSeconds,
    timeoutMs,
    folder,
    onSuccess: (paths) => {
      onUpload(paths);
    },
  });

  const handleFiles = useCallback(
    async (files: FileList) => {
      const fileArray = Array.from(files)
        .filter((f) => f.type.startsWith("video/") || !f.type)
        .slice(0, maxVideos - videos.length);

      if (fileArray.length === 0) {
        alert("未检测到视频文件，请重新选择");
        return;
      }

      const { urls, errors } = await 上传(fileArray);

      if (urls.length > 0) {
        setVideos((prev) => {
          const next = [...prev, ...urls];
          onUpload(next);
          return next;
        });
      }

      if (errors.length > 0) {
        const msg = errors.map((e) => `${e.file}: ${e.error}`).join("\n");
        alert("视频上传失败:\n" + msg);
      }
    },
    [videos, maxVideos, 上传, onUpload]
  );

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    handleFiles(files);
    e.target.value = "";
  }

  /* APP 环境：处理原生录像或原生选择得到的视频 */
  async function handleAppVideoSource(
    获取结果: () => Promise<{ filePath?: string; error?: string; cancelled?: boolean }>,
    来源名称: string
  ) {
    if (videos.length >= maxVideos) {
      alert(`最多上传 ${maxVideos} 个视频`);
      return;
    }
    try {
      const result = await 获取结果();
      if (result.cancelled) return;
      if (result.error || !result.filePath) {
        alert(`${来源名称}失败: ` + (result.error || "原生视频功能不可用，请重新安装最新版APP"));
        return;
      }

      const fileUrl = 本地文件路径转URL(result.filePath);
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error("读取视频文件失败");
      const blob = await response.blob();

      if (blob.size > maxFileSizeMB * 1024 * 1024) {
        alert(`视频大小不能超过 ${maxFileSizeMB}MB`);
        return;
      }

      /* 根据实际 MIME 类型选择正确扩展名，避免把 .3gp 强制存成 .mp4 */
      function 视频扩展名(mimeType: string): string {
        if (mimeType === "video/3gpp") return ".3gp";
        if (mimeType === "video/webm") return ".webm";
        if (mimeType === "video/quicktime") return ".mov";
        return ".mp4";
      }
      const prefix = 来源名称 === "录像" ? "record" : "picked";
      const ext = blob.type ? 视频扩展名(blob.type) : ".mp4";
      const file = new File([blob], `${prefix}_${Date.now()}${ext}`, {
        type: blob.type || "video/mp4",
      });
      const dt = new DataTransfer();
      dt.items.add(file);
      await handleFiles(dt.files);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("视频上传失败: " + msg);
    }
  }

  async function handleAppRecord() {
    await handleAppVideoSource(启动原生录像, "录像");
  }

  async function handleAppPick() {
    await handleAppVideoSource(启动原生视频选择, "选择视频");
  }

  /* ========== 删除视频 ========== */

  async function removeVideo(index: number) {
    const target = videos[index];
    const next = videos.filter((_, i) => i !== index);
    setVideos(next);
    onUpload(next);
    if (target && onDelete) {
      onDelete(target);
    }
  }

  /* ========== 渲染 ========== */

  const 是APP = 是Capacitor环境();

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {videos.map((src, i) => (
          <div
            key={i}
            className="relative w-32 h-24 rounded border border-gray-200 overflow-hidden group bg-gray-900 cursor-pointer"
          >
            <video src={src} className="w-full h-full object-cover" preload="metadata" />
            <div
              className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity z-[5]"
              onClick={(e) => { e.stopPropagation(); setViewerSrc(src); }}
            >
              <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <button
              type="button"
              onClick={() => removeVideo(i)}
              className="absolute top-0.5 right-0.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
            >
              ×
            </button>
          </div>
        ))}
        {videos.length < maxVideos && (
          <div className="flex gap-2">
            {/* APP 环境：原生录像 + 原生选视频（WebView 不支持 file input 和 getUserMedia） */}
            {是APP ? (
              <>
                <button
                  type="button"
                  onClick={handleAppRecord}
                  disabled={上传中}
                  className={`w-24 h-20 rounded border border-dashed border-blue-300 flex flex-col items-center justify-center text-blue-500 hover:border-blue-500 hover:bg-blue-50 transition-colors select-none ${上传中 ? "opacity-50 pointer-events-none" : ""}`}
                >
                  {上传中 ? (
                    <span className="text-xs">{总进度 || "..."}</span>
                  ) : (
                    <>
                      <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <span className="text-[10px]">录像</span>
                      <span className="text-[10px]">{videos.length}/{maxVideos}</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleAppPick}
                  disabled={上传中}
                  className={`w-24 h-20 rounded border border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors select-none ${上传中 ? "opacity-50 pointer-events-none" : ""}`}
                >
                  {上传中 ? (
                    <span className="text-xs">{总进度 || "..."}</span>
                  ) : (
                    <>
                      <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                      <span className="text-[10px]">选视频</span>
                      <span className="text-[10px]">{videos.length}/{maxVideos}</span>
                    </>
                  )}
                </button>
              </>
            ) : (
              <>
                {/* 移动端浏览器：录像 + 选视频 */}
                <label className={`md:hidden w-24 h-20 rounded border border-dashed border-blue-300 flex flex-col items-center justify-center text-blue-500 hover:border-blue-500 hover:bg-blue-50 transition-colors select-none ${上传中 ? "opacity-50 pointer-events-none" : ""}`}>
                  {上传中 ? (
                    <span className="text-xs">{总进度 || "..."}</span>
                  ) : (
                    <>
                      <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <span className="text-[10px]">录像</span>
                      <span className="text-[10px]">{videos.length}/{maxVideos}</span>
                    </>
                  )}
                  <input type="file" accept="video/*" capture="environment" className="sr-only" onChange={handleFileChange} />
                </label>
                <label className={`md:hidden w-24 h-20 rounded border border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors select-none ${上传中 ? "opacity-50 pointer-events-none" : ""}`}>
                  {上传中 ? (
                    <span className="text-xs">{总进度 || "..."}</span>
                  ) : (
                    <>
                      <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                      <span className="text-[10px]">选视频</span>
                      <span className="text-[10px]">{videos.length}/{maxVideos}</span>
                    </>
                  )}
                  <input type="file" accept="video/*" multiple className="sr-only" onChange={handleFileChange} />
                </label>
                {/* PC端 */}
                <label className={`hidden md:flex w-32 h-24 rounded border border-dashed border-gray-300 flex-col items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors select-none ${上传中 ? "opacity-50 pointer-events-none" : ""}`}>
                  {上传中 ? (
                    <span className="text-xs">{总进度 || "..."}</span>
                  ) : (
                    <>
                      <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                      <span className="text-[10px]">选择文件</span>
                    </>
                  )}
                  <input type="file" accept="video/*" multiple className="sr-only" onChange={handleFileChange} />
                </label>
              </>
            )}
          </div>
        )}
      </div>

      {uploadError && (
        <p className="text-xs text-red-500 bg-red-50 rounded px-2 py-1">{uploadError}</p>
      )}

      <p className="text-[10px] text-gray-400">
        {是APP ? "点击录像或选视频" : "支持录像或选择文件"}。单个不超过 {maxFileSizeMB}MB、{maxDurationSeconds} 秒。
      </p>

      {/* 全屏视频播放器 */}
      {viewerSrc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90" onClick={() => setViewerSrc(null)}>
          <video src={viewerSrc} className="max-w-[95vw] max-h-[95vh] rounded" controls autoPlay onClick={(e) => e.stopPropagation()} />
          <button type="button" onClick={() => setViewerSrc(null)} className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl leading-none w-11 h-11 flex items-center justify-center">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

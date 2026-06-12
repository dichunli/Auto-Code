"use client";

import { useState, useCallback } from "react";
import { useUpload } from "@/hooks/useUpload";

interface Props {
  onUpload: (paths: string[]) => void;
  existingVideos?: string[];
  maxVideos?: number;
  /* 可选：覆盖默认限制（培训页面使用更大限制） */
  maxFileSizeMB?: number;
  maxDurationSeconds?: number;
  timeoutMs?: number;
  folder?: string;
}

export function VideoUploader({
  onUpload,
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
    进度,
    总进度,
    错误: uploadError,
    删除文件,
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

  /* ========== 文件上传 ========== */

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

  /* ========== 删除视频 ========== */

  async function removeVideo(index: number) {
    const target = videos[index];
    const next = videos.filter((_, i) => i !== index);
    setVideos(next);
    onUpload(next);

    /* 同步删除服务端文件 */
    if (target) {
      删除文件(target);
    }
  }

  /* ========== 渲染 ========== */

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {videos.map((src, i) => (
          <div
            key={i}
            className="relative w-32 h-24 rounded border border-gray-200 overflow-hidden group bg-gray-900 cursor-pointer"
          >
            <video
              src={src}
              className="w-full h-full object-cover"
              preload="metadata"
            />
            {/* 播放按钮遮罩 — 点击进入全屏播放 */}
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
            {/* 移动端：录像（input 嵌套在 label 内，兼容 WebView） */}
            <label
              className={`md:hidden w-24 h-20 rounded border border-dashed border-blue-300 flex flex-col items-center justify-center text-blue-500 hover:border-blue-500 hover:bg-blue-50 transition-colors select-none ${上传中 ? "opacity-50 pointer-events-none" : ""}`}
            >
              {上传中 ? (
                <div className="flex flex-col items-center">
                  <span className="text-xs">{进度}%</span>
                  <div className="w-12 h-1 bg-gray-200 rounded mt-1 overflow-hidden">
                    <div className="h-full bg-blue-500 rounded transition-all" style={{ width: `${进度}%` }} />
                  </div>
                </div>
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
            {/* 移动端：选视频 */}
            <label
              className={`md:hidden w-24 h-20 rounded border border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors select-none ${上传中 ? "opacity-50 pointer-events-none" : ""}`}
            >
              {上传中 ? (
                <div className="flex flex-col items-center">
                  <span className="text-xs">{进度}%</span>
                  <div className="w-12 h-1 bg-gray-200 rounded mt-1 overflow-hidden">
                    <div className="h-full bg-blue-500 rounded transition-all" style={{ width: `${进度}%` }} />
                  </div>
                </div>
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
            {/* PC端：选择文件 */}
            <label
              className={`hidden md:flex w-32 h-24 rounded border border-dashed border-gray-300 flex-col items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors select-none ${上传中 ? "opacity-50 pointer-events-none" : ""}`}
            >
              {上传中 ? (
                <div className="flex flex-col items-center">
                  <span className="text-xs">{进度}%</span>
                  <div className="w-16 h-1 bg-gray-200 rounded mt-1 overflow-hidden">
                    <div className="h-full bg-blue-500 rounded transition-all" style={{ width: `${进度}%` }} />
                  </div>
                </div>
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
          </div>
        )}
      </div>

      {uploadError && (
        <p className="text-xs text-red-500 bg-red-50 rounded px-2 py-1">{uploadError}</p>
      )}

      <p className="text-[10px] text-gray-400 md:hidden">
        点击后选择「相机」录像或从相册选视频。单个不超过 {maxFileSizeMB}MB。
      </p>
      <p className="text-[10px] text-gray-400 hidden md:block">
        支持文件上传。单个不超过 {maxFileSizeMB}MB。
      </p>

      {/* 全屏视频播放器 */}
      {viewerSrc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90" onClick={() => setViewerSrc(null)}>
          <video
            src={viewerSrc}
            className="max-w-[95vw] max-h-[95vh] rounded"
            controls
            autoPlay
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setViewerSrc(null)}
            className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl leading-none w-11 h-11 flex items-center justify-center"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

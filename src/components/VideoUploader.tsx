"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useUpload } from "@/hooks/useUpload";
import { 是Capacitor环境 } from "@/lib/capacitorEnv";
import { 启动原生录像, 启动原生视频选择, 本地文件路径转URL } from "@/lib/androidVideoCapture";
import { 启动原生水印录像机 } from "@/lib/androidWatermarkVideo";

interface Props {
  onUpload: (paths: string[]) => void;
  onDelete?: (path: string) => void;
  existingVideos?: string[];
  maxVideos?: number;
  maxFileSizeMB?: number;
  maxDurationSeconds?: number;
  timeoutMs?: number;
  folder?: string;
  disabled?: boolean;
  watermark?: boolean;
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
  disabled = false,
  watermark = false,
}: Props) {
  const [videos, setVideos] = useState<string[]>(existingVideos);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const viewerSrc = viewerIndex !== null ? videos[viewerIndex] : null;

  /* 外部传入的已有视频变化时同步到内部状态（如编辑模式异步加载已有视频） */
  useEffect(() => {
    setVideos(existingVideos);
  }, [existingVideos]);

  /* 用 ref 保存最新视频列表，避免 setVideos 异步更新导致上传回调用旧值 */
  const videosRef = useRef(videos);
  useEffect(() => {
    videosRef.current = videos;
  }, [videos]);

  /* 全屏播放时禁止背景滚动 */
  useEffect(() => {
    if (viewerIndex !== null) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [viewerIndex]);

  /* 滑动手势：边缘滑动关闭，左滑关闭，上滑下一个，下滑上一个 */
  const touchStart = useRef<{ x: number; y: number; edge: "left" | "right" | null } | null>(null);
  function handleTouchStart(e: React.TouchEvent) {
    const touch = e.touches[0];
    const screenWidth = typeof window !== "undefined" ? window.innerWidth : 0;
    touchStart.current = {
      x: touch.clientX,
      y: touch.clientY,
      edge: touch.clientX < 30 ? "left" : touch.clientX > screenWidth - 30 ? "right" : null,
    };
  }
  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStart.current === null) return;
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const diffX = touchStart.current.x - endX;
    const diffY = touchStart.current.y - endY;

    /* 从屏幕边缘滑动关闭 */
    if (touchStart.current.edge === "left" && endX > touchStart.current.x + 50) {
      setViewerIndex(null);
    } else if (touchStart.current.edge === "right" && endX < touchStart.current.x - 50) {
      setViewerIndex(null);
    } else if (Math.abs(diffX) > Math.abs(diffY)) {
      /* 水平滑动：左滑关闭 */
      if (diffX > 80) {
        setViewerIndex(null);
      }
    } else {
      /* 垂直滑动 */
      if (diffY > 80) {
        /* 上滑：下一个视频 */
        setViewerIndex((prev) => {
          if (prev === null) return null;
          const next = prev + 1;
          return next < videos.length ? next : prev;
        });
      } else if (diffY < -80) {
        /* 下滑：上一个视频 */
        setViewerIndex((prev) => {
          if (prev === null) return null;
          const next = prev - 1;
          return next >= 0 ? next : prev;
        });
      }
    }
    touchStart.current = null;
  }

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
  });

  const handleFiles = useCallback(
    async (files: FileList) => {
      const fileArray = Array.from(files)
        .filter((f) => f.type.startsWith("video/") || !f.type)
        .slice(0, maxVideos - videosRef.current.length);

      if (fileArray.length === 0) {
        alert("未检测到视频文件，请重新选择");
        return;
      }

      const { urls, errors } = await 上传(fileArray);

      if (urls.length > 0) {
        const next = [...videosRef.current, ...urls];
        setVideos(next);
        onUpload(next);
      }

      if (errors.length > 0) {
        const msg = errors.map((e) => `${e.file}: ${e.error}`).join("\n");
        alert("视频上传失败:\n" + msg);
      }
    },
    [maxVideos, 上传, onUpload]
  );

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    handleFiles(files);
    e.target.value = "";
  }

  /* 根据实际 MIME 类型选择正确扩展名，避免把 .3gp 强制存成 .mp4 */
  function 视频扩展名(mimeType: string): string {
    if (mimeType === "video/3gpp") return ".3gp";
    if (mimeType === "video/webm") return ".webm";
    if (mimeType === "video/quicktime") return ".mov";
    return ".mp4";
  }

  /* APP 环境：处理原生录像或原生选择得到的视频 */
  async function handleAppVideoSource(
    获取结果: () => Promise<{ filePath?: string; error?: string; cancelled?: boolean }>,
    来源名称: string
  ) {
    if (videosRef.current.length >= maxVideos) {
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

  /* APP 环境：调用原生水印录像机 */
  async function handleAppWatermarkRecord() {
    if (videosRef.current.length >= maxVideos) {
      alert(`最多上传 ${maxVideos} 个视频`);
      return;
    }
    try {
      const filePath = await 启动原生水印录像机();
      const fileUrl = 本地文件路径转URL(filePath);
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error("读取视频文件失败");
      const blob = await response.blob();

      if (blob.size > maxFileSizeMB * 1024 * 1024) {
        alert(`视频大小不能超过 ${maxFileSizeMB}MB`);
        return;
      }

      const ext = blob.type ? 视频扩展名(blob.type) : ".mp4";
      const file = new File([blob], `watermark_record_${Date.now()}${ext}`, {
        type: blob.type || "video/mp4",
      });
      const dt = new DataTransfer();
      dt.items.add(file);
      await handleFiles(dt.files);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("cancel") || msg.includes("denied") || msg.includes("User denied")) return;
      alert("水印录像失败: " + msg);
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
    const target = videosRef.current[index];
    const next = videosRef.current.filter((_, i) => i !== index);
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
            {/* 播放按钮：一直显示，提升辨识度 */}
            <div
              className="absolute inset-0 flex items-center justify-center bg-black/20 z-[5]"
              onClick={(e) => { e.stopPropagation(); setViewerIndex(i); }}
            >
              <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                <svg className="w-5 h-5 text-gray-900 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>
            {onDelete && !disabled && (
              <button
                type="button"
                onClick={() => removeVideo(i)}
                className="absolute top-0.5 right-0.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity z-10"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {!disabled && videos.length < maxVideos && (
          <div className="flex gap-2">
            {/* APP 环境：原生录像 + 原生选视频（WebView 不支持 file input 和 getUserMedia） */}
            {是APP ? (
              <>
                <button
                  type="button"
                  onClick={watermark ? handleAppWatermarkRecord : handleAppRecord}
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
                      <span className="text-[10px]">{watermark ? "水印录像" : "录像"}</span>
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

      {/* 全屏视频播放器：使用 Portal 渲染到 body，避免被父级弹窗的层级/透明度影响 */}
      {viewerIndex !== null && viewerSrc && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 touch-none"
          style={{ overscrollBehaviorX: "none" }}
          onClick={() => setViewerIndex(null)}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchMove={(e) => e.preventDefault()}
        >
          <video
            key={viewerSrc}
            src={viewerSrc}
            className="max-w-[95vw] max-h-[95vh] rounded"
            controls
            autoPlay
            onClick={(e) => e.stopPropagation()}
          />
          {/* 关闭按钮 */}
          <button
            type="button"
            onClick={() => setViewerIndex(null)}
            className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl leading-none w-11 h-11 flex items-center justify-center"
          >
            ✕
          </button>
          {/* 删除按钮 */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm("确定删除这个视频吗？")) {
                removeVideo(viewerIndex);
                setViewerIndex(null);
              }
            }}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-red-500 text-white text-sm rounded-full shadow-lg flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            删除视频
          </button>
          {/* 滑动提示 */}
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 text-white/50 text-xs pointer-events-none md:hidden">
            上滑下一个 · 下滑上一个 · 左滑关闭
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

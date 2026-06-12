"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useUpload } from "@/hooks/useUpload";
import { 是Capacitor环境 } from "@/lib/capacitorEnv";

interface Props {
  onUpload: (paths: string[]) => void;
  existingVideos?: string[];
  maxVideos?: number;
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
  /* 摄像头录像相关 */
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

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

  /* ========== 摄像头录像（APP + 移动端浏览器） ========== */

  async function 打开摄像头() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOpen(true);
    } catch (err: unknown) {
      alert("无法打开摄像头: " + (err instanceof Error ? err.message : "请检查权限"));
    }
  }

  function 关闭摄像头() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setCameraOpen(false);
    setRecording(false);
    setRecordingTime(0);
  }

  function 开始录像() {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const recorder = new MediaRecorder(streamRef.current, { mimeType: "video/webm" });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      if (blob.size > maxFileSizeMB * 1024 * 1024) {
        alert(`视频大小不能超过 ${maxFileSizeMB}MB`);
        return;
      }
      const file = new File([blob], `record_${Date.now()}.webm`, { type: "video/webm" });
      const dt = new DataTransfer();
      dt.items.add(file);
      await handleFiles(dt.files);
    };

    recorder.start();
    setRecording(true);
    setRecordingTime(0);
    timerRef.current = setInterval(() => {
      setRecordingTime((t) => {
        if (t + 1 >= maxDurationSeconds) {
          停止录像();
          return t;
        }
        return t + 1;
      });
    }, 1000);
  }

  function 停止录像() {
    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.stop();
    }
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    关闭摄像头();
  }

  /* 清理 */
  useEffect(() => {
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  /* ========== 删除视频 ========== */

  async function removeVideo(index: number) {
    const target = videos[index];
    const next = videos.filter((_, i) => i !== index);
    setVideos(next);
    onUpload(next);
    if (target) {
      删除文件(target);
    }
  }

  function 格式化秒数(s: number): string {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
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
            {/* APP 环境：用摄像头录像（WebView 不支持 file input） */}
            {是APP ? (
              <button
                type="button"
                onClick={打开摄像头}
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
            ) : (
              <>
                {/* 浏览器-移动端：录像 + 选视频 */}
                <button
                  type="button"
                  onClick={打开摄像头}
                  disabled={上传中}
                  className={`md:hidden w-24 h-20 rounded border border-dashed border-blue-300 flex flex-col items-center justify-center text-blue-500 hover:border-blue-500 hover:bg-blue-50 transition-colors select-none ${上传中 ? "opacity-50 pointer-events-none" : ""}`}
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
        {是APP ? "点击录像按钮拍摄视频" : "支持摄像头录像或选择文件"}。单个不超过 {maxFileSizeMB}MB、{maxDurationSeconds} 秒。
      </p>

      {/* 摄像头录像弹窗 */}
      {cameraOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
          <div className="bg-black rounded-xl overflow-hidden w-full max-w-md">
            <div className="relative aspect-[3/4] bg-black">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              {/* 录像指示器 */}
              {recording && (
                <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/50 rounded-full px-3 py-1">
                  <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
                  <span className="text-white text-sm">{格式化秒数(recordingTime)}</span>
                </div>
              )}
            </div>
            <div className="flex items-center justify-center gap-6 p-4 bg-black">
              <button type="button" onClick={关闭摄像头} className="px-4 py-2 text-sm text-white bg-gray-600 rounded-lg hover:bg-gray-700">
                取消
              </button>
              {recording ? (
                <button type="button" onClick={停止录像} className="w-16 h-16 rounded-full border-4 border-red-500 bg-red-500/30 hover:bg-red-500/50 flex items-center justify-center">
                  <span className="w-5 h-5 bg-white rounded-sm" />
                </button>
              ) : (
                <button type="button" onClick={开始录像} className="w-16 h-16 rounded-full border-4 border-white bg-white/20 hover:bg-white/30" />
              )}
              <span className="text-sm text-white">{recording ? "停止" : "录像"}</span>
            </div>
          </div>
        </div>
      )}

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

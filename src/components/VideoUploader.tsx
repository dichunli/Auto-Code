"use client";

import { useId, useRef, useState, useCallback } from "react";
import { 是Capacitor环境 } from "@/lib/capacitorEnv";
import { 启动原生录像, 本地文件路径转URL } from "@/lib/androidVideoCapture";

interface Props {
  onUpload: (paths: string[]) => void;
  existingVideos?: string[];
  maxVideos?: number;
}

export function VideoUploader({ onUpload, existingVideos = [], maxVideos = 3 }: Props) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraId = `vid-camera-${useId()}`;
  const fileId = `vid-file-${useId()}`;
  const [uploading, setUploading] = useState(false);
  const [videos, setVideos] = useState<string[]>(existingVideos);
  const [progress, setProgress] = useState(0);

  const uploadSingle = useCallback(
    async (file: File): Promise<string> => {
      return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append("file", file, file.name);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/upload", true);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100));
          }
        };

        xhr.onload = () => {
          if (xhr.status === 200) {
            const result = JSON.parse(xhr.responseText);
            resolve(result.path);
          } else {
            const result = JSON.parse(xhr.responseText || '{}');
            reject(new Error(result.error || "上传失败"));
          }
        };

        xhr.timeout = 60000;
        xhr.onerror = () => reject(new Error("上传失败"));
        xhr.ontimeout = () => reject(new Error("上传超时"));

        xhr.send(formData);
      });
    },
    []
  );

  const handleFiles = useCallback(
    async (files: FileList) => {
      const fileArray = Array.from(files)
        .filter((f) => f.type.startsWith("video/") || !f.type)
        .slice(0, maxVideos - videos.length);

      if (fileArray.length === 0) {
        alert("未检测到视频文件，请重新选择");
        return;
      }

      if (fileArray.some((f) => f.size > 100 * 1024 * 1024)) {
        alert("视频大小不能超过 100MB");
        return;
      }

      /* 检查视频时长不超过 60 秒 */
      for (const file of fileArray) {
        const duration = await new Promise<number>((resolve, reject) => {
          const video = document.createElement("video");
          const url = URL.createObjectURL(file);
          const timer = setTimeout(() => {
            URL.revokeObjectURL(url);
            reject(new Error("读取视频信息超时，请尝试选择文件上传"));
          }, 5000);
          video.onloadedmetadata = () => {
            clearTimeout(timer);
            URL.revokeObjectURL(url);
            resolve(video.duration);
          };
          video.onerror = () => {
            clearTimeout(timer);
            URL.revokeObjectURL(url);
            reject(new Error("无法读取视频信息"));
          };
          video.src = url;
        });
        if (duration > 60) {
          alert("视频时长不能超过 60 秒");
          return;
        }
      }

      setUploading(true);
      setProgress(0);

      try {
        /* 串行上传视频（大文件并行容易出问题），但带进度 */
        const results: string[] = [];
        for (let i = 0; i < fileArray.length; i++) {
          setProgress(0);
          const path = await uploadSingle(fileArray[i]);
          results.push(path);
          setVideos((prev) => {
            const next = [...prev, path];
            onUpload(next);
            return next;
          });
        }
      } catch (err: unknown) {
        alert("视频上传失败: " + (err instanceof Error ? err.message : String(err)));
      } finally {
        setUploading(false);
        setProgress(0);
      }
    },
    [videos, maxVideos, onUpload, uploadSingle]
  );

  /* APP环境：调用原生录像 */
  async function handleAppRecord() {
    if (videos.length >= maxVideos) {
      alert(`最多上传 ${maxVideos} 个视频`);
      return;
    }
    try {
      const result = await 启动原生录像();
      if (result.cancelled) return;
      if (result.error || !result.filePath) {
        alert("录像失败: " + (result.error || "未知错误"));
        return;
      }

      /* 将本地文件路径转为 WebView 可访问的 URL */
      const fileUrl = 本地文件路径转URL(result.filePath);

      /* 读取文件为 Blob */
      setUploading(true);
      setProgress(0);

      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error("读取视频文件失败");
      }
      const blob = await response.blob();

      /* 检查大小 */
      if (blob.size > 100 * 1024 * 1024) {
        alert("视频大小不能超过 100MB");
        setUploading(false);
        return;
      }

      /* 检查时长 */
      const duration = await new Promise<number>((resolve, reject) => {
        const video = document.createElement("video");
        const url = URL.createObjectURL(blob);
        const timer = setTimeout(() => {
          URL.revokeObjectURL(url);
          reject(new Error("读取视频信息超时"));
        }, 5000);
        video.onloadedmetadata = () => {
          clearTimeout(timer);
          URL.revokeObjectURL(url);
          resolve(video.duration);
        };
        video.onerror = () => {
          clearTimeout(timer);
          URL.revokeObjectURL(url);
          reject(new Error("无法读取视频信息"));
        };
        video.src = url;
      });
      if (duration > 60) {
        alert("视频时长不能超过 60 秒");
        setUploading(false);
        return;
      }

      const file = new File([blob], `record_${Date.now()}.mp4`, { type: blob.type || "video/mp4" });
      const dt = new DataTransfer();
      dt.items.add(file);
      await handleFiles(dt.files);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("录像上传失败: " + msg);
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    handleFiles(files);
    e.target.value = "";
  }

  function removeVideo(index: number) {
    const next = videos.filter((_, i) => i !== index);
    setVideos(next);
    onUpload(next);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {videos.map((src, i) => (
          <div key={i} className="relative w-32 h-24 rounded border border-gray-200 overflow-hidden group bg-gray-900">
            <video src={src} className="w-full h-full object-cover" controls preload="metadata" />
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
            {/* 移动端：APP环境调用原生录像，浏览器环境用 input */}
            {是Capacitor环境() ? (
              <button
                type="button"
                onClick={handleAppRecord}
                disabled={uploading}
                className={`md:hidden w-24 h-20 rounded border border-dashed border-blue-300 flex flex-col items-center justify-center text-blue-500 hover:border-blue-500 hover:bg-blue-50 transition-colors select-none ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
              >
                {uploading ? (
                  <div className="flex flex-col items-center">
                    <span className="text-xs">{progress}%</span>
                    <div className="w-12 h-1 bg-gray-200 rounded mt-1 overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded transition-all"
                        style={{ width: `${progress}%` }}
                      />
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
              </button>
            ) : (
              <label
                htmlFor={cameraId}
                className={`md:hidden w-24 h-20 rounded border border-dashed border-blue-300 flex flex-col items-center justify-center text-blue-500 hover:border-blue-500 hover:bg-blue-50 transition-colors select-none ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
              >
                {uploading ? (
                  <div className="flex flex-col items-center">
                    <span className="text-xs">{progress}%</span>
                    <div className="w-12 h-1 bg-gray-200 rounded mt-1 overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded transition-all"
                        style={{ width: `${progress}%` }}
                      />
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
              </label>
            )}
            <label
              htmlFor={fileId}
              className={`md:hidden w-24 h-20 rounded border border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors select-none ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
            >
              {uploading ? (
                <div className="flex flex-col items-center">
                  <span className="text-xs">{progress}%</span>
                  <div className="w-12 h-1 bg-gray-200 rounded mt-1 overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded transition-all"
                      style={{ width: `${progress}%` }}
                    />
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
            </label>
            {/* PC端 */}
            <label
              htmlFor={fileId}
              className={`hidden md:flex w-32 h-24 rounded border border-dashed border-gray-300 flex-col items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors select-none ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
            >
              {uploading ? (
                <div className="flex flex-col items-center">
                  <span className="text-xs">{progress}%</span>
                  <div className="w-16 h-1 bg-gray-200 rounded mt-1 overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded transition-all"
                      style={{ width: `${progress}%` }}
                    />
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
            </label>
          </div>
        )}
      </div>
      <input
        id={cameraId}
        ref={cameraInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        id={fileId}
        ref={fileInputRef}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
      <p className="text-[10px] text-gray-400 md:hidden">点击后选择「相机」录像或从相册选视频。单个不超过 100MB。</p>
      <p className="text-[10px] text-gray-400 hidden md:block">支持文件上传。单个不超过 100MB。</p>
    </div>
  );
}

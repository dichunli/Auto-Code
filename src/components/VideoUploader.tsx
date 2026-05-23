"use client";

import { useRef, useState, useCallback } from "react";

interface Props {
  onUpload: (paths: string[]) => void;
  existingVideos?: string[];
  maxVideos?: number;
}

export function VideoUploader({ onUpload, existingVideos = [], maxVideos = 3 }: Props) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
        .filter((f) => f.type.startsWith("video/"))
        .slice(0, maxVideos - videos.length);

      if (fileArray.length === 0) return;

      if (fileArray.some((f) => f.size > 100 * 1024 * 1024)) {
        alert("视频大小不能超过 100MB");
        return;
      }

      /* 检查视频时长不超过 60 秒 */
      for (const file of fileArray) {
        const duration = await new Promise<number>((resolve, reject) => {
          const video = document.createElement("video");
          const url = URL.createObjectURL(file);
          video.onloadedmetadata = () => {
            URL.revokeObjectURL(url);
            resolve(video.duration);
          };
          video.onerror = () => {
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
      } catch (err: any) {
        alert("视频上传失败: " + err.message);
      } finally {
        setUploading(false);
        setProgress(0);
      }
    },
    [videos, maxVideos, onUpload, uploadSingle]
  );

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
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              disabled={uploading}
              className="md:hidden w-32 h-24 rounded border border-dashed border-blue-300 flex flex-col items-center justify-center text-blue-500 hover:border-blue-500 hover:bg-blue-50 transition-colors disabled:opacity-50"
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
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <span className="text-[10px]">录像</span>
                  <span className="text-[10px]">{videos.length}/{maxVideos}</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="hidden md:flex w-32 h-24 rounded border border-dashed border-gray-300 flex-col items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors disabled:opacity-50"
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
            </button>
          </div>
        )}
      </div>
      <input
        ref={cameraInputRef}
        type="file"
        accept="video/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
      <p className="text-[10px] text-gray-400 md:hidden">支持相机录像。单个不超过 100MB。</p>
      <p className="text-[10px] text-gray-400 hidden md:block">支持文件上传。单个不超过 100MB。</p>
    </div>
  );
}

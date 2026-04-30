"use client";

import { useRef, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface Props {
  onUpload: (paths: string[]) => void;
  existingVideos?: string[];
  maxVideos?: number;
}

export function VideoUploader({ onUpload, existingVideos = [], maxVideos = 3 }: Props) {
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [videos, setVideos] = useState<string[]>(existingVideos);

  const uploadFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("video/")) {
        alert("请上传视频文件");
        return;
      }
      if (file.size > 100 * 1024 * 1024) {
        alert("视频大小不能超过 100MB");
        return;
      }
      if (videos.length >= maxVideos) {
        alert(`最多上传 ${maxVideos} 个视频`);
        return;
      }

      setUploading(true);
      try {
        const ext = file.name.split(".").pop() || "mp4";
        const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

        const { error } = await supabase.storage.from("work-order-media").upload(fileName, file, {
          contentType: file.type,
          upsert: false,
        });

        if (error) throw error;

        const { data: urlData } = supabase.storage.from("work-order-media").getPublicUrl(fileName);
        const path = urlData?.publicUrl || fileName;

        const next = [...videos, path];
        setVideos(next);
        onUpload(next);
      } catch (err: any) {
        alert("视频上传失败: " + err.message);
      } finally {
        setUploading(false);
      }
    },
    [videos, maxVideos, onUpload, supabase]
  );

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((f) => uploadFile(f));
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
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-32 h-24 rounded border border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors disabled:opacity-50"
          >
            {uploading ? (
              <span className="text-xs">上传中...</span>
            ) : (
              <>
                <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span className="text-[10px]">{videos.length}/{maxVideos}</span>
              </>
            )}
          </button>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
      <p className="text-[10px] text-gray-400">支持上传视频文件，单个不超过 100MB。手机端可直接录制。</p>
    </div>
  );
}

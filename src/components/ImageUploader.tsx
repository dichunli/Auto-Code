"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/imageCompress";

interface Props {
  onUpload: (paths: string[]) => void;
  existingImages?: string[];
  maxImages?: number;
  bucket?: string;
  folder?: string;
}

export function ImageUploader({ onUpload, existingImages = [], maxImages = 5, bucket = "work-order-media", folder = "work-order-media" }: Props) {
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [images, setImages] = useState<string[]>(existingImages);

  useEffect(() => {
    setImages(existingImages);
  }, [existingImages]);

  const uploadFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      if (images.length >= maxImages) {
        alert(`最多上传 ${maxImages} 张图片`);
        return;
      }

      setUploading(true);
      try {
        const compressed = await compressImage(file, 150);
        const ext = file.name.split(".").pop() || "jpg";
        const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const filePath = `${folder}/${fileName}`;

        const { error } = await supabase.storage.from(bucket).upload(fileName, compressed, {
          contentType: "image/jpeg",
          upsert: false,
        });

        if (error) throw error;

        const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(fileName);
        const path = urlData?.publicUrl || filePath;

        const next = [...images, path];
        setImages(next);
        onUpload(next);
      } catch (err: any) {
        alert("图片上传失败: " + err.message);
      } finally {
        setUploading(false);
      }
    },
    [images, maxImages, onUpload, supabase, bucket, folder]
  );

  // 粘贴上传
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const files = e.clipboardData?.files;
      if (!files) return;
      Array.from(files).forEach((f) => uploadFile(f));
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [uploadFile]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((f) => uploadFile(f));
    e.target.value = "";
  }

  function removeImage(index: number) {
    const next = images.filter((_, i) => i !== index);
    setImages(next);
    onUpload(next);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {images.map((src, i) => (
          <div key={i} className="relative w-20 h-20 rounded border border-gray-200 overflow-hidden group">
            <img src={src} alt="" className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => removeImage(i)}
              className="absolute top-0.5 right-0.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              ×
            </button>
          </div>
        ))}
        {images.length < maxImages && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-20 h-20 rounded border border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors disabled:opacity-50"
          >
            {uploading ? (
              <span className="text-xs">压缩中...</span>
            ) : (
              <>
                <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="text-[10px]">{images.length}/{maxImages}</span>
              </>
            )}
          </button>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
      <p className="text-[10px] text-gray-400">
        支持点击上传、Ctrl+V 粘贴、手机拍照。单张自动压缩至150KB以内。
      </p>
    </div>
  );
}

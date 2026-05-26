"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { compressImage } from "@/lib/imageCompress";

interface Props {
  onUpload: (paths: string[]) => void;
  existingImages?: string[];
  maxImages?: number;
  bucket?: string;
  folder?: string;
}

export function ImageUploader({ onUpload, existingImages = [], maxImages = 5 }: Props) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const idRef = useRef(`img-${Math.random().toString(36).slice(2, 9)}`);
  const cameraId = `${idRef.current}-camera`;
  const fileId = `${idRef.current}-file`;
  const [uploading, setUploading] = useState(false);
  const [images, setImages] = useState<string[]>(existingImages);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [uploadProgress, setUploadProgress] = useState("");

  useEffect(() => {
    setImages(existingImages);
  }, [existingImages]);

  const handleFiles = useCallback(
    async (files: FileList) => {
      const fileArray = Array.from(files).slice(0, maxImages - images.length);
      if (fileArray.length === 0) {
        alert(`最多上传 ${maxImages} 张图片`);
        return;
      }

      setUploading(true);
      setUploadProgress(`0 / ${fileArray.length}`);

      try {
        const results: string[] = [];

        /* 先并行压缩所有图片 */
        const compressedBlobs = await Promise.all(
          fileArray.map(async (file) => {
            const blob = await compressImage(file, 150);
            return { blob, name: file.name };
          })
        );

        /* 再并行上传 */
        const uploadPromises = compressedBlobs.map(async ({ blob, name }, index) => {
          const formData = new FormData();
          formData.append("file", blob, name);
          const res = await fetch("/api/upload", {
            method: "POST",
            body: formData,
          });
          const result = await res.json();
          if (!res.ok) throw new Error(result.error || "上传失败");
          results[index] = result.path;
          setUploadProgress(`${results.filter(Boolean).length} / ${fileArray.length}`);
          return result.path;
        });

        const paths = await Promise.all(uploadPromises);
        const next = [...images, ...paths];
        setImages(next);
        onUpload(next);
      } catch (err: unknown) {
        alert("图片上传失败: " + (err instanceof Error ? err.message : String(err)));
      } finally {
        setUploading(false);
        setUploadProgress("");
      }
    },
    [images, maxImages, onUpload]
  );

  // 粘贴上传
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const files = e.clipboardData?.files;
      if (!files) return;
      handleFiles(files);
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [handleFiles]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    handleFiles(files);
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
          <div key={i} className="relative w-20 h-20 rounded border border-gray-200 overflow-hidden group cursor-pointer">
            <img src={src} alt="" className="w-full h-full object-cover" onClick={() => setPreviewIndex(i)} />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeImage(i); }}
              className="absolute top-0.5 right-0.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              ×
            </button>
          </div>
        ))}
        {images.length < maxImages && (
          <div className="flex gap-2">
            {/* 移动端：用 label 关联 input，比 ref.click() 更可靠 */}
            <label
              htmlFor={cameraId}
              className={`md:hidden w-20 h-20 rounded border border-dashed border-blue-300 flex flex-col items-center justify-center text-blue-500 hover:border-blue-500 hover:bg-blue-50 transition-colors select-none ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
            >
              {uploading ? (
                <span className="text-xs">{uploadProgress || "上传中..."}</span>
              ) : (
                <>
                  <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="text-[10px]">拍照</span>
                  <span className="text-[10px]">{images.length}/{maxImages}</span>
                </>
              )}
            </label>
            <label
              htmlFor={fileId}
              className={`hidden md:flex w-20 h-20 rounded border border-dashed border-gray-300 flex-col items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors select-none ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
            >
              {uploading ? (
                <span className="text-xs">{uploadProgress || "上传中..."}</span>
              ) : (
                <>
                  <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="text-[10px]">相册</span>
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
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        id={fileId}
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
      <p className="text-[10px] text-gray-400 md:hidden">支持拍照。单张自动压缩至150KB以内。</p>
      <p className="text-[10px] text-gray-400 hidden md:block">支持拍照、相册选择、Ctrl+V 粘贴。单张自动压缩至150KB以内。</p>

      {/* 图片预览 */}
      {previewIndex !== null && images[previewIndex] && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80"
          onClick={() => setPreviewIndex(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]">
            <img
              src={images[previewIndex]}
              alt=""
              className="max-w-full max-h-[90vh] object-contain rounded"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              type="button"
              onClick={() => setPreviewIndex(null)}
              className="absolute -top-10 right-0 text-white text-2xl leading-none hover:text-gray-300"
            >
              ✕
            </button>
            {images.length > 1 && (
              <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setPreviewIndex((i) => (i !== null && i > 0 ? i - 1 : images.length - 1)); }}
                  className="px-3 py-1 bg-white/20 text-white rounded hover:bg-white/30 text-sm"
                >
                  上一张
                </button>
                <span className="text-white text-sm py-1">{previewIndex + 1} / {images.length}</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setPreviewIndex((i) => (i !== null && i < images.length - 1 ? i + 1 : 0)); }}
                  className="px-3 py-1 bg-white/20 text-white rounded hover:bg-white/30 text-sm"
                >
                  下一张
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

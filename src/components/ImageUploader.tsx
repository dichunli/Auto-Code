"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { base64转Blob } from "@/lib/imageCompress";
import { 是Capacitor环境 } from "@/lib/capacitorEnv";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { useUpload } from "@/hooks/useUpload";
import { ImageViewer } from "./ImageViewer";

interface Props {
  onUpload: (paths: string[]) => void;
  onDelete?: (path: string) => void;
  existingImages?: string[];
  maxImages?: number;
  bucket?: string;
  folder?: string;
  disabled?: boolean;
}

export function ImageUploader({ onUpload, onDelete, existingImages = [], maxImages = 5, folder, disabled = false }: Props) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<string[]>(existingImages);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const {
    上传,
    上传中,
    总进度,
    错误: uploadError,
  } = useUpload({
    mediaType: "image",
    compressMaxKB: 300,
    timeoutMs: 30000,
    folder,
    onSuccess: (paths) => {
      /* 每上传成功一个就通知父组件 */
      onUpload(paths);
    },
  });

  /* 同步外部图片列表 */
  useEffect(() => {
    setImages(existingImages);
  }, [existingImages]);

  /* ========== 文件上传 ========== */

  const handleFiles = useCallback(
    async (fileList: FileList) => {
      const fileArray = Array.from(fileList).slice(0, maxImages - images.length);
      if (fileArray.length === 0) {
        alert(`最多上传 ${maxImages} 张图片`);
        return;
      }

      const { urls, errors } = await 上传(fileArray);

      if (urls.length > 0) {
        const next = [...images, ...urls];
        setImages(next);
        onUpload(next);
      }

      if (errors.length > 0) {
        const msg = errors.map((e) => `${e.file}: ${e.error}`).join("\n");
        alert("图片上传失败:\n" + msg);
      }
    },
    [images, maxImages, 上传, onUpload]
  );

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    handleFiles(files);
    e.target.value = "";
  }

  /* ========== 粘贴上传 ========== */

  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        return;
      }
      const files = e.clipboardData?.files;
      if (!files || files.length === 0) return;
      handleFiles(files);
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [handleFiles]);

  /* ========== 删除图片 ========== */

  async function removeImage(index: number) {
    const target = images[index];
    const next = images.filter((_, i) => i !== index);
    setImages(next);
    onUpload(next);

    /* 通知父组件有图片被删除，由父组件统一决定何时真正删除服务端文件 */
    if (target && onDelete) {
      onDelete(target);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {images.map((src, i) => (
          <div key={i} className="relative w-20 h-20 rounded border border-gray-200 overflow-hidden group cursor-pointer">
            <img src={src} alt="" className="w-full h-full object-cover" onClick={() => setPreviewIndex(i)} />
            {onDelete && !disabled && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeImage(i); }}
                className="absolute top-0.5 right-0.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity md:w-5 md:h-5 w-6 h-6"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {!disabled && images.length < maxImages && (
          <div className="flex gap-2">
            {/* 移动端 */}
            {是Capacitor环境() ? (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const photo = await Camera.getPhoto({
                      quality: 90,
                      allowEditing: false,
                      resultType: CameraResultType.Base64,
                      source: CameraSource.Camera,
                    });
                    if (!photo.base64String) {
                      alert("拍照未获取到图片");
                      return;
                    }
                    const base64 = `data:image/jpeg;base64,${photo.base64String}`;
                    const blob = base64转Blob(base64);
                    const file = new File([blob], `camera_${Date.now()}.jpg`, { type: "image/jpeg" });
                    const dt = new DataTransfer();
                    dt.items.add(file);
                    handleFiles(dt.files);
                  } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (msg.includes("cancel") || msg.includes("denied") || msg.includes("User denied")) return;
                    alert("拍照失败: " + msg);
                  }
                }}
                disabled={上传中}
                className={`md:hidden w-20 h-20 rounded border border-dashed border-blue-300 flex flex-col items-center justify-center text-blue-500 hover:border-blue-500 hover:bg-blue-50 transition-colors select-none ${上传中 ? "opacity-50 pointer-events-none" : ""}`}
              >
                {上传中 ? (
                  <span className="text-xs">{总进度 || "上传中..."}</span>
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
              </button>
            ) : (
              <label
                className={`md:hidden w-20 h-20 rounded border border-dashed border-blue-300 flex flex-col items-center justify-center text-blue-500 hover:border-blue-500 hover:bg-blue-50 transition-colors select-none ${上传中 ? "opacity-50 pointer-events-none" : ""}`}
              >
                {上传中 ? (
                  <span className="text-xs">{总进度 || "上传中..."}</span>
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
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={handleFileChange}
                />
              </label>
            )}
            {/* PC端 */}
            <label
              className={`hidden md:flex w-20 h-20 rounded border border-dashed border-gray-300 flex-col items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors select-none ${上传中 ? "opacity-50 pointer-events-none" : ""}`}
            >
              {上传中 ? (
                <span className="text-xs">{总进度 || "上传中..."}</span>
              ) : (
                <>
                  <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="text-[10px]">相册</span>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={handleFileChange}
              />
            </label>
          </div>
        )}
      </div>

      {uploadError && (
        <p className="text-xs text-red-500 bg-red-50 rounded px-2 py-1">{uploadError}</p>
      )}

      <p className="text-[10px] text-gray-400 md:hidden">支持拍照。单张自动压缩至 300KB 以内。</p>
      <p className="text-[10px] text-gray-400 hidden md:block">支持拍照、相册选择、Ctrl+V 粘贴。单张自动压缩至 300KB 以内。</p>

      {/* 图片预览 */}
      {previewIndex !== null && images[previewIndex] && (
        <ImageViewer
          src={images[previewIndex]}
          images={images}
          currentIndex={previewIndex}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
          onDelete={(idx) => {
            removeImage(idx);
            if (images.length <= 1) setPreviewIndex(null);
          }}
        />
      )}
    </div>
  );
}

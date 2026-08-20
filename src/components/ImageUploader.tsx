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
  disableCamera?: boolean;
  cameraOnly?: boolean;
  folder?: string;
  disabled?: boolean;
}

export function ImageUploader({ onUpload, onDelete, existingImages = [], maxImages = 5, folder, disabled = false, disableCamera = false, cameraOnly = false }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<string[]>(existingImages);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const {
    上传,
    上传中,
    总进度,
    错误: uploadError,
    删除文件,
  } = useUpload({
    mediaType: "image",
    timeoutMs: 30000,
    folder,
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

  /* ========== 粘贴上传（cameraOnly 模式下禁用，防止桌面端绕过"仅手机拍照"） ========== */

  useEffect(() => {
    if (cameraOnly) return;
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
  }, [handleFiles, cameraOnly]);

  /* ========== 删除图片 ========== */

  async function removeImage(index: number) {
    const target = images[index];
    const next = images.filter((_, i) => i !== index);
    setImages(next);
    onUpload(next);

    /* 通知父组件有图片被删除；父组件未处理时，自动清理服务端文件 */
    if (target) {
      if (onDelete) {
        onDelete(target);
      } else {
        await 删除文件(target);
      }
    }
  }

  /* ========== APP 拍照 ========== */

  async function handleAppCamera() {
    if (images.length >= maxImages) {
      alert(`最多上传 ${maxImages} 张图片`);
      return;
    }
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
      await handleFiles(dt.files);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("cancel") || msg.includes("denied") || msg.includes("User denied")) return;
      alert("拍照失败: " + msg);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {images.map((src, i) => (
          <div key={i} className="relative w-20 h-20 rounded-lg border border-gray-200 overflow-hidden group cursor-pointer">
            <img src={src} alt="" className="w-full h-full object-cover" onClick={() => setPreviewIndex(i)} />
            {!disabled && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeImage(i); }}
                className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity shadow-sm"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {!disabled && images.length < maxImages && (
          <div className="flex items-center gap-1">
            {是Capacitor环境() ? (
              <>
                {/* APP环境：拍照（可禁用） */}
                {!disableCamera && (
                <button
                  type="button"
                  onClick={handleAppCamera}
                  disabled={上传中}
                  className={`w-14 h-14 rounded-lg border border-dashed border-blue-300 flex items-center justify-center text-blue-500 hover:border-blue-500 hover:bg-blue-50 transition-colors select-none ${上传中 ? "opacity-50 pointer-events-none" : ""}`}
                  title="拍照"
                >
                  {上传中 ? (
                    <span className="text-xs">{总进度 || "..."}</span>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                </button>
                )}
                {!cameraOnly && (
                  <>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={上传中}
                    className={`w-14 h-14 rounded-lg border border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors select-none ${上传中 ? "opacity-50" : ""}`}
                    title="相册"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="sr-only"
                    onChange={handleFileChange}
                  />
                  </>
                )}
              </>
            ) : (
              <>
                {/* 非APP移动端：拍照（可禁用） */}
                {!disableCamera && (
                <label
                  className={`md:hidden w-14 h-14 rounded-lg border border-dashed border-blue-300 flex items-center justify-center text-blue-500 hover:border-blue-500 hover:bg-blue-50 transition-colors select-none ${上传中 ? "opacity-50 pointer-events-none" : ""}`}
                  title="拍照"
                >
                  {上传中 ? (
                    <span className="text-xs">{总进度 || "..."}</span>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={handleFileChange}
                  />
                </label>
                )}
                {/* cameraOnly：桌面端不显示任何上传入口，只给提示 */}
                {cameraOnly && (
                  <div className="hidden md:flex h-14 items-center px-3 rounded-lg border border-dashed border-gray-200 text-xs text-gray-400 select-none">
                    仅支持手机现场拍照上传
                  </div>
                )}
                {!cameraOnly && (
                  <>
                  {/* 移动端相册 */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={上传中}
                    className={`md:hidden w-14 h-14 rounded-lg border border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors select-none ${上传中 ? "opacity-50" : ""}`}
                    title="相册"
                  >
                    {上传中 ? (
                      <span className="text-xs">{总进度 || "..."}</span>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                  {/* PC端：相册 */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={上传中}
                    className={`hidden md:flex w-14 h-14 rounded-lg border border-dashed border-gray-300 flex-col items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors select-none ${上传中 ? "opacity-50" : ""}`}
                    title="相册"
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
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="sr-only"
                    onChange={handleFileChange}
                  />
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {uploadError && (
        <p className="text-xs text-red-500 bg-red-50 rounded px-2 py-1">{uploadError}</p>
      )}

      <p className="text-[10px] text-gray-400">
        {cameraOnly ? "仅支持手机现场拍照。单张自动压缩至 300KB 以内。" : "支持拍照、相册选择、Ctrl+V 粘贴。单张自动压缩至 300KB 以内。"}
      </p>

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

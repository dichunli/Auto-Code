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

/* ============================================================
   图片预览 — 支持双指缩放、滚轮缩放、拖动平移
   ============================================================ */
interface PreviewProps {
  src: string;
  index: number;
  total: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}

function ImagePreview({ src, index, total, onClose, onPrev, onNext }: PreviewProps) {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const pinchRef = useRef({ startDist: 0, startScale: 1 });
  const panRef = useRef({ startX: 0, startY: 0, startTx: 0, startTy: 0 });

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function getDistance(touches: TouchList) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      pinchRef.current = { startDist: getDistance(e.touches), startScale: scale };
    } else if (e.touches.length === 1 && scale > 1) {
      panRef.current = {
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        startTx: translate.x,
        startTy: translate.y,
      };
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dist = getDistance(e.touches);
      if (pinchRef.current.startDist > 0) {
        const ratio = dist / pinchRef.current.startDist;
        setScale(Math.max(1, Math.min(5, pinchRef.current.startScale * ratio)));
      }
    } else if (e.touches.length === 1 && scale > 1) {
      e.preventDefault();
      const dx = e.touches[0].clientX - panRef.current.startX;
      const dy = e.touches[0].clientY - panRef.current.startY;
      setTranslate({ x: panRef.current.startTx + dx, y: panRef.current.startTy + dy });
    }
  }

  function handleTouchEnd() {
    if (scale < 1) { setScale(1); setTranslate({ x: 0, y: 0 }); }
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale((s) => Math.max(1, Math.min(5, s * delta)));
  }

  function handleDoubleClick() {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80"
      onClick={onClose}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <img
        src={src}
        alt=""
        className="max-w-[90vw] max-h-[90vh] object-contain rounded select-none"
        style={{
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
          transition: scale === 1 ? "transform 0.2s ease" : "none",
        }}
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        draggable={false}
      />

      {/* 关闭按钮 */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl leading-none z-10"
      >
        ✕
      </button>

      {/* 底部操作栏 */}
      <div className="absolute bottom-4 left-0 right-0 flex justify-center items-center gap-3 z-10">
        {total > 1 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPrev(); setScale(1); setTranslate({ x: 0, y: 0 }); }}
            className="px-3 py-1 bg-white/20 text-white rounded hover:bg-white/30 text-sm"
          >
            上一张
          </button>
        )}
        <span className="text-white/70 text-xs">
          {index + 1} / {total} · {Math.round(scale * 100)}% · 双击重置
        </span>
        {total > 1 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onNext(); setScale(1); setTranslate({ x: 0, y: 0 }); }}
            className="px-3 py-1 bg-white/20 text-white rounded hover:bg-white/30 text-sm"
          >
            下一张
          </button>
        )}
      </div>
    </div>
  );
}

export function ImageUploader({ onUpload, existingImages = [], maxImages = 5 }: Props) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [images, setImages] = useState<string[]>(existingImages);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [uploadProgress, setUploadProgress] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

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
      setErrorMsg("");
      setUploadProgress(`0 / ${fileArray.length}`);

      try {
        const results: string[] = [];

        /* 逐个处理（串行），移动端并行容易内存不足 */
        for (let i = 0; i < fileArray.length; i++) {
          const file = fileArray[i];
          setUploadProgress(`${i + 1} / ${fileArray.length} 压缩中...`);

          let blob: Blob;
          try {
            blob = await compressImage(file, 150);
          } catch {
            blob = file;
          }

          setUploadProgress(`${i + 1} / ${fileArray.length} 上传中...`);

          const formData = new FormData();
          formData.append("file", blob, file.name);

          /* 10 秒超时 */
          const controller = new AbortController();
          const timeoutId = setTimeout(() => {
            controller.abort();
          }, 10000);

          let res: Response;
          try {
            res = await fetch("/api/upload", {
              method: "POST",
              body: formData,
              signal: controller.signal,
            });
            clearTimeout(timeoutId);
          } catch (fetchErr: unknown) {
            clearTimeout(timeoutId);
            const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
            throw new Error("网络请求失败: " + msg);
          }

          let result: { path?: string; error?: string };
          try {
            result = await res.json();
          } catch {
            throw new Error("服务器返回格式错误,状态码: " + res.status);
          }

          if (!res.ok) {
            throw new Error(result.error || "上传失败(HTTP " + res.status + ")");
          }

          results[i] = result.path!;
          setUploadProgress(`${results.filter(Boolean).length} / ${fileArray.length}`);
        }

        const next = [...images, ...results];
        setImages(next);
        onUpload(next);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMsg(msg);
        alert("图片上传失败: " + msg);
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
            {/* 移动端：input 嵌套在 label 内部，比 htmlFor 关联更可靠 */}
            <label
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
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={handleFileChange}
              />
            </label>
            <label
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
      {errorMsg && (
        <p className="text-xs text-red-500 bg-red-50 rounded px-2 py-1">上传失败: {errorMsg}</p>
      )}
      <p className="text-[10px] text-gray-400 md:hidden">支持拍照。单张自动压缩至150KB以内。</p>
      <p className="text-[10px] text-gray-400 hidden md:block">支持拍照、相册选择、Ctrl+V 粘贴。单张自动压缩至150KB以内。</p>

      {/* 图片预览（支持双指缩放、滚轮缩放、拖动平移） */}
      {previewIndex !== null && images[previewIndex] && (
        <ImagePreview
          src={images[previewIndex]}
          index={previewIndex}
          total={images.length}
          onClose={() => setPreviewIndex(null)}
          onPrev={() => setPreviewIndex((i) => (i !== null && i > 0 ? i - 1 : images.length - 1))}
          onNext={() => setPreviewIndex((i) => (i !== null && i < images.length - 1 ? i + 1 : 0))}
        />
      )}
    </div>
  );
}

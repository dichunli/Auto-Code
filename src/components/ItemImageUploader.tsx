"use client";

import { useState, useRef, useEffect, useCallback, useId } from "react";
import { createClient } from "@/lib/supabase/client";
import { compressImage, base64转Blob } from "@/lib/imageCompress";
import { 是Capacitor环境 } from "@/lib/capacitorEnv";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { ImageViewer } from "./ImageViewer";

interface Props {
  itemId: string;
  existingImages: string[];
  isLocked?: boolean;
}

export default function ItemImageUploader({ itemId, existingImages, isLocked }: Props) {
  const supabase = createClient();
  const [images, setImages] = useState(existingImages);
  const [saving, setSaving] = useState(false);
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileId = `item-img-${useId()}`;

  useEffect(() => {
    setImages(existingImages);
  }, [existingImages]);

  const uploadFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      if (images.length >= 5) {
        alert("最多上传 5 张图片");
        return;
      }

      setSaving(true);
      try {
        const compressed = await compressImage(file, 150);
        const formData = new FormData();
        formData.append("file", compressed, file.name);

        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || "上传失败");

        const { error: dbError } = await supabase.from("work_order_item_media").insert({
          work_order_item_id: itemId,
          media_type: "image",
          storage_path: result.path,
        });
        if (dbError) throw dbError;

        setImages((prev) => [...prev, result.path]);
      } catch (err: unknown) {
        alert("图片上传失败: " + (err instanceof Error ? err.message : String(err)));
      } finally {
        setSaving(false);
      }
    },
    [images, itemId, supabase]
  );

  async function removeImage(index: number) {
    const path = images[index];
    setImages((prev) => prev.filter((_, i) => i !== index));
    const { error } = await supabase
      .from("work_order_item_media")
      .delete()
      .eq("work_order_item_id", itemId)
      .eq("storage_path", path);
    if (error) {
      alert("删除失败: " + error.message);
      setImages(existingImages);
    }
  }

  /* APP环境：调用原生相机拍照 */
  async function handleAppCamera() {
    if (images.length >= 5) {
      alert("最多上传 5 张图片");
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
      await uploadFile(file);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("cancel") || msg.includes("denied") || msg.includes("User denied")) return;
      alert("拍照失败: " + msg);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((f) => uploadFile(f));
    e.target.value = "";
  }

  // 粘贴上传（只有鼠标悬停在本组件上时才响应）
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      if (!isHovered) return;
      const files = e.clipboardData?.files;
      if (!files || files.length === 0) return;
      Array.from(files).forEach((f) => uploadFile(f));
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [uploadFile, isHovered]);

  return (
    <div className="flex items-center gap-1" onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
      {images.map((src, i) => (
        <div key={i} className="relative w-14 h-14 rounded-lg border border-gray-200 overflow-hidden group cursor-pointer">
          <img src={src} alt="" className="w-full h-full object-cover" onClick={() => setViewerSrc(src)} />
          {!isLocked && (
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
      {!isLocked && images.length < 5 && (
        <>
          <span className="text-xs text-gray-500 ml-1">添加图片</span>
          {是Capacitor环境() ? (
            <>
              {/* APP环境：拍照 + 相册 */}
              <button
                type="button"
                onClick={handleAppCamera}
                disabled={saving}
                className={`w-14 h-14 rounded-lg border border-dashed border-blue-300 flex items-center justify-center text-blue-500 hover:border-blue-500 hover:bg-blue-50 transition-colors select-none ${saving ? 'opacity-50 pointer-events-none' : ''}`}
                title="拍照"
              >
                {saving ? (
                  <span className="text-xs">...</span>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </button>
              <label
                htmlFor={fileId}
                className={`w-14 h-14 rounded-lg border border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors select-none ${saving ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}
                title="相册"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </label>
              <input
                id={fileId}
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
            </>
          ) : (
            <>
              <label
                htmlFor={fileId}
                className={`w-14 h-14 rounded-lg border border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors select-none ${saving ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}
                title="上传/粘贴/拍照"
              >
                {saving ? (
                  <span className="text-xs">...</span>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                )}
              </label>
              <input
                id={fileId}
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
            </>
          )}
        </>
      )}
      {viewerSrc && (
        <ImageViewer src={viewerSrc} onClose={() => setViewerSrc(null)} />
      )}
    </div>
  );
}

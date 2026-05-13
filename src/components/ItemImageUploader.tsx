"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/imageCompress";
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
        const ext = file.name.split(".").pop() || "jpg";
        const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

        const { error: uploadError } = await supabase.storage.from("work-order-media").upload(fileName, compressed, {
          contentType: "image/jpeg",
          upsert: false,
        });
        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage.from("work-order-media").getPublicUrl(fileName);
        const path = urlData?.publicUrl || fileName;

        const { error: dbError } = await supabase.from("work_order_item_media").insert({
          work_order_item_id: itemId,
          media_type: "image",
          storage_path: path,
        });
        if (dbError) throw dbError;

        setImages((prev) => [...prev, path]);
      } catch (err: any) {
        alert("图片上传失败: " + err.message);
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
        <div key={i} className="relative w-8 h-8 rounded border border-gray-200 overflow-hidden group cursor-pointer">
          <img src={src} alt="" className="w-full h-full object-cover" onClick={() => setViewerSrc(src)} />
          {!isLocked && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeImage(i); }}
              className="absolute top-0 right-0 w-3 h-3 bg-red-500 text-white rounded-full text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              ×
            </button>
          )}
        </div>
      ))}
      {!isLocked && images.length < 5 && (
        <>
          <span className="text-xs text-gray-500 ml-1">添加图片</span>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={saving}
            className="w-8 h-8 rounded border border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors disabled:opacity-50"
            title="上传/粘贴/拍照"
          >
            {saving ? (
              <span className="text-[8px]">...</span>
            ) : (
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
        </>
      )}
      {viewerSrc && (
        <ImageViewer src={viewerSrc} onClose={() => setViewerSrc(null)} />
      )}
    </div>
  );
}

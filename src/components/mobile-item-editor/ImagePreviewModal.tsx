"use client";

/* 图片大图预览弹窗（2026-09-16 从 MobileItemEditor 拆出）：
   点任意处关闭；层级高于配件详情抽屉（z-[110]）所以用 z-[130] */
interface ImagePreviewModalProps {
  src: string | null;
  onClose: () => void;
}

export function ImagePreviewModal({ src, onClose }: ImagePreviewModalProps) {
  if (!src) return null;
  return (
    <div
      className="fixed inset-0 z-[130] bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <img src={src} alt="" className="max-w-full max-h-full object-contain rounded" />
    </div>
  );
}

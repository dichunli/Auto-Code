"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  src: string;
  onClose: () => void;
}

export function ImageViewer({ src, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const pinchRef = useRef({ startDist: 0, startScale: 1 });
  const panRef = useRef({ startX: 0, startY: 0, startTranslateX: 0, startTranslateY: 0 });

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  /* 双指缩放 */
  function getDistance(touches: TouchList) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      pinchRef.current = {
        startDist: getDistance(e.touches),
        startScale: scale,
      };
    } else if (e.touches.length === 1 && scale > 1) {
      panRef.current = {
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        startTranslateX: translate.x,
        startTranslateY: translate.y,
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
      setTranslate({
        x: panRef.current.startTranslateX + dx,
        y: panRef.current.startTranslateY + dy,
      });
    }
  }

  function handleTouchEnd() {
    if (scale < 1) setScale(1);
  }

  /* 鼠标滚轮缩放 */
  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale((s) => Math.max(1, Math.min(5, s * delta)));
  }

  /* 双击重置 */
  function handleDoubleClick() {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <img
        ref={imgRef}
        src={src}
        alt=""
        className="max-w-[90vw] max-h-[90vh] object-contain rounded shadow-lg select-none"
        style={{
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
          transition: scale === 1 ? "transform 0.2s ease" : "none",
        }}
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        draggable={false}
      />
      {/* 缩放提示 */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/70 text-xs flex items-center gap-3">
        <span>双击重置</span>
        <span>滚轮/双指缩放</span>
        <span>{Math.round(scale * 100)}%</span>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl leading-none"
      >
        ✕
      </button>
    </div>
  );
}

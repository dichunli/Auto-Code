"use client";

import { useEffect, useRef, useState } from "react";

export interface ImageViewerProps {
  src: string;
  onClose: () => void;
  /* 画廊模式（可选） */
  images?: string[];
  currentIndex?: number;
  onIndexChange?: (index: number) => void;
  /* 删除（可选） */
  onDelete?: (index: number) => void;
}

export function ImageViewer({
  src,
  onClose,
  images,
  currentIndex,
  onIndexChange,
  onDelete,
}: ImageViewerProps) {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const pinchRef = useRef({ startDist: 0, startScale: 1 });
  const panRef = useRef({ startX: 0, startY: 0, startTx: 0, startTy: 0 });
  const swipeRef = useRef({ startX: 0, startY: 0 });

  const isGallery = images && currentIndex !== undefined && onIndexChange;
  const total = images?.length || 1;
  const index = currentIndex || 0;
  const canNavigate = isGallery && total > 1;

  /* 重置缩放和平移（切换图片时调用） */
  function resetZoom() {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }

  /* 翻到上一张 */
  function goPrev() {
    if (!canNavigate || !onIndexChange) return;
    onIndexChange(index > 0 ? index - 1 : total - 1);
    resetZoom();
  }

  /* 翻到下一张 */
  function goNext() {
    if (!canNavigate || !onIndexChange) return;
    onIndexChange(index < total - 1 ? index + 1 : 0);
    resetZoom();
  }

  /* 键盘事件 */
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (canNavigate) {
        if (e.key === "ArrowLeft") goPrev();
        if (e.key === "ArrowRight") goNext();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, canNavigate, index]);

  /* ========== 触摸手势 ========== */

  function getDistance(touches: TouchList) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      /* 双指缩放 */
      pinchRef.current = {
        startDist: getDistance(e.touches as unknown as TouchList),
        startScale: scale,
      };
    } else if (e.touches.length === 1) {
      if (scale > 1) {
        /* 单指拖动 */
        panRef.current = {
          startX: e.touches[0].clientX,
          startY: e.touches[0].clientY,
          startTx: translate.x,
          startTy: translate.y,
        };
      } else {
        /* 记录滑动起点（用于翻页） */
        swipeRef.current = {
          startX: e.touches[0].clientX,
          startY: e.touches[0].clientY,
        };
      }
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dist = getDistance(e.touches as unknown as TouchList);
      if (pinchRef.current.startDist > 0) {
        const ratio = dist / pinchRef.current.startDist;
        setScale(Math.max(1, Math.min(5, pinchRef.current.startScale * ratio)));
      }
    } else if (e.touches.length === 1 && scale > 1) {
      e.preventDefault();
      const dx = e.touches[0].clientX - panRef.current.startX;
      const dy = e.touches[0].clientY - panRef.current.startY;
      setTranslate({
        x: panRef.current.startTx + dx,
        y: panRef.current.startTy + dy,
      });
    }
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (scale < 1) resetZoom();

    /* 滑动翻页：只有 scale === 1 且是画廊模式才触发 */
    if (canNavigate && scale === 1 && swipeRef.current.startX > 0) {
      const endX = e.changedTouches[0]?.clientX || 0;
      const endY = e.changedTouches[0]?.clientY || 0;
      const dx = endX - swipeRef.current.startX;
      const dy = endY - swipeRef.current.startY;

      /* 水平滑动超过 50px 且不是纵向滑动 */
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        if (dx > 0) goPrev();
        else goNext();
      }
    }
  }

  /* ========== 鼠标操作 ========== */

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale((s) => Math.max(1, Math.min(5, s * delta)));
  }

  function handleDoubleClick() {
    resetZoom();
  }

  /* ========== 删除操作 ========== */

  function handleDelete() {
    if (!onDelete) return;
    if (confirm("确定要删除这张图片吗？")) {
      onDelete(index);
      /* 如果删除后没有图片了，关闭查看器 */
      if (total <= 1 && onClose) onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* 图片 */}
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
        className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl leading-none z-10 w-11 h-11 flex items-center justify-center"
      >
        ✕
      </button>

      {/* 上一张按钮（画廊模式 + 桌面端） */}
      {canNavigate && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); goPrev(); }}
          className="absolute left-2 top-1/2 -translate-y-1/2 hidden md:flex items-center justify-center w-11 h-11 rounded-full bg-white/10 text-white hover:bg-white/25 text-xl z-10"
        >
          ‹
        </button>
      )}

      {/* 下一张按钮（画廊模式 + 桌面端） */}
      {canNavigate && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); goNext(); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 hidden md:flex items-center justify-center w-11 h-11 rounded-full bg-white/10 text-white hover:bg-white/25 text-xl z-10"
        >
          ›
        </button>
      )}

      {/* 底部操作栏 */}
      <div className="absolute bottom-4 left-0 right-0 flex justify-center items-center gap-3 z-10">
        {/* 上一张（移动端按钮） */}
        {canNavigate && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); goPrev(); }}
            className="md:hidden px-3 py-2 bg-white/20 text-white rounded hover:bg-white/30 text-sm min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            上一张
          </button>
        )}

        <span className="text-white/70 text-xs px-2">
          {isGallery ? `${index + 1} / ${total} · ` : ""}
          {Math.round(scale * 100)}% · 双击重置
        </span>

        {/* 下一张（移动端按钮） */}
        {canNavigate && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); goNext(); }}
            className="md:hidden px-3 py-2 bg-white/20 text-white rounded hover:bg-white/30 text-sm min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            下一张
          </button>
        )}

        {/* 删除按钮 */}
        {onDelete && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleDelete(); }}
            className="px-3 py-2 bg-red-500/70 text-white rounded hover:bg-red-600 text-sm min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            删除
          </button>
        )}
      </div>
    </div>
  );
}

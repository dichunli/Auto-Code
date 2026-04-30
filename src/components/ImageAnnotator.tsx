"use client";

import { useRef, useState, useEffect, useCallback } from "react";

interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface Props {
  imageUrl: string;
  annotations: Line[];
  onChange: (lines: Line[]) => void;
  width?: number;
  height?: number;
}

export function ImageAnnotator({ imageUrl, annotations, onChange, width = 400, height = 300 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [currentLine, setCurrentLine] = useState<Line | null>(null);
  const [imgSize, setImgSize] = useState({ width, height });

  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = new Image();
    img.src = imageUrl;
    img.onload = () => {
      imgRef.current = img;
      // 保持比例缩放到最大宽度400
      const maxW = 400;
      const scale = img.width > maxW ? maxW / img.width : 1;
      setImgSize({ width: img.width * scale, height: img.height * scale });
    };
  }, [imageUrl]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 画已保存的线条
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 2;
    annotations.forEach((line) => {
      ctx.beginPath();
      ctx.moveTo(line.x1 * canvas.width, line.y1 * canvas.height);
      ctx.lineTo(line.x2 * canvas.width, line.y2 * canvas.height);
      ctx.stroke();
    });

    // 画当前正在画的线
    if (currentLine) {
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(currentLine.x1 * canvas.width, currentLine.y1 * canvas.height);
      ctx.lineTo(currentLine.x2 * canvas.width, currentLine.y2 * canvas.height);
      ctx.stroke();
    }
  }, [annotations, currentLine]);

  useEffect(() => {
    draw();
  }, [draw, imgSize]);

  function getRelativePos(e: React.MouseEvent | React.TouchEvent): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    if ("touches" in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    };
  }

  function handleStart(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    const pos = getRelativePos(e);
    setDrawing(true);
    setStartPos(pos);
    setCurrentLine({ x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y });
  }

  function handleMove(e: React.MouseEvent | React.TouchEvent) {
    if (!drawing || !startPos) return;
    e.preventDefault();
    const pos = getRelativePos(e);
    setCurrentLine({ x1: startPos.x, y1: startPos.y, x2: pos.x, y2: pos.y });
  }

  function handleEnd(e: React.MouseEvent | React.TouchEvent) {
    if (!drawing || !startPos || !currentLine) return;
    e.preventDefault();
    setDrawing(false);
    // 只有长度大于阈值才保存
    const dx = currentLine.x2 - currentLine.x1;
    const dy = currentLine.y2 - currentLine.y1;
    if (Math.sqrt(dx * dx + dy * dy) > 0.01) {
      onChange([...annotations, currentLine]);
    }
    setStartPos(null);
    setCurrentLine(null);
  }

  function undo() {
    onChange(annotations.slice(0, -1));
  }

  function clearAll() {
    onChange([]);
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <div className="relative" style={{ width: imgSize.width, height: imgSize.height }}>
        <img
          src={imageUrl}
          alt="annotatable"
          className="absolute inset-0 w-full h-full object-contain select-none"
          draggable={false}
        />
        <canvas
          ref={canvasRef}
          width={imgSize.width}
          height={imgSize.height}
          className="absolute inset-0 cursor-crosshair"
          onMouseDown={handleStart}
          onMouseMove={handleMove}
          onMouseUp={handleEnd}
          onMouseLeave={handleEnd}
          onTouchStart={handleStart}
          onTouchMove={handleMove}
          onTouchEnd={handleEnd}
        />
      </div>
      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          onClick={undo}
          disabled={annotations.length === 0}
          className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded border border-gray-300 hover:bg-gray-200 disabled:opacity-40"
        >
          撤销
        </button>
        <button
          type="button"
          onClick={clearAll}
          disabled={annotations.length === 0}
          className="px-3 py-1 text-xs bg-red-50 text-red-600 rounded border border-red-200 hover:bg-red-100 disabled:opacity-40"
        >
          清除标记
        </button>
        <span className="text-xs text-gray-400">已标记 {annotations.length} 条线</span>
      </div>
    </div>
  );
}

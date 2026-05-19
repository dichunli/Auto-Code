"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface OilLevelGaugeProps {
  value: number;
  onChange: (value: number) => void;
  label?: string;
}

export default function OilLevelGauge({ value, onChange, label }: OilLevelGaugeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverValue, setHoverValue] = useState<number | null>(null);

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const getValueFromEvent = useCallback(
    (clientY: number) => {
      const el = containerRef.current;
      if (!el) return value;
      const rect = el.getBoundingClientRect();
      const trackHeight = rect.height - 32; /* 上下 padding */
      const relativeY = clientY - rect.top - 16;
      const ratio = clamp(1 - relativeY / trackHeight, 0, 1);
      return Math.round(ratio * 100);
    },
    [value]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      setIsDragging(true);
      const v = getValueFromEvent(e.clientY);
      onChange(v);
    },
    [getValueFromEvent, onChange]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const v = getValueFromEvent(e.clientY);
      setHoverValue(v);
      if (isDragging) {
        onChange(v);
      }
    },
    [getValueFromEvent, onChange, isDragging]
  );

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
    setHoverValue(null);
  }, []);

  /* 触摸设备防止页面滚动 */
  useEffect(() => {
    if (!isDragging) return;
    const preventScroll = (e: TouchEvent) => e.preventDefault();
    document.addEventListener("touchmove", preventScroll, { passive: false });
    return () => document.removeEventListener("touchmove", preventScroll);
  }, [isDragging]);

  const displayValue = isDragging && hoverValue !== null ? hoverValue : value;
  const indicatorTop = `${(1 - clamp(value, 0, 100) / 100) * 100}%`;

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      {label && <span className="text-xs text-gray-500">{label}</span>}
      <div className="flex items-center gap-3">
        {/* 左侧刻度标签 */}
        <div className="flex flex-col justify-between h-[200px] text-[10px] text-gray-400 text-right leading-none py-2">
          <span>100</span>
          <span>75</span>
          <span>50</span>
          <span>25</span>
          <span>0</span>
        </div>

        {/* 标尺主体 */}
        <div
          ref={containerRef}
          className="relative w-10 h-[200px] bg-gray-100 rounded-lg border border-gray-300 cursor-pointer touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {/* 背景区域色块 */}
          <div className="absolute inset-x-1 top-1 bottom-1 rounded">
            {/* 低油位区（红色）0-25 */}
            <div className="absolute bottom-0 left-0 right-0 h-[25%] bg-red-50 rounded-b" />
            {/* 正常区（绿色）25-75 */}
            <div className="absolute bottom-[25%] left-0 right-0 h-[50%] bg-green-50" />
            {/* 高油位区（黄色）75-100 */}
            <div className="absolute top-0 left-0 right-0 h-[25%] bg-amber-50 rounded-t" />
          </div>

          {/* 横线刻度 */}
          {[0, 25, 50, 75, 100].map((tick) => (
            <div
              key={tick}
              className="absolute left-1 right-1 h-px bg-gray-300"
              style={{ bottom: `${tick}%` }}
            />
          ))}

          {/* MIN / MAX 标记 */}
          <div className="absolute right-0 bottom-[20%] text-[9px] text-red-500 font-medium pr-0.5">MIN</div>
          <div className="absolute right-0 bottom-[80%] text-[9px] text-amber-600 font-medium pr-0.5">MAX</div>

          {/* 可拖动指示器 */}
          <div
            className={`absolute left-0 right-0 flex items-center justify-center transition-transform ${
              isDragging ? "scale-110" : ""
            }`}
            style={{
              top: `calc(${indicatorTop} - 8px)`,
            }}
          >
            <div
              className={`w-8 h-4 rounded flex items-center justify-center text-[10px] font-bold text-white shadow cursor-grab active:cursor-grabbing ${
                value < 25
                  ? "bg-red-500"
                  : value > 80
                  ? "bg-amber-500"
                  : "bg-green-500"
              }`}
            >
              <div className="w-0 h-0 border-l-[3px] border-r-[3px] border-t-[3px] border-l-transparent border-r-transparent border-t-white/80" />
            </div>
          </div>
        </div>

        {/* 右侧状态说明 */}
        <div className="flex flex-col justify-center gap-1 text-[10px] text-gray-400 w-12">
          <span className={value < 25 ? "text-red-500 font-medium" : ""}>偏低</span>
          <span className={value >= 25 && value <= 80 ? "text-green-600 font-medium" : ""}>正常</span>
          <span className={value > 80 ? "text-amber-600 font-medium" : ""}>偏高</span>
        </div>
      </div>

      {/* 当前数值 */}
      <div className="text-sm font-semibold text-gray-700">
        {displayValue}%
      </div>
    </div>
  );
}

"use client";

import { useState, useRef } from "react";

/* ═════════════════════════════════════════════════════════════════
 * 懒加载视频播放器
 *
 * 初始只渲染"封面 + 播放按钮"（有 poster 图则用，没有则深色占位），
 * 不加载任何视频数据；用户点击后才创建 <video> 拉流播放。
 * 视频多的页面（工单详情等）首屏不再被视频拖慢。
 * 附带：倍速切换（0.5/1/2x）和下载按钮。
 * ═════════════════════════════════════════════════════════════════ */

interface Props {
  src: string;
  className?: string;
}

const 倍速档 = [0.5, 1, 2];

export default function LazyVideo({ src, className = "" }: Props) {
  const [已激活, set已激活] = useState(false);
  const [封面加载失败, set封面加载失败] = useState(false);
  const [倍速索引, set倍速索引] = useState(1);
  const videoRef = useRef<HTMLVideoElement>(null);

  /* 封面图约定：<视频URL>.poster.jpg（上传后由 ffmpeg 自动生成；没有则深色占位） */
  const posterUrl = `${src}.poster.jpg`;

  function 切换倍速() {
    const 下一档 = (倍速索引 + 1) % 倍速档.length;
    set倍速索引(下一档);
    if (videoRef.current) videoRef.current.playbackRate = 倍速档[下一档];
  }

  if (!已激活) {
    return (
      <button
        type="button"
        onClick={() => set已激活(true)}
        className={`relative overflow-hidden bg-gray-900 flex items-center justify-center group ${className}`}
        title="点击播放视频"
      >
        {!封面加载失败 && (
           
          <img
            src={posterUrl}
            alt=""
            loading="lazy"
            onError={() => set封面加载失败(true)}
            className="absolute inset-0 w-full h-full object-cover opacity-80"
          />
        )}
        <span className="relative z-10 flex items-center justify-center w-10 h-10 rounded-full bg-white/90 text-gray-800 group-hover:scale-110 transition-transform">
          <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      </button>
    );
  }

  return (
    <div className={`relative overflow-hidden bg-black ${className}`}>
      <video
        ref={videoRef}
        src={src}
        className="w-full h-full object-cover"
        controls
        autoPlay
        preload="metadata"
      />
      {/* 倍速 + 下载（右上角小工具条） */}
      <div className="absolute top-1 right-1 flex items-center gap-1 z-10">
        <button
          type="button"
          onClick={切换倍速}
          className="px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] hover:bg-black/80"
          title="切换播放速度"
        >
          {倍速档[倍速索引]}x
        </button>
        <a
          href={src}
          download
          className="px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] hover:bg-black/80"
          title="下载视频"
          onClick={(e) => e.stopPropagation()}
        >
          下载
        </a>
      </div>
    </div>
  );
}

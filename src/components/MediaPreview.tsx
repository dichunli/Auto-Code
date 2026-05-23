"use client";

import { useState } from "react";

interface MediaItem {
  id: string;
  media_type: "image" | "video" | "audio";
  storage_path: string;
}

interface Props {
  media: MediaItem[];
}

export default function MediaPreview({ media }: Props) {
  const [preview, setPreview] = useState<{ type: string; src: string } | null>(null);

  if (!media || media.length === 0) return null;

  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {media.map((m) => {
          if (m.media_type === "image") {
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setPreview({ type: "image", src: m.storage_path })}
                className="relative w-16 h-16 rounded border border-gray-200 overflow-hidden hover:opacity-80 transition-opacity"
              >
                <img src={m.storage_path} alt="" className="w-full h-full object-cover" loading="lazy" />
              </button>
            );
          }
          if (m.media_type === "video") {
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setPreview({ type: "video", src: m.storage_path })}
                className="relative w-20 h-16 rounded border border-gray-200 overflow-hidden bg-gray-900 hover:opacity-80 transition-opacity flex items-center justify-center"
              >
                <video src={m.storage_path} className="w-full h-full object-cover" preload="metadata" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-6 h-6 rounded-full bg-black/50 flex items-center justify-center">
                    <svg className="w-3 h-3 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </div>
              </button>
            );
          }
          if (m.media_type === "audio") {
            return (
              <div key={m.id} className="w-full max-w-[200px]">
                <audio src={m.storage_path} controls className="w-full h-8" />
              </div>
            );
          }
          return null;
        })}
      </div>

      {/* 预览弹窗 */}
      {preview && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreview(null)}
        >
          <button
            type="button"
            onClick={() => setPreview(null)}
            className="absolute top-4 right-4 text-white text-2xl hover:text-gray-300"
          >
            ✕
          </button>
          {preview.type === "image" ? (
            <img
              src={preview.src}
              alt=""
              className="max-w-full max-h-[90vh] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <video
              src={preview.src}
              controls
              autoPlay
              className="max-w-full max-h-[90vh] rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}
    </>
  );
}

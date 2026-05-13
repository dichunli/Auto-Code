"use client";

import { useState } from "react";
import { ImageViewer } from "./ImageViewer";

interface Props {
  images: { id: string; storage_path: string }[];
}

function resolveUrl(path: string): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return path;
  return `${base}/storage/v1/object/public/work-order-media/${path}`;
}

export function PartBranchImages({ images }: Props) {
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);

  if (!images || images.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap gap-1">
        {images.map((m) => {
          const src = resolveUrl(m.storage_path);
          if (!src) return null;
          return (
            <img
              key={m.id}
              src={src}
              alt=""
              className="w-10 h-10 object-cover rounded border border-gray-100 cursor-pointer"
              onClick={() => setViewerSrc(src)}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          );
        })}
      </div>
      {viewerSrc && <ImageViewer src={viewerSrc} onClose={() => setViewerSrc(null)} />}
    </>
  );
}

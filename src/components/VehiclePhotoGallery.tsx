"use client";

import { useState } from "react";
import { ImageViewer } from "./ImageViewer";

interface VehiclePhoto {
  category: string;
  url: string;
}

interface Props {
  photos: VehiclePhoto[];
  emptyText?: string;
}

const categoryLabelMap: Record<string, string> = {
  exterior: "外观",
  nameplate: "厂牌",
  license_front: "行驶证正本",
  license_back: "行驶证副本",
};

export function VehiclePhotoGallery({ photos, emptyText = "暂无车辆照片" }: Props) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  if (photos.length === 0) {
    return <p className="text-sm text-gray-400">{emptyText}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {photos.map((photo, index) => (
          <button
            key={`${photo.category}-${index}`}
            type="button"
            onClick={() => setPreviewIndex(index)}
            className="relative w-20 h-20 rounded-lg border border-gray-200 overflow-hidden bg-gray-100 hover:border-blue-400 transition-colors"
          >
            <img
              src={photo.url}
              alt={categoryLabelMap[photo.category] || photo.category}
              className="w-full h-full object-cover"
              loading="lazy"
            />
            <span className="absolute bottom-0 left-0 right-0 text-[10px] text-white bg-black/50 text-center truncate px-1">
              {categoryLabelMap[photo.category] || photo.category}
            </span>
          </button>
        ))}
      </div>

      {previewIndex !== null && (
        <ImageViewer
          src={photos[previewIndex].url}
          images={photos.map((p) => p.url)}
          currentIndex={previewIndex}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </div>
  );
}

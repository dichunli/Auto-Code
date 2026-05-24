"use client";

import { ImageUploader } from "@/components/ImageUploader";

interface NotesImagesSectionProps {
  notes: string;
  onNotesChange: (value: string) => void;
  partImages: string[];
  onImagesChange: (images: string[]) => void;
}

export default function NotesImagesSection({
  notes,
  onNotesChange,
  partImages,
  onImagesChange,
}: NotesImagesSectionProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
        <textarea
          rows={2}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
        />
      </div>

      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">配件图片</label>
        <ImageUploader
          onUpload={(paths) => onImagesChange(paths)}
          existingImages={partImages}
          maxImages={5}
          bucket="work-order-media"
          folder="part-images"
        />
      </div>
    </div>
  );
}

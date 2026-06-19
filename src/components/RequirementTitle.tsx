"use client";

import { useState } from "react";
import RequirementBatchModal from "./RequirementBatchModal";

interface Profile {
  id: string;
  full_name?: string | null;
}

interface Requirement {
  id: string;
  seq: number;
  description?: string | null;
}

interface MediaItem {
  id?: string;
  media_type: "image" | "video" | "audio";
  storage_path: string;
}

interface Props {
  req: Requirement;
  orderId: string;
  profiles: Profile[];
  media: MediaItem[];
  /* 该需求下挂的维修项目数量：>0 时不允许删除该需求 */
  项目数?: number;
}

function MediaTypeIcon({ type }: { type: string }) {
  if (type === "image") {
    return (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    );
  }
  if (type === "video") {
    return (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    );
  }
  if (type === "audio") {
    return (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
      </svg>
    );
  }
  return null;
}

export default function RequirementTitle({ req, orderId, profiles, media, 项目数 = 0 }: Props) {
  const [open, setOpen] = useState(false);
  const hasImage = media.some((m) => m.media_type === "image");
  const hasVideo = media.some((m) => m.media_type === "video");
  const hasAudio = media.some((m) => m.media_type === "audio");

  return (
    <>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-left text-sm text-gray-900 hover:text-blue-600 transition-colors"
        >
          <span className="text-blue-600 mr-1">需求{req.seq}</span>
          <span className="font-medium">{req.description}</span>
        </button>
        {(hasImage || hasVideo || hasAudio) && (
          <span className="hidden md:inline-flex items-center gap-0.5 text-gray-400 ml-1">
            {hasImage && <MediaTypeIcon type="image" />}
            {hasVideo && <MediaTypeIcon type="video" />}
            {hasAudio && <MediaTypeIcon type="audio" />}
          </span>
        )}
      </div>
      <RequirementBatchModal
        open={open}
        onClose={() => setOpen(false)}
        orderId={orderId}
        requirement={req}
        initialMedia={media || []}
        profiles={profiles}
        项目数={项目数}
      />
    </>
  );
}

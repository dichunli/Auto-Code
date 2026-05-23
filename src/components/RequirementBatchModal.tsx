"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ImageUploader } from "@/components/ImageUploader";
import { VideoUploader } from "@/components/VideoUploader";

interface MediaItem {
  id?: string;
  media_type: "image" | "video" | "audio";
  storage_path: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  orderId: string;
  requirement?: any; // 编辑模式时传入
  initialMedia?: MediaItem[]; // 编辑模式时传入现有媒体
}

/* 语音录制小组件 - 按住录音模式 */
function AudioRecorder({
  existingAudios,
  onUpload,
}: {
  existingAudios: string[];
  onUpload: (paths: string[]) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [recordTime, setRecordTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [uploading, setUploading] = useState(false);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (chunksRef.current.length === 0) return;
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await uploadAudio(blob);
      };

      mediaRecorder.start();
      setRecording(true);
      setRecordTime(0);
      timerRef.current = setInterval(() => {
        setRecordTime((t) => t + 1);
      }, 1000);
    } catch {
      alert("无法访问麦克风，请检查权限设置");
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }, []);

  async function uploadAudio(blob: Blob) {
    setUploading(true);
    try {
      const file = new File([blob], `${Date.now()}_${Math.random().toString(36).slice(2)}.webm`, {
        type: "audio/webm",
      });
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "上传失败");

      onUpload([...existingAudios, result.path]);
    } catch (err: any) {
      alert("语音上传失败: " + err.message);
    } finally {
      setUploading(false);
    }
  }

  function removeAudio(index: number) {
    onUpload(existingAudios.filter((_, i) => i !== index));
  }

  function formatTime(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  // 按住录音的事件处理
  function handlePointerDown(e: React.PointerEvent) {
    e.preventDefault();
    startRecording();
  }

  function handlePointerUp(e: React.PointerEvent) {
    e.preventDefault();
    stopRecording();
  }

  function handlePointerLeave(e: React.PointerEvent) {
    if (recording) {
      e.preventDefault();
      stopRecording();
    }
  }

  return (
    <div className="space-y-2">
      {existingAudios.length > 0 && (
        <div className="space-y-1">
          {existingAudios.map((src, i) => (
            <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
              <audio src={src} controls className="flex-1 h-8" />
              <button type="button" onClick={() => removeAudio(i)} className="text-xs text-red-500 hover:text-red-600">
                删除
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 md:hidden">
        {recording ? (
          <button
            type="button"
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerLeave}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-red-500 rounded-lg hover:bg-red-600 select-none touch-none active:scale-95 transition-transform"
            style={{ touchAction: "none", userSelect: "none" }}
          >
            <span className="w-2.5 h-2.5 bg-white rounded-sm animate-pulse" />
            松开结束 {formatTime(recordTime)}
          </button>
        ) : (
          <button
            type="button"
            onPointerDown={handlePointerDown}
            disabled={uploading}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 select-none touch-none active:scale-95 transition-transform"
            style={{ touchAction: "none", userSelect: "none" }}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
            {uploading ? "上传中..." : "按住录音"}
          </button>
        )}
      </div>
      <p className="text-[10px] text-gray-400 md:hidden">按住按钮开始录音，松开后自动上传</p>
    </div>
  );
}

export default function RequirementBatchModal({ open, onClose, orderId, requirement, initialMedia = [] }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = !!requirement;

  const [description, setDescription] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [remarks, setRemarks] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [videos, setVideos] = useState<string[]>([]);
  const [audios, setAudios] = useState<string[]>([]);
  const [deletedMediaIds, setDeletedMediaIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initialized = useRef(false);

  // 编辑模式时初始化数据（仅在弹窗首次打开时执行，防止外部数组引用变化导致反复重置）
  useEffect(() => {
    if (open && !initialized.current) {
      initialized.current = true;
      if (isEdit) {
        setDescription(requirement.description || "");
        setDiagnosis(requirement.diagnosis || "");
        setRemarks(requirement.remarks || "");
        setImages(initialMedia.filter((m) => m.media_type === "image").map((m) => m.storage_path));
        setVideos(initialMedia.filter((m) => m.media_type === "video").map((m) => m.storage_path));
        setAudios(initialMedia.filter((m) => m.media_type === "audio").map((m) => m.storage_path));
        setDeletedMediaIds([]);
      } else {
        reset();
      }
    }
    if (!open) {
      initialized.current = false;
    }
  }, [open, isEdit, requirement, initialMedia]);

  function reset() {
    setDescription("");
    setDiagnosis("");
    setRemarks("");
    setImages([]);
    setVideos([]);
    setAudios([]);
    setDeletedMediaIds([]);
  }

  async function handleSubmit() {
    if (!description.trim() && images.length === 0 && videos.length === 0 && audios.length === 0) {
      alert("请至少填写客户需求描述或上传媒体文件");
      return;
    }

    const { data: authData } = await supabase.auth.getUser();
    const currentUserId = authData.user?.id || null;

    setSaving(true);
    try {
      if (isEdit) {
        // 编辑模式：更新需求
        const { error: updateError } = await supabase
          .from("work_order_requirements")
          .update({
            description: description.trim(),
            diagnosis: diagnosis.trim() || null,
            remarks: remarks.trim() || null,
          })
          .eq("id", requirement.id);

        if (updateError) throw updateError;

        // 删除被标记删除的媒体
        if (deletedMediaIds.length > 0) {
          const { error: delError } = await supabase
            .from("work_order_requirement_media")
            .delete()
            .in("id", deletedMediaIds);
          if (delError) throw delError;
        }
      } else {
        // 新增模式
        const { data: existing } = await supabase
          .from("work_order_requirements")
          .select("seq")
          .eq("work_order_id", orderId)
          .order("seq", { ascending: false })
          .limit(1);
        const nextSeq = (existing && existing[0]?.seq ? existing[0].seq : 0) + 1;

        const { data: req, error: reqError } = await supabase
          .from("work_order_requirements")
          .insert({
            work_order_id: orderId,
            seq: nextSeq,
            description: description.trim(),
            submitted_by: currentUserId,
          })
          .select("id")
          .single();

        if (reqError || !req) throw reqError || new Error("创建需求失败");
        requirement = { id: req.id };
      }

      // 插入新媒体
      const mediaRecords = [
        ...images
          .filter((path) => !initialMedia.some((m) => m.media_type === "image" && m.storage_path === path))
          .map((path) => ({
            requirement_id: requirement.id,
            media_type: "image" as const,
            storage_path: path,
          })),
        ...videos
          .filter((path) => !initialMedia.some((m) => m.media_type === "video" && m.storage_path === path))
          .map((path) => ({
            requirement_id: requirement.id,
            media_type: "video" as const,
            storage_path: path,
          })),
        ...audios
          .filter((path) => !initialMedia.some((m) => m.media_type === "audio" && m.storage_path === path))
          .map((path) => ({
            requirement_id: requirement.id,
            media_type: "audio" as const,
            storage_path: path,
          })),
      ];
      if (mediaRecords.length > 0) {
        const { error: mediaError } = await supabase
          .from("work_order_requirement_media")
          .insert(mediaRecords);
        if (mediaError) throw mediaError;
      }

      reset();
      onClose();
      router.refresh();
    } catch (err: any) {
      alert("保存失败: " + (err.message || err));
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    if (saving) return;
    reset();
    onClose();
  }

  // 移动端键盘弹出时，自动滚动到textarea
  function handleTextareaFocus() {
    setTimeout(() => {
      textareaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 300);
  }

  // 移除媒体时记录已删除的ID（编辑模式）
  function handleRemoveImage(index: number) {
    const path = images[index];
    const mediaItem = initialMedia.find((m) => m.media_type === "image" && m.storage_path === path);
    if (mediaItem?.id) setDeletedMediaIds((prev) => [...prev, mediaItem.id!]);
    const next = images.filter((_, i) => i !== index);
    setImages(next);
  }

  function handleRemoveVideo(index: number) {
    const path = videos[index];
    const mediaItem = initialMedia.find((m) => m.media_type === "video" && m.storage_path === path);
    if (mediaItem?.id) setDeletedMediaIds((prev) => [...prev, mediaItem.id!]);
    const next = videos.filter((_, i) => i !== index);
    setVideos(next);
  }

  function handleRemoveAudio(index: number) {
    const path = audios[index];
    const mediaItem = initialMedia.find((m) => m.media_type === "audio" && m.storage_path === path);
    if (mediaItem?.id) setDeletedMediaIds((prev) => [...prev, mediaItem.id!]);
    const next = audios.filter((_, i) => i !== index);
    setAudios(next);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50">
      <div className="bg-white rounded-t-xl md:rounded-xl shadow-xl w-full md:max-w-lg md:max-h-[90vh] flex flex-col" style={{ maxHeight: "calc(100vh - env(safe-area-inset-top))" }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">{isEdit ? "编辑客户需求" : "添加客户需求"}</h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <textarea
            ref={textareaRef}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onFocus={handleTextareaFocus}
            rows={3}
            placeholder="请输入客户需求，例如：刹车异响、需要保养..."
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none mb-3"
            inputMode="text"
          />

          {isEdit && (
            <>
              <textarea
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                rows={2}
                placeholder="诊断结果（可选）"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none mb-3"
              />
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={2}
                placeholder="备注（可选）"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none mb-3"
              />
            </>
          )}

          <div className="mb-4">
            <div className="text-xs text-gray-500 mb-1">语音描述</div>
            <AudioRecorder existingAudios={audios} onUpload={setAudios} />
          </div>

          <div className="space-y-4">
            <div>
              <div className="text-xs text-gray-500 mb-1">需求图片</div>
              <ImageUploader existingImages={images} onUpload={setImages} maxImages={5} />
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">需求视频</div>
              <VideoUploader existingVideos={videos} onUpload={setVideos} maxVideos={3} />
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-end gap-2">
          {isEdit && (
            <button
              type="button"
              onClick={async () => {
                if (!confirm("确定要删除这条需求吗？关联的媒体文件也会被删除。")) return;
                const { error } = await supabase
                  .from("work_order_requirements")
                  .delete()
                  .eq("id", requirement.id);
                if (error) {
                  alert("删除失败: " + error.message);
                } else {
                  onClose();
                  router.refresh();
                }
              }}
              className="mr-auto px-4 py-2 text-sm font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50"
            >
              删除
            </button>
          )}
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

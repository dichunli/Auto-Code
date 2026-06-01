"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

interface 员工 {
  id: string;
  full_name: string;
}

interface 行为项目 {
  id: string;
  name: string;
  score_type: string;
  score_value: number;
}

interface 打分记录 {
  id: string;
  employee_name: string;
  item_name: string;
  score_type: string;
  score: number;
  notes: string | null;
  scored_at: string;
  event_time: string;
  media_urls: string[];
}

/* 给图片添加时间水印 */
async function addWatermarkToBlob(blob: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("无法创建画布"));
        return;
      }

      ctx.drawImage(img, 0, 0);

      const now = new Date();
      const timeText = now.toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      ctx.font = `${Math.max(16, Math.floor(img.width / 30))}px sans-serif`;
      const metrics = ctx.measureText(timeText);
      const padding = Math.max(10, Math.floor(img.width / 60));
      const bgX = img.width - metrics.width - padding * 2;
      const bgY = img.height - Math.max(30, Math.floor(img.height / 20)) - padding;
      const bgW = metrics.width + padding * 2;
      const bgH = Math.max(30, Math.floor(img.height / 20)) + padding;

      ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
      ctx.fillRect(bgX, bgY, bgW, bgH);

      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "middle";
      ctx.fillText(timeText, bgX + padding, bgY + bgH / 2);

      URL.revokeObjectURL(url);

      canvas.toBlob((newBlob) => {
        if (newBlob) resolve(newBlob);
        else reject(new Error("水印处理失败"));
      }, "image/jpeg", 0.9);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片加载失败"));
    };
    img.src = url;
  });
}

export default function BehaviorScorePage() {
  const supabase = createClient();
  const [employees, setEmployees] = useState<员工[]>([]);
  const [items, setItems] = useState<行为项目[]>([]);
  const [records, setRecords] = useState<打分记录[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  /* 表单 */
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [selectedItem, setSelectedItem] = useState("");
  const [actualScore, setActualScore] = useState("");
  const [notes, setNotes] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [mediaFiles, setMediaFiles] = useState<{ blob: Blob; preview: string }[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);

  /* 摄像头拍照 */
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  async function fetchData() {
    setLoading(true);
    const [{ data: empData }, { data: itemData }] = await Promise.all([
      supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
      supabase.from("behavior_score_items").select("id, name, score_type, score_value").eq("is_active", true).order("name"),
    ]);
    setEmployees((empData as 员工[] | null) || []);
    setItems((itemData as 行为项目[] | null) || []);

    const { data: recordData } = await supabase
      .from("behavior_score_records")
      .select("id, score, notes, scored_at, event_time, media_urls, profiles!behavior_score_records_employee_id_fkey(full_name), behavior_score_items(name, score_type)")
      .order("scored_at", { ascending: false })
      .limit(30);

    setRecords(
      (recordData || []).map((r: unknown) => {
        const rec = r as {
          id: string;
          score: number;
          notes: string | null;
          scored_at: string;
          event_time: string;
          media_urls: string[] | null;
          profiles: { full_name: string }[] | { full_name: string } | null;
          behavior_score_items: { name: string; score_type: string }[] | { name: string; score_type: string } | null;
        };
        const profile = Array.isArray(rec.profiles) ? rec.profiles[0] : rec.profiles;
        const item = Array.isArray(rec.behavior_score_items) ? rec.behavior_score_items[0] : rec.behavior_score_items;
        return {
          id: rec.id,
          employee_name: profile?.full_name || "",
          item_name: item?.name || "",
          score_type: item?.score_type || "",
          score: rec.score,
          notes: rec.notes,
          scored_at: rec.scored_at,
          event_time: rec.event_time,
          media_urls: rec.media_urls || [],
        };
      })
    );

    setLoading(false);
  }

  useEffect(() => {
    fetchData();
  }, [supabase]);

  useEffect(() => {
    if (selectedItem) {
      const item = items.find((i) => i.id === selectedItem);
      if (item) {
        setActualScore(String(item.score_value));
      }
    }
  }, [selectedItem, items]);

  /* 摄像头拍照 */
  const openCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOpen(true);
    } catch (err: unknown) {
      alert("无法打开摄像头: " + (err instanceof Error ? err.message : "请检查摄像头权限"));
    }
  }, []);

  const closeCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
  }, []);

  const takePhoto = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);

    canvas.toBlob(async (blob) => {
      if (!blob) return;
      try {
        const watermarked = await addWatermarkToBlob(blob);
        const preview = URL.createObjectURL(watermarked);
        setMediaFiles((prev) => [...prev, { blob: watermarked, preview }]);
      } catch (err: unknown) {
        alert("水印处理失败: " + (err instanceof Error ? err.message : String(err)));
      }
      closeCamera();
    }, "image/jpeg", 0.9);
  }, [closeCamera]);

  /* 录视频 */
  const videoInputRef = useRef<HTMLInputElement>(null);

  async function handleVideoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      if (file.size > 100 * 1024 * 1024) {
        alert(`视频 ${file.name} 超过 100MB 限制`);
        continue;
      }
      const preview = URL.createObjectURL(file);
      setMediaFiles((prev) => [...prev, { blob: file, preview }]);
    }
    if (videoInputRef.current) videoInputRef.current.value = "";
  }

  function removeMedia(index: number) {
    setMediaFiles((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next;
    });
  }

  async function uploadMedia(files: { blob: Blob }[]): Promise<string[]> {
    const urls: string[] = [];
    for (const { blob } of files) {
      const ext = blob.type.startsWith("video/") ? "mp4" : "jpg";
      const fileName = `behavior/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from("media").upload(fileName, blob);
      if (error) throw error;
      const { data: urlData } = supabase.storage.from("media").getPublicUrl(fileName);
      urls.push(urlData.publicUrl);
    }
    return urls;
  }

  async function handleSubmit() {
    if (!selectedEmployee) {
      alert("请选择员工");
      return;
    }
    if (!selectedItem) {
      alert("请选择评分项目");
      return;
    }
    if (!actualScore || parseInt(actualScore) <= 0) {
      alert("请输入有效分数");
      return;
    }

    setSaving(true);
    try {
      const item = items.find((i) => i.id === selectedItem);
      const finalScore = item?.score_type === "penalty" ? -Math.abs(parseInt(actualScore)) : Math.abs(parseInt(actualScore));

      let mediaUrls: string[] = [];
      if (mediaFiles.length > 0) {
        mediaUrls = await uploadMedia(mediaFiles);
      }

      const { error } = await supabase.from("behavior_score_records").insert({
        employee_id: selectedEmployee,
        item_id: selectedItem,
        score: finalScore,
        notes: notes.trim() || null,
        event_time: eventTime ? new Date(eventTime).toISOString() : new Date().toISOString(),
        media_urls: mediaUrls.length > 0 ? mediaUrls : null,
      });

      if (error) throw error;

      setSelectedEmployee("");
      setSelectedItem("");
      setActualScore("");
      setNotes("");
      setEventTime("");
      setMediaFiles([]);

      fetchData();
      alert("打分成功");
    } catch (err: unknown) {
      alert("保存失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="行为规范打分" description="对员工进行日常行为考核打分" />

      {/* 打分表单 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
        <h3 className="text-base font-semibold text-gray-900 mb-4">新增打分</h3>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">员工 *</label>
              <select
                value={selectedEmployee}
                onChange={(e) => setSelectedEmployee(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="">请选择</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.full_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">评分项目 *</label>
              <select
                value={selectedItem}
                onChange={(e) => setSelectedItem(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="">请选择</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.score_type === "bonus" ? "+" : "-"}{i.score_value})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">实际分数 *</label>
              <input
                type="number"
                value={actualScore}
                onChange={(e) => setActualScore(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                placeholder="默认取项目分值，可修改"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">事件发生时间</label>
              <input
                type="datetime-local"
                value={eventTime}
                onChange={(e) => setEventTime(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="打分原因..."
            />
          </div>

          {/* 拍照/视频上传 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">附件（拍照自动加水印）</label>
            <div className="flex flex-wrap gap-2 mb-2">
              <button
                type="button"
                onClick={openCamera}
                className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
              >
                {uploadingMedia ? "处理中..." : "拍照"}
              </button>
              <label className="px-3 py-1.5 text-xs font-medium text-purple-600 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 cursor-pointer">
                录视频
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={handleVideoSelect}
                />
              </label>
            </div>

            {/* 已选媒体预览 */}
            {mediaFiles.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {mediaFiles.map((file, index) => (
                  <div key={index} className="relative w-20 h-20 rounded border border-gray-200 overflow-hidden bg-gray-100">
                    {file.blob.type.startsWith("image/") || file.blob.type === "" ? (
                      <img src={file.preview} alt="preview" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeMedia(index)}
                      className="absolute top-0.5 right-0.5 w-4 h-4 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSubmit}
              disabled={saving || uploadingMedia}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "保存中..." : "确认打分"}
            </button>
          </div>
        </div>
      </div>

      {/* 摄像头弹窗 */}
      {cameraOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-black rounded-xl overflow-hidden w-full max-w-md">
            <div className="relative aspect-[3/4] bg-black">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              <canvas ref={canvasRef} className="hidden" />
            </div>
            <div className="flex items-center justify-center gap-4 p-4 bg-black">
              <button
                onClick={closeCamera}
                className="px-4 py-2 text-sm text-white bg-gray-600 rounded-lg hover:bg-gray-700"
              >
                取消
              </button>
              <button
                onClick={takePhoto}
                className="w-14 h-14 rounded-full border-4 border-white bg-white/20 hover:bg-white/30"
              />
              <span className="text-sm text-white">拍照</span>
            </div>
          </div>
        </div>
      )}

      {/* 历史记录 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-4">最近打分记录</h3>
        {loading ? (
          <div className="text-center text-gray-400 py-8">加载中...</div>
        ) : records.length === 0 ? (
          <div className="text-center text-gray-400 py-8">暂无记录</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">打分时间</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">事件时间</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">员工</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">项目</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">分数</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">备注</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">附件</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {records.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500">{new Date(r.scored_at).toLocaleDateString("zh-CN")}</td>
                    <td className="px-4 py-3 text-gray-500">{r.event_time ? new Date(r.event_time).toLocaleString("zh-CN") : "-"}</td>
                    <td className="px-4 py-3">{r.employee_name}</td>
                    <td className="px-4 py-3">{r.item_name}</td>
                    <td className="px-4 py-3">
                      <span className={r.score > 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                        {r.score > 0 ? "+" : ""}{r.score}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{r.notes || "-"}</td>
                    <td className="px-4 py-3">
                      {r.media_urls && r.media_urls.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {r.media_urls.map((url, i) => (
                            <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                              className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
                            >
                              {url.match(/\.(mp4|webm|mov)$/i) ? "视频" : "图片"}
                            </a>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

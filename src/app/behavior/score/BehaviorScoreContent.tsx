"use client";

import {useState, useEffect, useRef, useCallback, useMemo} from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { useUpload } from "@/hooks/useUpload";
import { 是Capacitor环境 } from "@/lib/capacitorEnv";
import { base64转Blob } from "@/lib/imageCompress";
import { 提交行为记分 } from "./actions";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";

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

export default function BehaviorScoreContent({
  initialEmployees,
  initialItems,
  initialRecords,
  initialCount,
}: {
  initialEmployees: 员工[];
  initialItems: 行为项目[];
  initialRecords: 打分记录[];
  initialCount: number;
}) {
  const supabase = useMemo(() => createClient(), []);
  /* 首屏数据由服务端传入；loading 用于打分后重查和翻页 */
  const [employees, setEmployees] = useState<员工[]>(initialEmployees);
  const [items, setItems] = useState<行为项目[]>(initialItems);
  const [records, setRecords] = useState<打分记录[]>(initialRecords);
  /* 分页状态：首屏数据由服务端给（第 1 页），打分后重查/翻页走 fetchData */
  const [total, setTotal] = useState(initialCount);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  /* 表单 */
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [selectedItem, setSelectedItem] = useState("");
  const [actualScore, setActualScore] = useState("");
  const [notes, setNotes] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [mediaFiles, setMediaFiles] = useState<{ blob: Blob; preview: string }[]>([]);

  const { 上传, 上传中: uploadingMedia } = useUpload({ mediaType: "auto" });

  /* 摄像头拍照 */
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  async function fetchData(目标页: number) {
    setLoading(true);
    const [{ data: empData }, { data: itemData }] = await Promise.all([
      supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
      supabase.from("behavior_score_items").select("id, name, score_type, score_value").eq("is_active", true).order("name"),
    ]);
    setEmployees((empData as 员工[] | null) || []);
    setItems((itemData as 行为项目[] | null) || []);

    const from = (目标页 - 1) * pageSize;
    const { data: recordData, count } = await supabase
      .from("behavior_score_records")
      .select("id, score, notes, scored_at, event_time, media_urls, profiles!behavior_score_records_employee_id_fkey(full_name), behavior_score_items(name, score_type)", { count: "exact" })
      .order("scored_at", { ascending: false })
      .range(from, from + pageSize - 1);

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
    setTotal(count || 0);
    setPage(目标页);

    setLoading(false);
  }

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
      const preview = URL.createObjectURL(blob);
      setMediaFiles((prev) => [...prev, { blob, preview }]);
      closeCamera();
    }, "image/jpeg", 0.9);
  }, [closeCamera]);

  /* APP环境：调用系统相机 */
  const handleAppCamera = useCallback(async () => {
    try {
      const photo = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Base64,
        source: CameraSource.Camera,
      });
      if (!photo.base64String) {
        alert("拍照未获取到图片");
        return;
      }
      const base64 = `data:image/jpeg;base64,${photo.base64String}`;
      const blob = base64转Blob(base64);
      const preview = URL.createObjectURL(blob);
      setMediaFiles((prev) => [...prev, { blob, preview }]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("cancel") || msg.includes("denied") || msg.includes("User denied")) return;
      alert("拍照失败: " + msg);
    }
  }, []);

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
      /* 释放被删除项的预览 URL */
      const removed = prev[index];
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return next;
    });
  }

  /* 组件卸载时释放所有预览 URL */
  useEffect(() => {
    return () => {
      mediaFiles.forEach((f) => URL.revokeObjectURL(f.preview));
    };
  }, []);

  async function uploadMedia(files: { blob: Blob }[]): Promise<string[]> {
    /* 将 Blob 转为 File 后通过 useUpload 上传 */
    const fileList: File[] = files.map(({ blob }) => {
      const ext = blob.type.startsWith("video/") ? "mp4" : "jpg";
      return new File([blob], `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`, { type: blob.type });
    });
    const { urls, errors } = await 上传(fileList);
    if (errors.length > 0) {
      throw new Error(errors.map((e) => e.error).join("; "));
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

      /* 写库走 Server Action（打分人取服务端登录用户） */
      const result = await 提交行为记分({
        employeeId: selectedEmployee,
        itemId: selectedItem,
        score: finalScore,
        notes,
        eventTime: eventTime ? new Date(eventTime).toISOString() : new Date().toISOString(),
        mediaUrls,
      });

      if (!result.success) throw new Error(result.error || "保存失败");

      setSelectedEmployee("");
      setSelectedItem("");
      setActualScore("");
      setNotes("");
      setEventTime("");
      setMediaFiles([]);

      /* 新记录按打分时间倒序在第 1 页，重查回第 1 页 */
      fetchData(1);
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
            <label className="block text-sm font-medium text-gray-700 mb-2">附件</label>
            <div className="flex flex-wrap gap-2 mb-2">
              <button
                type="button"
                onClick={是Capacitor环境() ? handleAppCamera : openCamera}
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

        {/* 分页导航：客户端翻页，只重查打分记录，不影响上方表单 */}
        {totalPages > 1 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-gray-500">
              共 {total} 条，第 {page}/{totalPages} 页
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchData(page - 1)}
                disabled={page <= 1 || loading}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                上一页
              </button>
              <button
                onClick={() => fetchData(page + 1)}
                disabled={page >= totalPages || loading}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

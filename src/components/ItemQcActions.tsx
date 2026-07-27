"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ImageUploader } from "./ImageUploader";
import { VideoUploader } from "./VideoUploader";

interface Props {
  itemId: string;
  itemName: string;
  requireQc?: boolean | null;
  实际锁定: boolean;
}

interface 质检单行 {
  id: string;
  result: string;
  notes: string | null;
  created_at: string;
  profiles?: { full_name?: string | null } | null;
  work_order_item_qc_media?: { media_type: string; storage_path: string }[] | null;
}

interface 项目行 {
  status: string | null;
  qc_status: string | null;
  require_qc: boolean | null;
  inspector_id: string | null;
}

interface Rpc结果 {
  success: boolean;
  error?: string;
}

/* 项目质检操作（质检单）：
 * - 仅"待质检"状态（完工+须质检+未检）且当前用户是质检人本人时显示"质检"按钮（用户拍板：仅本人可操作）
 * - 点开质检单：选合格/不合格（不合格必填原因）+ 备注 + 图片/视频凭证，提交走 submit_item_qc RPC
 * - 弹窗下半部分展示历史质检单（合格/不合格记录 + 媒体链接）
 * - 提交成功广播 wo-item-update：状态徽章立即刷新，工单级联动交给 Realtime */
export default function ItemQcActions({ itemId, itemName, requireQc, 实际锁定 }: Props) {
  const supabase = createClient();
  const [当前用户Id, set当前用户Id] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<"passed" | "failed">("passed");
  const [notes, setNotes] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [videos, setVideos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [历史, set历史] = useState<质检单行[]>([]);
  /* 可见性状态：初始按 props 算，监听事件后重查（计时/质检操作后自动刷新） */
  const [待质检, set待质检] = useState(false);
  const [本人质检, set本人质检] = useState(false);

  const 重查可见性 = useCallback(
    async (uid: string | null) => {
      const { data } = await supabase
        .from("work_order_items")
        .select("status, qc_status, require_qc, inspector_id")
        .eq("id", itemId)
        .single();
      const row = data as 项目行 | null;
      if (!row) return;
      set待质检(row.status === "completed" && !!row.require_qc && (row.qc_status || "none") === "none");
      set本人质检(!!uid && row.inspector_id === uid);
    },
    [itemId, supabase]
  );

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id || null;
      set当前用户Id(uid);
      重查可见性(uid);
    });
  }, [supabase, 重查可见性]);

  useEffect(() => {
    function handle(e: Event) {
      const detail = (e as CustomEvent).detail as { itemId?: string };
      if (detail?.itemId === itemId) 重查可见性(当前用户Id);
    }
    window.addEventListener("wo-item-update", handle as EventListener);
    return () => window.removeEventListener("wo-item-update", handle as EventListener);
  }, [itemId, 当前用户Id, 重查可见性]);

  /* 打开弹窗时加载历史质检单 */
  useEffect(() => {
    if (!open) return;
    setResult("passed");
    setNotes("");
    setImages([]);
    setVideos([]);
    supabase
      .from("work_order_item_qc_logs")
      .select("id, result, notes, created_at, profiles(full_name), work_order_item_qc_media(media_type, storage_path)")
      .eq("work_order_item_id", itemId)
      .order("created_at", { ascending: false })
      .then(({ data }) => set历史((data as unknown as 质检单行[]) || []));
  }, [open, itemId, supabase]);

  async function 提交质检() {
    if (result === "failed" && !notes.trim()) {
      alert("质检不合格必须填写原因");
      return;
    }
    setSaving(true);
    const media = [
      ...images.map((p) => ({ media_type: "image", storage_path: p })),
      ...videos.map((p) => ({ media_type: "video", storage_path: p })),
    ];
    const { data, error } = await supabase.rpc("submit_item_qc", {
      p_work_order_item_id: itemId,
      p_result: result,
      p_notes: notes.trim() || null,
      p_media: media,
    });
    setSaving(false);
    const res = data as Rpc结果 | null;
    if (error) {
      alert("质检提交失败: " + error.message);
      return;
    }
    if (!res?.success) {
      alert(res?.error || "质检提交失败");
      return;
    }
    setOpen(false);
    /* 广播：状态徽章/质检按钮立即刷新 */
    window.dispatchEvent(new CustomEvent("wo-item-update", { detail: { itemId } }));
  }

  /* 不须质检 / 已锁定 / 非待质检 / 非质检人本人 → 不渲染（待质检徽章由 ItemStageBadge 显示） */
  if (!requireQc || 实际锁定 || !待质检 || !本人质检) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs px-2 py-0.5 rounded bg-purple-600 text-white hover:bg-purple-700 shrink-0"
      >
        质检
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/50 flex items-end md:items-center justify-center z-50">
          <div className="bg-white rounded-t-xl md:rounded-xl shadow-2xl w-full md:max-w-lg md:mx-4 flex flex-col max-h-[90vh]">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <h2 className="text-base font-semibold text-gray-900">质检单 — {itemName}</h2>
              <button
                type="button"
                onClick={() => !saving && setOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              {/* 质检结果 */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setResult("passed")}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    result === "passed"
                      ? "bg-green-600 text-white border-green-600"
                      : "bg-white text-gray-600 border-gray-300 hover:border-green-400"
                  }`}
                >
                  ✓ 合格
                </button>
                <button
                  type="button"
                  onClick={() => setResult("failed")}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    result === "failed"
                      ? "bg-red-600 text-white border-red-600"
                      : "bg-white text-gray-600 border-gray-300 hover:border-red-400"
                  }`}
                >
                  ✗ 不合格
                </button>
              </div>

              {/* 备注（不合格必填） */}
              <div>
                <label className="text-xs text-gray-500">
                  备注{result === "failed" && <span className="text-red-500">（不合格必填原因）</span>}
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder={result === "failed" ? "请填写不合格原因，将退回待施工并记录返工" : "选填"}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* 图片/视频凭证 */}
              <div>
                <div className="text-xs text-gray-500 mb-1">图片凭证（选填）</div>
                <ImageUploader
                  existingImages={images}
                  maxImages={5}
                  onUpload={(paths) => setImages(paths)}
                  onDelete={(path) => setImages((prev) => prev.filter((p) => p !== path))}
                />
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">视频凭证（选填）</div>
                <VideoUploader
                  existingVideos={videos}
                  maxVideos={2}
                  maxFileSizeMB={100}
                  maxDurationSeconds={60}
                  onUpload={(paths) => setVideos(paths)}
                  onDelete={(path) => setVideos((prev) => prev.filter((p) => p !== path))}
                />
              </div>

              {/* 历史质检单 */}
              {历史.length > 0 && (
                <div className="border-t border-gray-100 pt-3">
                  <div className="text-xs font-semibold text-gray-500 mb-2">历史质检单</div>
                  <div className="space-y-2">
                    {历史.map((log) => (
                      <div key={log.id} className="text-xs border border-gray-100 rounded-lg p-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-1.5 py-0.5 rounded font-medium ${
                              log.result === "passed" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                            }`}
                          >
                            {log.result === "passed" ? "合格" : "不合格"}
                          </span>
                          <span className="text-gray-500">{log.profiles?.full_name || "-"}</span>
                          <span className="text-gray-400">{new Date(log.created_at).toLocaleString("zh-CN")}</span>
                        </div>
                        {log.notes && <div className="mt-1 text-gray-600">{log.notes}</div>}
                        {(log.work_order_item_qc_media || []).length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {(log.work_order_item_qc_media || []).map((m, i) => (
                              <a
                                key={i}
                                href={m.storage_path}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-600 hover:underline"
                              >
                                {m.media_type === "video" ? "视频" : "图片"}
                                {i + 1}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={saving}
                className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={提交质检}
                disabled={saving}
                className={`px-4 py-2 text-sm text-white rounded-lg disabled:opacity-50 ${
                  result === "passed" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
                }`}
              >
                {saving ? "提交中..." : result === "passed" ? "提交合格" : "提交不合格"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

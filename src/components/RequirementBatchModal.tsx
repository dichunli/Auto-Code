"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ImageUploader } from "@/components/ImageUploader";
import { VideoUploader } from "@/components/VideoUploader";

interface Props {
  open: boolean;
  onClose: () => void;
  orderId: string;
}

type RequirementRow = {
  description: string;
  diagnosis: string;
  remarks: string;
  images: string[];
  videos: string[];
};

const emptyRow = (): RequirementRow => ({
  description: "",
  diagnosis: "",
  remarks: "",
  images: [],
  videos: [],
});

export default function RequirementBatchModal({ open, onClose, orderId }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [rows, setRows] = useState<RequirementRow[]>([emptyRow()]);
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  function updateRow(idx: number, patch: Partial<RequirementRow>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(idx: number) {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  async function handleSubmit() {
    const valid = rows.filter((r) => r.description.trim());
    if (valid.length === 0) {
      alert("请至少填写一条客户需求");
      return;
    }

    setSaving(true);
    try {
      const { data: existing } = await supabase
        .from("work_order_requirements")
        .select("seq")
        .eq("work_order_id", orderId)
        .order("seq", { ascending: false })
        .limit(1);
      let nextSeq = (existing && existing[0]?.seq ? existing[0].seq : 0) + 1;

      for (const row of valid) {
        const { data: req, error: reqError } = await supabase
          .from("work_order_requirements")
          .insert({
            work_order_id: orderId,
            seq: nextSeq,
            description: row.description.trim(),
            diagnosis: row.diagnosis.trim() || null,
            remarks: row.remarks.trim() || null,
          })
          .select("id")
          .single();

        if (reqError || !req) throw reqError || new Error("创建需求失败");
        nextSeq += 1;

        const mediaRecords = [
          ...row.images.map((path) => ({
            requirement_id: req.id,
            media_type: "image" as const,
            storage_path: path,
          })),
          ...row.videos.map((path) => ({
            requirement_id: req.id,
            media_type: "video" as const,
            storage_path: path,
          })),
        ];
        if (mediaRecords.length > 0) {
          const { error: mediaError } = await supabase
            .from("work_order_requirement_media")
            .insert(mediaRecords);
          if (mediaError) throw mediaError;
        }
      }

      setRows([emptyRow()]);
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
    setRows([emptyRow()]);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-[1400px] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">添加客户需求</h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* 表头 */}
          <div className="grid grid-cols-[40px_1fr_1fr_1fr_200px_200px_60px] gap-3 px-2 pb-2 border-b border-gray-200 text-xs font-medium text-gray-500">
            <div>序号</div>
            <div>客户需求 <span className="text-red-500">*</span></div>
            <div>诊断结果</div>
            <div>备注</div>
            <div>需求图片</div>
            <div>需求视频</div>
            <div className="text-right">操作</div>
          </div>

          <div className="divide-y divide-gray-100">
            {rows.map((row, idx) => (
              <div
                key={idx}
                className="grid grid-cols-[40px_1fr_1fr_1fr_200px_200px_60px] gap-3 px-2 py-3 items-start"
              >
                <div className="text-sm font-medium text-blue-600 pt-2">{idx + 1}</div>
                <textarea
                  value={row.description}
                  onChange={(e) => updateRow(idx, { description: e.target.value })}
                  rows={3}
                  placeholder="例如：刹车异响，需要检查处理"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
                <textarea
                  value={row.diagnosis}
                  onChange={(e) => updateRow(idx, { diagnosis: e.target.value })}
                  rows={3}
                  placeholder="例如：前刹车片磨损严重，需更换"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
                <textarea
                  value={row.remarks}
                  onChange={(e) => updateRow(idx, { remarks: e.target.value })}
                  rows={3}
                  placeholder="选填"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
                <div>
                  <ImageUploader
                    existingImages={row.images}
                    onUpload={(paths) => updateRow(idx, { images: paths })}
                    maxImages={5}
                  />
                </div>
                <div>
                  <VideoUploader
                    existingVideos={row.videos}
                    onUpload={(paths) => updateRow(idx, { videos: paths })}
                    maxVideos={3}
                  />
                </div>
                <div className="text-right">
                  {rows.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      disabled={saving}
                      className="text-xs text-red-500 hover:text-red-600 disabled:opacity-50"
                    >
                      删除
                    </button>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addRow}
            disabled={saving}
            className="mt-3 w-full py-2 border border-dashed border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50 disabled:opacity-50 text-sm font-medium"
          >
            + 添加一条客户需求
          </button>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-2">
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

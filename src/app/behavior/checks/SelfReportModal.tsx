"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { ImageUploader } from "@/components/ImageUploader";
import { 计算时段状态 } from "@/lib/behaviorCheck";
import type { 考核记录视图 } from "./BehaviorChecksContent";

interface Props {
  record: 考核记录视图;
  onClose: () => void;
  onReported: () => void;
}

/* 责任人自检上报弹窗：对照检查标准拍照上报，检查人随后核查打分 */
export default function SelfReportModal({ record, onClose, onReported }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [photos, setPhotos] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [放大图, set放大图] = useState<string | null>(null);

  async function handleSubmit() {
    if (photos.length === 0) {
      alert("请先拍现场照片再上报");
      return;
    }
    setSaving(true);
    try {
      /* 提交前重查：防止页面挂着过期状态提交 */
      const { data: 最新记录 } = await supabase
        .from("behavior_check_records")
        .select("status, behavior_check_tasks(execute_time, end_time)")
        .eq("id", record.id)
        .single();
      if (!最新记录) throw new Error("记录不存在，请刷新页面");
      if (最新记录.status === "completed") {
        alert("该记录已完成，无需上报");
        onClose();
        onReported();
        return;
      }
      if (最新记录.status === "self_reported") {
        alert("已上报过了，请勿重复提交");
        onClose();
        onReported();
        return;
      }
      const 任务 = 最新记录.behavior_check_tasks as { execute_time: string; end_time: string }[] | { execute_time: string; end_time: string } | null;
      const t = Array.isArray(任务) ? 任务[0] : 任务;
      if (t && 计算时段状态(t.execute_time, t.end_time, "pending") === "closed") {
        alert(`已超过检查时间段（${t.end_time.slice(0, 5)} 截止），本次检查已关闭`);
        onClose();
        onReported();
        return;
      }

      const { error } = await supabase
        .from("behavior_check_records")
        .update({
          status: "self_reported",
          self_report_photos: photos,
          self_report_note: note.trim() || null,
          self_reported_at: new Date().toISOString(),
        })
        .eq("id", record.id);
      if (error) throw error;

      onReported();
      onClose();
    } catch (err: unknown) {
      alert("上报失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-lg max-h-[85vh] flex flex-col">
        <h3 className="text-base font-semibold text-gray-900">拍照自检上报：{record.item_name}</h3>
        <p className="text-xs text-gray-500 mt-1 mb-4">
          {record.task_name} · 时段 {record.execute_time.slice(0, 5)} ~ {record.end_time.slice(0, 5)} · 上报后由 {record.checker_names || "检查人"} 核查打分
        </p>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* 检查标准回顾 */}
          {record.details.length > 0 && (
            <div className="bg-gray-50 rounded-lg p-3 space-y-2">
              <p className="text-xs font-medium text-gray-600">对照检查标准自查：</p>
              {record.details.map((d, i) => (
                <div key={d.id} className="text-sm">
                  <span className="text-gray-700 font-medium">#{i + 1} {d.name}</span>
                  <span className="text-xs text-gray-400 ml-2">满分 {d.score_value}</span>
                  {d.description && <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap">{d.description}</p>}
                  {d.guide_images.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-1">
                      {d.guide_images.map((src, j) => (
                        <img
                          key={j}
                          src={src}
                          alt="检查标准"
                          loading="lazy"
                          className="w-14 h-14 object-cover rounded border border-gray-200 cursor-pointer"
                          onClick={() => set放大图(src)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {record.details.length === 0 && record.item_description && (
            <p className="text-sm text-gray-500 whitespace-pre-wrap">{record.item_description}</p>
          )}

          <div>
            <p className="text-sm font-medium text-gray-700 mb-1">现场照片 *（仅手机拍照）</p>
            <ImageUploader
              existingImages={photos}
              maxImages={5}
              folder="behavior"
              cameraOnly
              onUpload={setPhotos}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">自检说明（可选）</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="如：已按要求打扫完毕，垃圾桶已清空..."
            />
          </div>
        </div>

        <div className="flex gap-3 justify-end pt-4 mt-2 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 text-sm text-white bg-cyan-600 rounded-lg hover:bg-cyan-700 disabled:opacity-50"
          >
            {saving ? "上报中..." : "确认上报"}
          </button>
        </div>
      </div>

      {/* 标准图放大查看 */}
      {放大图 && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={() => set放大图(null)}>
          <img src={放大图} alt="检查标准" className="max-w-full max-h-full rounded-lg" />
        </div>
      )}
    </div>
  );
}

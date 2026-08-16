"use client";

import { useState } from "react";
import { ImageUploader } from "@/components/ImageUploader";
import { 自检上报计分 } from "./actions";
import type { 考核记录视图 } from "./BehaviorChecksContent";

interface Props {
  record: 考核记录视图;
  onClose: () => void;
  onReported: () => void;
}

/* 责任人自检上报弹窗：对照标准照片拍照上报。
 * 上报即视为自检合格，系统立即按满分计分；检查人事后核查发现不符可改判扣回。 */
export default function SelfReportModal({ record, onClose, onReported }: Props) {
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
      const 结果 = await 自检上报计分({ recordId: record.id, photos, note });
      if (!结果.success) {
        alert("上报失败: " + 结果.error);
        /* 状态类错误说明页面数据已过期，关掉弹窗刷新列表 */
        if (结果.error?.includes("刷新") || 结果.error?.includes("已完成") || 结果.error?.includes("已上报")) {
          onReported();
          onClose();
        }
        return;
      }
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
          {record.task_name} · 时段 {record.execute_time.slice(0, 5)} ~ {record.end_time.slice(0, 5)} · 上报即视为合格并计分，{record.checker_names || "检查人"} 事后核查
        </p>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* 项目级标准照片 */}
          {record.item_guide_images.length > 0 && (
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs font-medium text-gray-600 mb-1">标准照片（对照此标准自查）：</p>
              <div className="flex flex-wrap gap-2">
                {record.item_guide_images.map((src, j) => (
                  <img
                    key={j}
                    src={src}
                    alt="标准照片"
                    loading="lazy"
                    className="w-16 h-16 object-cover rounded border border-gray-200 cursor-pointer"
                    onClick={() => set放大图(src)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 检查标准回顾（细节级图文） */}
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
          {record.details.length === 0 && record.item_guide_images.length === 0 && record.item_description && (
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
            {saving ? "上报中..." : "确认合格并上报"}
          </button>
        </div>
      </div>

      {/* 标准图放大查看 */}
      {放大图 && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={() => set放大图(null)}>
          <img src={放大图} alt="标准照片" className="max-w-full max-h-full rounded-lg" />
        </div>
      )}
    </div>
  );
}

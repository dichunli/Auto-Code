"use client";

import { useState } from "react";
import { ImageUploader } from "@/components/ImageUploader";
import { 核查打分, type 细节作答项 } from "./actions";
import type { 考核记录视图 } from "./BehaviorChecksContent";

/* 每条细节的作答：得分(字符串)、照片、备注 */
interface 细节作答 {
  given: string;
  photos: string[];
  note: string;
}

interface Props {
  record: 考核记录视图;
  onClose: () => void;
  onCompleted: () => void;
  /* 责任人还没自检上报（两阶段流程中检查人直接检查）时显示提示 */
  未自检提示?: boolean;
}

/* 完成检查/核查弹窗：逐条细节对照标准照片+自检照片打分。
 * 责任人已自检的：默认维持满分（认可自检结果），改低即改判，差额自动扣回；
 * 判定不合格（加分制未给满分 / 扣分制有扣分）的条目必须拍现场照片才能提交。
 * 项目没设细节时回落为整体打分（旧模式兼容） */
export default function CheckCompleteModal({ record, onClose, onCompleted, 未自检提示 = false }: Props) {
  const 有细节 = record.details.length > 0;
  const 是扣分 = record.item_score_type === "penalty";
  const 已自检 = !!record.self_reported_at;

  /* 细节作答初始值：已自检的默认维持自检结论（加分制满分/扣分制不扣），未自检的默认 0 */
  const [作答, set作答] = useState<Record<string, 细节作答>>(() => {
    const init: Record<string, 细节作答> = {};
    for (const d of record.details) {
      const 默认分 = 已自检 && !是扣分 ? String(d.score_value) : "0";
      init[d.id] = { given: 默认分, photos: [], note: "" };
    }
    return init;
  });
  /* 无细节回落模式：已自检的默认维持（加分制满分/扣分制不扣），未自检的默认项目分值（现状） */
  const [整体分数, set整体分数] = useState(() => {
    if (已自检 && 是扣分) return "0";
    return String(record.item_score);
  });
  const [整体照片, set整体照片] = useState<string[]>([]);
  const [首条评论, set首条评论] = useState("");
  const [saving, setSaving] = useState(false);
  const [放大图, set放大图] = useState<string | null>(null);

  const 合计 = 有细节
    ? record.details.reduce((sum, d) => sum + (parseInt(作答[d.id]?.given || "0") || 0), 0)
    : parseInt(整体分数 || "0") || 0;

  /* 无细节模式当前是否判为不合格（决定照片是否必拍） */
  const 整体不合格 = 是扣分 ? 合计 > 0 : 合计 < record.item_score;

  function 更新作答(detailId: string, patch: Partial<细节作答>) {
    set作答((prev) => ({ ...prev, [detailId]: { ...prev[detailId], ...patch } }));
  }

  async function handleSubmit() {
    /* 校验每条打分范围 0~满分 + 不合格必拍 */
    if (有细节) {
      for (const d of record.details) {
        const a = 作答[d.id];
        const v = parseInt(a.given || "0");
        if (isNaN(v) || v < 0 || v > d.score_value) {
          alert(`「${d.name}」的分值要在 0 ~ ${d.score_value} 之间`);
          return;
        }
        const 不合格 = 是扣分 ? v > 0 : v < d.score_value;
        if (不合格 && a.photos.length === 0) {
          alert(`「${d.name}」判定不合格，请先拍现场照片再提交`);
          return;
        }
      }
    } else {
      const v = parseInt(整体分数);
      if (isNaN(v) || v < 0) {
        alert("请输入有效分数");
        return;
      }
      const 不合格 = 是扣分 ? v > 0 : v < record.item_score;
      if (不合格 && 整体照片.length === 0) {
        alert("判定不合格，请先拍现场照片再提交");
        return;
      }
    }

    setSaving(true);
    try {
      const detailResults: 细节作答项[] = record.details.map((d) => {
        const a = 作答[d.id];
        return {
          detail_id: d.id,
          name: d.name,
          full_score: d.score_value,
          given: parseInt(a.given || "0") || 0,
          photos: a.photos,
          note: a.note.trim() || null,
        };
      });
      const 结果 = await 核查打分({
        recordId: record.id,
        detailResults: 有细节 ? detailResults : [],
        整体分数: parseInt(整体分数 || "0") || 0,
        整体照片,
        评论: 首条评论,
      });
      if (!结果.success) {
        alert("提交失败: " + 结果.error);
        /* 状态类错误说明页面数据已过期，关掉弹窗刷新列表 */
        if (结果.error?.includes("刷新") || 结果.error?.includes("已完成") || 结果.error?.includes("已关闭")) {
          onCompleted();
          onClose();
        }
        return;
      }
      onCompleted();
      onClose();
    } catch (err: unknown) {
      alert("提交失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-2xl max-h-[85vh] flex flex-col">
        <h3 className="text-base font-semibold text-gray-900">{已自检 ? "核查打分" : "完成检查"}：{record.item_name}</h3>
        <p className="text-xs text-gray-500 mt-1 mb-4">
          {record.task_name} · 被考核人：{record.employee_name} · 时段 {record.execute_time.slice(0, 5)} ~ {record.end_time.slice(0, 5)}
        </p>

        {/* 项目级标准照片（对标基准） */}
        {record.item_guide_images.length > 0 && (
          <div className="mb-4 bg-gray-50 border border-gray-200 rounded-lg p-3">
            <p className="text-xs font-medium text-gray-600 mb-1">标准照片：</p>
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

        {/* 责任人自检上报内容（已自检待核查） */}
        {record.self_reported_at && (
          <div className="mb-4 bg-cyan-50 border border-cyan-200 rounded-lg p-3">
            <p className="text-xs text-cyan-700 font-medium mb-1">
              责任人已自检上报（{new Date(record.self_reported_at).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" })}），分数已按合格计入；
              维持满分表示认可，改低分数将自动差额扣回。
            </p>
            {record.self_report_note && <p className="text-xs text-gray-600 whitespace-pre-wrap mb-1">{record.self_report_note}</p>}
            {record.self_report_photos.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {record.self_report_photos.map((src, j) => (
                  <img
                    key={j}
                    src={src}
                    alt="自检照片"
                    loading="lazy"
                    className="w-14 h-14 object-cover rounded border border-cyan-200 cursor-pointer"
                    onClick={() => set放大图(src)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* 责任人未自检提示（检查人直接检查） */}
        {未自检提示 && !record.self_reported_at && (
          <p className="mb-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            责任人还没有自检上报。你可以直接检查打分，结果照常记录。
          </p>
        )}

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {有细节 ? (
            record.details.map((d, index) => {
              const a = 作答[d.id];
              const 当前分 = parseInt(a.given || "0") || 0;
              const 本条不合格 = 是扣分 ? 当前分 > 0 : 当前分 < d.score_value;
              return (
                <div key={d.id} className="border border-gray-200 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">#{index + 1}</span>
                    <span className="flex-1 text-sm font-medium text-gray-900">{d.name}</span>
                    <span className="text-xs text-gray-400">满分 {d.score_value}</span>
                    <input
                      type="number"
                      min="0"
                      max={d.score_value}
                      value={a.given}
                      onChange={(e) => 更新作答(d.id, { given: e.target.value })}
                      className="w-20 px-2 py-1.5 border border-gray-300 rounded text-sm text-center"
                    />
                    <span className="text-xs text-gray-500">{是扣分 ? "扣分" : "得分"}</span>
                  </div>
                  {d.description && <p className="text-xs text-gray-500 whitespace-pre-wrap">{d.description}</p>}
                  {d.guide_images.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {d.guide_images.map((src, i) => (
                        <img
                          key={i}
                          src={src}
                          alt="检查标准"
                          loading="lazy"
                          className="w-16 h-16 object-cover rounded-lg border border-gray-200 cursor-pointer"
                          onClick={() => set放大图(src)}
                        />
                      ))}
                    </div>
                  )}
                  <div>
                    <p className={`text-xs mb-1 ${本条不合格 ? "text-red-600 font-medium" : "text-gray-400"}`}>
                      现场照片{本条不合格 ? " *（不合格必须拍照留证）" : "（合格可不拍）"}，仅手机拍照
                    </p>
                    <ImageUploader
                      existingImages={a.photos}
                      maxImages={5}
                      folder="behavior"
                      cameraOnly
                      onUpload={(paths) => 更新作答(d.id, { photos: paths })}
                    />
                  </div>
                  <input
                    value={a.note}
                    onChange={(e) => 更新作答(d.id, { note: e.target.value })}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                    placeholder="本条备注（可选），如：地面角落有油渍"
                  />
                </div>
              );
            })
          ) : (
            /* 无细节的旧项目：整体打分 */
            <div className="space-y-3">
              {record.item_description && (
                <p className="text-sm text-gray-500 whitespace-pre-wrap">{record.item_description}</p>
              )}
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-700">{是扣分 ? "扣分" : "得分"}</label>
                <input
                  type="number"
                  min="0"
                  value={整体分数}
                  onChange={(e) => set整体分数(e.target.value)}
                  className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm text-center"
                />
                <span className="text-xs text-gray-400">满分 {record.item_score} 分</span>
              </div>
              <div>
                <p className={`text-xs mb-1 ${整体不合格 ? "text-red-600 font-medium" : "text-gray-400"}`}>
                  现场照片{整体不合格 ? " *（不合格必须拍照留证）" : "（合格可不拍）"}，仅手机拍照
                </p>
                <ImageUploader
                  existingImages={整体照片}
                  maxImages={5}
                  folder="behavior"
                  cameraOnly
                  onUpload={set整体照片}
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">评论（可选）</label>
            <textarea
              value={首条评论}
              onChange={(e) => set首条评论(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="对本次检查的补充说明，提交后显示在评论区..."
            />
          </div>
        </div>

        {/* 底部合计与操作 */}
        <div className="flex items-center justify-between pt-4 mt-2 border-t border-gray-100">
          <span className={`text-sm font-semibold ${是扣分 ? "text-red-600" : "text-green-600"}`}>
            合计：{是扣分 ? "-" : "+"}{Math.abs(合计)} 分
            {已自检 && <span className="text-xs font-normal text-gray-400 ml-1">（与自检满分的差额将自动扣回）</span>}
          </span>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "提交中..." : 已自检 ? "确认核查" : "确认完成"}
            </button>
          </div>
        </div>
      </div>

      {/* 标准图放大查看 */}
      {放大图 && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={() => set放大图(null)}>
          <img src={放大图} alt="照片" className="max-w-full max-h-full rounded-lg" />
        </div>
      )}
    </div>
  );
}

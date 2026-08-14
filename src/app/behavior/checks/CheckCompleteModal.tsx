"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { ImageUploader } from "@/components/ImageUploader";
import { 计算时段状态 } from "@/lib/behaviorCheck";
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
}

/* 完成检查弹窗：逐条细节对照图文标准打分 + 拍照 + 首条评论。
 * 项目没设细节时回落为整体打分（旧模式兼容） */
export default function CheckCompleteModal({ record, onClose, onCompleted }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const 有细节 = record.details.length > 0;
  const 是扣分 = record.item_score_type === "penalty";

  /* 细节作答初始值全部给 0（扣分制=默认合格不扣；加分制=默认不得分） */
  const [作答, set作答] = useState<Record<string, 细节作答>>(() => {
    const init: Record<string, 细节作答> = {};
    for (const d of record.details) {
      init[d.id] = { given: "0", photos: [], note: "" };
    }
    return init;
  });
  /* 无细节回落模式 */
  const [整体分数, set整体分数] = useState(String(record.item_score));
  const [整体照片, set整体照片] = useState<string[]>([]);
  const [首条评论, set首条评论] = useState("");
  const [saving, setSaving] = useState(false);
  const [放大图, set放大图] = useState<string | null>(null);

  const 合计 = 有细节
    ? record.details.reduce((sum, d) => sum + (parseInt(作答[d.id]?.given || "0") || 0), 0)
    : parseInt(整体分数 || "0") || 0;

  function 更新作答(detailId: string, patch: Partial<细节作答>) {
    set作答((prev) => ({ ...prev, [detailId]: { ...prev[detailId], ...patch } }));
  }

  async function handleSubmit() {
    /* 校验每条打分范围 0~满分 */
    if (有细节) {
      for (const d of record.details) {
        const v = parseInt(作答[d.id]?.given || "0");
        if (isNaN(v) || v < 0 || v > d.score_value) {
          alert(`「${d.name}」的分值要在 0 ~ ${d.score_value} 之间`);
          return;
        }
      }
    } else {
      const v = parseInt(整体分数);
      if (isNaN(v) || v < 0) {
        alert("请输入有效分数");
        return;
      }
    }

    setSaving(true);
    try {
      /* 提交前重查：防止页面挂着过期状态提交（已完成的/超时的拦截） */
      const { data: 最新记录 } = await supabase
        .from("behavior_check_records")
        .select("status, behavior_check_tasks(execute_time, end_time)")
        .eq("id", record.id)
        .single();
      if (!最新记录) throw new Error("记录不存在，请刷新页面");
      if (最新记录.status === "completed") {
        alert("该记录已完成，请勿重复提交");
        onClose();
        onCompleted();
        return;
      }
      const 任务 = 最新记录.behavior_check_tasks as { execute_time: string; end_time: string }[] | { execute_time: string; end_time: string } | null;
      const t = Array.isArray(任务) ? 任务[0] : 任务;
      if (t && 计算时段状态(t.execute_time, t.end_time, "pending") === "closed") {
        alert(`已超过检查时间段（${t.end_time.slice(0, 5)} 截止），本次检查已关闭`);
        onClose();
        onCompleted();
        return;
      }

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("登录已失效，请刷新页面");

      /* 汇总照片 + 组装细节结果快照 */
      const 全部照片: string[] = [];
      const detail_results = record.details.map((d) => {
        const a = 作答[d.id];
        全部照片.push(...a.photos);
        return {
          detail_id: d.id,
          name: d.name,
          full_score: d.score_value,
          given: parseInt(a.given || "0") || 0,
          photos: a.photos,
          note: a.note.trim() || null,
        };
      });
      if (!有细节) 全部照片.push(...整体照片);

      /* 1. 写打分流水（分数记在被考核人头上，item_id 指向真实项目） */
      const 正分 = Math.abs(合计);
      const { data: scoreData, error: scoreError } = await supabase
        .from("behavior_score_records")
        .insert({
          employee_id: record.employee_id,
          item_id: record.item_id,
          score: 是扣分 ? -正分 : 正分,
          notes: `完成考核：${record.task_name}（${record.item_name}）`,
          media_urls: 全部照片,
          scored_by: userData.user.id,
          event_time: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (scoreError) throw scoreError;

      /* 2. 更新检查记录 */
      const { error: updateError } = await supabase
        .from("behavior_check_records")
        .update({
          status: "completed",
          score_record_id: scoreData.id,
          detail_results,
        })
        .eq("id", record.id);
      if (updateError) throw updateError;

      /* 3. 首条评论（可空） */
      const 评论内容 = 首条评论.trim();
      if (评论内容) {
        const { error: commentError } = await supabase.from("behavior_check_comments").insert({
          check_record_id: record.id,
          author_id: userData.user.id,
          content: 评论内容,
        });
        if (commentError) throw commentError;
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
        <h3 className="text-base font-semibold text-gray-900">完成检查：{record.item_name}</h3>
        <p className="text-xs text-gray-500 mt-1 mb-4">
          {record.task_name} · 被考核人：{record.responsible_name || record.employee_name} · 时段 {record.execute_time.slice(0, 5)} ~ {record.end_time.slice(0, 5)}
        </p>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {有细节 ? (
            record.details.map((d, index) => {
              const a = 作答[d.id];
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
                    <p className="text-xs text-gray-400 mb-1">现场照片（可选）</p>
                    <ImageUploader
                      existingImages={a.photos}
                      maxImages={3}
                      folder="behavior"
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
                <span className="text-xs text-gray-400">默认 {record.item_score} 分</span>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">现场照片</p>
                <ImageUploader
                  existingImages={整体照片}
                  maxImages={5}
                  folder="behavior"
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
              {saving ? "提交中..." : "确认完成"}
            </button>
          </div>
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

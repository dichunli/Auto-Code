"use client";

import {useState, useMemo} from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { useConfirm } from "@/components/ConfirmDialog";

export interface 等级信息 {
  id: string;
  name: string;
}

export interface 晋级检查结果 {
  eligible: boolean;
  current_level_id: string | null;
  course_points: number;
  work_order_count: number;
  rework_loss_total: number;
  daily_loss_total: number;
  behavior_score_total: number;
  exam_all_passed: boolean;
  required_courses_completed: boolean;
  required_courses_count: number;
  required_courses_done: number;
  exam_total_score: number;
  missing_items: string[];
}

export interface 晋级规则 {
  id: string;
  from_level_id: string | null;
  to_level_id: string;
  min_course_points: number;
  min_work_orders: number;
  max_rework_loss: number;
  max_daily_loss: number;
  min_behavior_score: number;
  min_exam_score: number;
  exam_pass_required: boolean;
  period_months: number;
  required_course_ids: string[] | null;
}

export default function PromotionStatusContent({
  initialCurrentLevel,
  initialNextLevel,
  initialRule,
  initialCheckResult,
}: {
  initialCurrentLevel: 等级信息 | null;
  initialNextLevel: 等级信息 | null;
  initialRule: 晋级规则 | null;
  initialCheckResult: 晋级检查结果 | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  /* 首屏数据由服务端传入；本页无客户端重查 */
  const [currentLevel] = useState<等级信息 | null>(initialCurrentLevel);
  const [nextLevel] = useState<等级信息 | null>(initialNextLevel);
  const [rule] = useState<晋级规则 | null>(initialRule);
  const [checkResult] = useState<晋级检查结果 | null>(initialCheckResult);
  const [applying, setApplying] = useState(false);
  const { 请求确认, 确认弹窗 } = useConfirm();

  async function handleApply() {
    if (!rule || !nextLevel) return;
    if (!(await 请求确认(`申请晋级：${currentLevel?.name} → ${nextLevel.name}`))) return;

    setApplying(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("promotion_records").insert({
        employee_id: userData.user?.id,
        type: "promotion",
        from_level_id: currentLevel?.id || null,
        to_level_id: rule.to_level_id,
        reason: `员工自主申请晋级：${currentLevel?.name} → ${nextLevel.name}`,
        course_points: checkResult?.course_points || 0,
        work_order_count: checkResult?.work_order_count || 0,
        rework_loss_total: checkResult?.rework_loss_total || 0,
        daily_loss_total: checkResult?.daily_loss_total || 0,
        behavior_score_total: checkResult?.behavior_score_total || 0,
        status: "pending",
      });

      if (error) throw error;
      alert("晋级申请已提交，等待管理员审核");
    } catch (err: unknown) {
      alert("申请失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setApplying(false);
    }
  }

  if (!rule) {
    return (
      <div>
        <PageHeader title="我的晋级状态" />
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-500">当前暂无适用于您的晋级规则</p>
          <p className="text-sm text-gray-400 mt-2">请联系管理员配置晋级规则</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="我的晋级状态" />

      {/* 当前等级 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">当前等级</p>
            <p className="text-2xl font-bold text-gray-900">{currentLevel?.name || "无等级"}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-500">目标等级</p>
            <p className="text-2xl font-bold text-blue-600">{nextLevel?.name}</p>
          </div>
        </div>

        {checkResult?.eligible ? (
          <div className="mt-4 p-4 bg-green-50 rounded-lg border border-green-200">
            <p className="text-sm font-medium text-green-800">恭喜！您已满足所有晋级条件</p>
            <button
              onClick={handleApply}
              disabled={applying}
              className="mt-2 px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {applying ? "申请中..." : "提交晋级申请"}
            </button>
          </div>
        ) : (
          <div className="mt-4 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
            <p className="text-sm font-medium text-yellow-800">尚未满足晋级条件</p>
            {checkResult?.missing_items && checkResult.missing_items.length > 0 && (
              <ul className="mt-2 text-sm text-yellow-700 list-disc list-inside">
                {checkResult.missing_items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* 各项指标 */}
      {checkResult && rule && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-base font-semibold text-gray-900 mb-4">晋级指标</h3>
          <div className="space-y-4">
            <ProgressBar label="课程积分" current={checkResult.course_points} target={rule.min_course_points} />
            <ProgressBar label="工单数量" current={checkResult.work_order_count} target={rule.min_work_orders} />
            <ProgressBar label="行为规范分数" current={checkResult.behavior_score_total} target={rule.min_behavior_score} />
            {rule.required_course_ids && rule.required_course_ids.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-gray-600">必修课程</span>
                  <span className={`text-sm font-medium ${checkResult.required_courses_completed ? "text-green-600" : "text-gray-700"}`}>
                    {checkResult.required_courses_done} / {checkResult.required_courses_count}
                  </span>
                </div>
                <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${checkResult.required_courses_completed ? "bg-green-500" : "bg-blue-500"}`}
                    style={{ width: `${checkResult.required_courses_count > 0 ? Math.min(100, Math.round((checkResult.required_courses_done / checkResult.required_courses_count) * 100)) : 0}%` }}
                  />
                </div>
              </div>
            )}
            {rule.min_exam_score > 0 && (
              <ProgressBar label="考核得分" current={checkResult.exam_total_score} target={rule.min_exam_score} />
            )}
            {rule.max_rework_loss > 0 && (
              <ProgressBar label="返工损失（越低越好）" current={checkResult.rework_loss_total} target={rule.max_rework_loss} reverse />
            )}
            {rule.max_daily_loss > 0 && (
              <ProgressBar label="日常损失（越低越好）" current={checkResult.daily_loss_total} target={rule.max_daily_loss} reverse />
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">考试通过情况</span>
              <span className={checkResult.exam_all_passed ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                {checkResult.exam_all_passed ? "全部通过" : "有未通过/待判卷"}
              </span>
            </div>
          </div>
        </div>
      )}
      {确认弹窗}
    </div>
  );
}

function ProgressBar({
  label,
  current,
  target,
  reverse,
}: {
  label: string;
  current: number;
  target: number;
  reverse?: boolean;
}) {
  let met: boolean;
  let pct: number;

  if (reverse) {
    /* 反向指标：数值越低越好（如损失上限） */
    met = target > 0 ? current <= target : true;
    pct = target > 0 ? Math.max(0, 100 - Math.round((current / target) * 100)) : 100;
  } else {
    met = target > 0 ? current >= target : true;
    pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 100;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-gray-600">{label}</span>
        <span className={`text-sm font-medium ${met ? "text-green-600" : "text-gray-700"}`}>
          {current} / {target}
        </span>
      </div>
      {target > 0 && (
        <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${met ? "bg-green-500" : "bg-blue-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

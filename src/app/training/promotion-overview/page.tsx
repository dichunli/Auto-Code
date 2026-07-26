"use client";

import {useState, useEffect, useMemo} from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

interface 员工 {
  id: string;
  full_name: string;
  level_name: string;
  level_id: string | null;
}

interface 员工状态 {
  employee: 员工;
  next_level_name: string;
  next_level_id: string;
  eligible: boolean;
  course_points: number;
  work_order_count: number;
  rework_loss: number;
  daily_loss: number;
  behavior_score: number;
  exam_passed: boolean;
  required_courses_completed: boolean;
  required_courses_count: number;
  required_courses_done: number;
  exam_total_score: number;
  missing: string[];
  rule: {
    min_course_points: number;
    min_work_orders: number;
    max_rework_loss: number;
    max_daily_loss: number;
    min_behavior_score: number;
    min_exam_score: number;
    exam_pass_required: boolean;
    required_course_ids: string[];
  } | null;
}

export default function PromotionOverviewPage() {
  const supabase = useMemo(() => createClient(), []);
  const [statusList, setStatusList] = useState<员工状态[]>([]);
  const [loading, setLoading] = useState(false);
  const [promotingId, setPromotingId] = useState<string | null>(null);

  async function fetchData() {
    setLoading(true);
    /* 获取所有在职员工 */
    const { data: empData } = await supabase
      .from("profiles")
      .select("id, full_name, mechanic_level_id, mechanic_levels(name)")
      .eq("is_active", true)
      .order("full_name");

    const empList: 员工[] = ((empData || []) as unknown as { id: string; full_name: string; mechanic_level_id: string | null; mechanic_levels: { name: string }[] | { name: string } | null }[]).map((e) => {
      const level = Array.isArray(e.mechanic_levels) ? e.mechanic_levels[0] : e.mechanic_levels;
      return {
        id: e.id,
        full_name: e.full_name,
        level_id: e.mechanic_level_id,
        level_name: level?.name || "无等级",
      };
    });

    /* 获取所有晋级规则 */
    const { data: ruleData } = await supabase
      .from("promotion_rules")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    const rules = (ruleData || []) as {
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
    }[];

    /* 获取等级名称 */
    const { data: levelData } = await supabase.from("mechanic_levels").select("id, name");
    const levelMap = new Map<string, string>();
    (levelData as { id: string; name: string }[] | null)?.forEach((l) => levelMap.set(l.id, l.name));

    /* 逐个员工检查晋级条件（通过 RPC 调用） */
    const statuses: 员工状态[] = [];
    for (const emp of empList) {
      /* 找到该员工的下一个等级规则 */
      const rule = rules.find((r) => r.from_level_id === emp.level_id);

      if (!rule) {
        statuses.push({
          employee: emp,
          next_level_name: "",
          next_level_id: "",
          eligible: false,
          course_points: 0,
          work_order_count: 0,
          rework_loss: 0,
          daily_loss: 0,
          behavior_score: 0,
          exam_passed: true,
          /* 无晋级规则时，必修课程视为无要求 */
          required_courses_completed: true,
          required_courses_count: 0,
          required_courses_done: 0,
          exam_total_score: 0,
          missing: ["暂无晋级规则"],
          rule: null,
        });
        continue;
      }

      /* 调用检查函数 */
      const { data: checkResult } = await supabase.rpc("check_promotion_eligibility", {
        p_employee_id: emp.id,
        p_target_level_id: rule.to_level_id,
      });

      const result = (checkResult as { eligible: boolean; course_points: number; work_order_count: number; rework_loss_total: number; daily_loss_total: number; behavior_score_total: number; exam_all_passed: boolean; required_courses_completed: boolean; required_courses_count: number; required_courses_done: number; exam_total_score: number; missing_items: string[] }[] | null)?.[0];

      statuses.push({
        employee: emp,
        next_level_name: levelMap.get(rule.to_level_id) || "",
        next_level_id: rule.to_level_id,
        eligible: result?.eligible || false,
        course_points: result?.course_points || 0,
        work_order_count: result?.work_order_count || 0,
        rework_loss: result?.rework_loss_total || 0,
        daily_loss: result?.daily_loss_total || 0,
        behavior_score: result?.behavior_score_total || 0,
        exam_passed: result?.exam_all_passed ?? true,
        required_courses_completed: result?.required_courses_completed ?? true,
        required_courses_count: result?.required_courses_count || 0,
        required_courses_done: result?.required_courses_done || 0,
        exam_total_score: result?.exam_total_score || 0,
        missing: result?.missing_items || [],
        rule: {
          min_course_points: rule.min_course_points,
          min_work_orders: rule.min_work_orders,
          max_rework_loss: rule.max_rework_loss,
          max_daily_loss: rule.max_daily_loss,
          min_behavior_score: rule.min_behavior_score,
          min_exam_score: rule.min_exam_score,
          exam_pass_required: rule.exam_pass_required,
          required_course_ids: rule.required_course_ids || [],
        },
      });
    }

    setStatusList(statuses);
    setLoading(false);
  }

  useEffect(() => {
    fetchData();
  }, [supabase]);

  async function handlePromote(emp: 员工状态) {
    if (!emp.next_level_id) return;
    if (!confirm(`确定为 ${emp.employee.full_name} 发起晋级申请（${emp.employee.level_name} → ${emp.next_level_name}）吗？`)) return;

    setPromotingId(emp.employee.id);
    try {
      await supabase.auth.getUser();
      const { error } = await supabase.from("promotion_records").insert({
        employee_id: emp.employee.id,
        type: "promotion",
        from_level_id: emp.employee.level_id,
        to_level_id: emp.next_level_id,
        reason: `满足晋级条件，自动申请：${emp.employee.level_name} → ${emp.next_level_name}`,
        course_points: emp.course_points,
        work_order_count: emp.work_order_count,
        rework_loss_total: emp.rework_loss,
        daily_loss_total: emp.daily_loss,
        behavior_score_total: emp.behavior_score,
        status: "pending",
      });

      if (error) throw error;
      alert("晋级申请已提交，等待审核");
      fetchData();
    } catch (err: unknown) {
      alert("申请失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setPromotingId(null);
    }
  }

  return (
    <div>
      <PageHeader title="员工晋级状态总览" description="查看所有员工的晋级条件达成情况" />

      {loading ? (
        <div className="p-8 text-center text-gray-400">加载中...</div>
      ) : statusList.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-500">暂无数据</p>
        </div>
      ) : (
        <div className="space-y-4">
          {statusList.map((s) => (
            <div
              key={s.employee.id}
              className={`bg-white rounded-xl border p-5 ${s.eligible ? "border-green-300" : "border-gray-200"}`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-gray-900">{s.employee.full_name}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                    {s.employee.level_name}
                  </span>
                  {s.next_level_name && (
                    <>
                      <span className="text-gray-400">→</span>
                      <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200">
                        {s.next_level_name}
                      </span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {s.eligible ? (
                    <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">
                      满足条件
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-50 text-gray-500 border border-gray-200">
                      未满足
                    </span>
                  )}
                  {s.eligible && s.next_level_id && (
                    <button
                      onClick={() => handlePromote(s)}
                      disabled={promotingId === s.employee.id}
                      className="text-xs px-3 py-1.5 text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {promotingId === s.employee.id ? "申请中..." : "发起晋级"}
                    </button>
                  )}
                </div>
              </div>

              {s.rule ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <ProgressItem label="课程积分" current={s.course_points} target={s.rule.min_course_points} />
                  <ProgressItem label="工单数量" current={s.work_order_count} target={s.rule.min_work_orders} />
                  <ProgressItem label="行为分数" current={s.behavior_score} target={s.rule.min_behavior_score} />
                  <div className="flex items-center justify-between p-2 bg-gray-50 rounded">
                    <span className="text-gray-500">考试通过</span>
                    <span className={s.exam_passed ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                      {s.exam_passed ? "通过" : "未通过"}
                    </span>
                  </div>
                  {s.rule.required_course_ids && s.rule.required_course_ids.length > 0 && (
                    <div className="flex items-center justify-between p-2 bg-gray-50 rounded">
                      <span className="text-gray-500">必修课程</span>
                      <span className={s.required_courses_completed ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                        {s.required_courses_done}/{s.required_courses_count}
                      </span>
                    </div>
                  )}
                  {s.rule.min_exam_score > 0 && (
                    <ProgressItem label="考核得分" current={s.exam_total_score} target={s.rule.min_exam_score} />
                  )}
                  {s.rule.max_rework_loss > 0 && (
                    <div className="flex items-center justify-between p-2 bg-gray-50 rounded">
                      <span className="text-gray-500">返工损失</span>
                      <span className={s.rework_loss <= s.rule.max_rework_loss ? "text-green-600" : "text-red-600"}>
                        ¥{s.rework_loss.toFixed(2)} / ¥{s.rule.max_rework_loss}
                      </span>
                    </div>
                  )}
                  {s.rule.max_daily_loss > 0 && (
                    <div className="flex items-center justify-between p-2 bg-gray-50 rounded">
                      <span className="text-gray-500">日常损失</span>
                      <span className={s.daily_loss <= s.rule.max_daily_loss ? "text-green-600" : "text-red-600"}>
                        ¥{s.daily_loss.toFixed(2)} / ¥{s.rule.max_daily_loss}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-gray-400">{s.missing[0]}</p>
              )}

              {!s.eligible && s.missing.length > 0 && (
                <div className="mt-2 text-xs text-red-600">
                  未满足：{s.missing.join("；")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProgressItem({ label, current, target }: { label: string; current: number; target: number }) {
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : current > 0 ? 100 : 0;
  const met = target > 0 ? current >= target : true;

  return (
    <div className="p-2 bg-gray-50 rounded">
      <div className="flex items-center justify-between mb-1">
        <span className="text-gray-500">{label}</span>
        <span className={met ? "text-green-600 font-medium" : "text-gray-700"}>
          {current} / {target}
        </span>
      </div>
      {target > 0 && (
        <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${met ? "bg-green-500" : "bg-blue-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

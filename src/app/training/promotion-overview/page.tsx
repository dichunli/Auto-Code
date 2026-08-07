import { createClient } from "@/lib/supabase/server";
import PromotionOverviewContent from "./PromotionOverviewContent";
import type { 员工, 员工状态 } from "./PromotionOverviewContent";

/* 首屏数据在服务端查询（原客户端 useEffect 加载会闪空白），
 * 发起晋级后的客户端重查逻辑在 PromotionOverviewContent 内保持不变 */
export default async function PromotionOverviewPage() {
  const supabase = await createClient();

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

  return <PromotionOverviewContent initialStatusList={statuses} />;
}

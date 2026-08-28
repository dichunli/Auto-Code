/* 每日生成考核记录 —— 供 cron 路由调用
 * 创建日期: 2026-08-28
 * 背景: 待办清单第6项——考核检查页"一打开就写库"（页面渲染/爬虫/预渲染都触发插入）。
 * 生成时机挪到每日定时任务：每天凌晨为当天所有启用任务生成记录，
 * 页面只读不再写库。 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { 本地今日字符串, 过滤今日任务 } from "@/lib/behaviorCheck";

interface 考核任务行 {
  id: string;
  frequency: string;
  execute_weekday: number | null;
  execute_day: number | null;
  employee_ids: string[] | null;
  behavior_score_items:
    | { responsible_ids: string[] | null; checker_ids: string[] | null }[]
    | { responsible_ids: string[] | null; checker_ids: string[] | null }
    | null;
}

function 取单<T>(v: T[] | T | null | undefined): T | null {
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
}

/* 为当天所有启用任务生成考核记录（先查后插 + 忽略唯一冲突，幂等可重跑）。
 * 责任人模式：每个责任人各一条；旧模式：名单内员工各一条（名单空=全员，本人自检）。
 * 返回生成条数。 */
export async function 生成今日考核记录(supabase: SupabaseClient): Promise<{ success: boolean; generated: number; error?: string }> {
  const today = 本地今日字符串();

  const { data: taskData, error: 任务错误 } = await supabase
    .from("behavior_check_tasks")
    .select("id, frequency, execute_weekday, execute_day, employee_ids, behavior_score_items(responsible_ids, checker_ids)")
    .eq("is_active", true);
  if (任务错误) {
    return { success: false, generated: 0, error: 任务错误.message };
  }

  const todayTasks = 过滤今日任务((taskData || []) as unknown as 考核任务行[]);
  let generated = 0;

  /* 旧模式名单为空 = 全员：取在职员工 */
  const 需要全员 = todayTasks.some((t) => {
    const item = 取单(t.behavior_score_items);
    return !(item?.responsible_ids && item.responsible_ids.length > 0) && (!t.employee_ids || t.employee_ids.length === 0);
  });
  let 全员ids: string[] = [];
  if (需要全员) {
    const { data: 员工 } = await supabase.from("profiles").select("id").eq("is_active", true);
    全员ids = ((员工 || []) as { id: string }[]).map((e) => e.id);
  }

  for (const task of todayTasks) {
    const item = 取单(task.behavior_score_items);

    if (item?.responsible_ids && item.responsible_ids.length > 0) {
      /* 责任人模式 */
      for (const 责任人 of item.responsible_ids) {
        const 应检查人集合 = item.checker_ids && item.checker_ids.length > 0 ? item.checker_ids : [责任人];
        const { data: existing } = await supabase
          .from("behavior_check_records")
          .select("id")
          .eq("task_id", task.id)
          .eq("employee_id", 责任人)
          .eq("check_date", today)
          .maybeSingle();
        if (!existing) {
          const { error } = await supabase.from("behavior_check_records").insert({
            task_id: task.id,
            employee_id: 责任人,
            checker_ids: 应检查人集合,
            check_date: today,
            status: "pending",
          });
          /* 23505 = 唯一约束冲突（重复跑），忽略即可 */
          if (error && error.code !== "23505") {
            console.error("生成今日考核记录失败:", error.message);
          } else if (!error) {
            generated++;
          }
        }
      }
    } else {
      /* 旧模式：名单内或全员，本人自检 */
      const 名单 = task.employee_ids && task.employee_ids.length > 0 ? task.employee_ids : 全员ids;
      for (const 员工id of 名单) {
        const { data: existing } = await supabase
          .from("behavior_check_records")
          .select("id")
          .eq("task_id", task.id)
          .eq("employee_id", 员工id)
          .eq("check_date", today)
          .maybeSingle();
        if (!existing) {
          const { error } = await supabase.from("behavior_check_records").insert({
            task_id: task.id,
            employee_id: 员工id,
            checker_ids: [员工id],
            check_date: today,
            status: "pending",
          });
          if (error && error.code !== "23505") {
            console.error("生成今日考核记录失败:", error.message);
          } else if (!error) {
            generated++;
          }
        }
      }
    }
  }

  return { success: true, generated };
}

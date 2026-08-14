import { createClient } from "@/lib/supabase/server";
import BehaviorChecksContent from "./BehaviorChecksContent";

/* 首屏数据在服务端查询（原客户端 useEffect 加载会闪空白），
 * 提交后的客户端重查逻辑在 BehaviorChecksContent 内保持不变 */
export default async function BehaviorChecksPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return <BehaviorChecksContent initialRecords={[]} />;
  }

  const today = new Date().toISOString().split("T")[0];
  const now = new Date();
  const weekday = now.getDay();
  const dayOfMonth = now.getDate();

  /* 1. 获取所有启用的考核任务 */
  const { data: taskData } = await supabase
    .from("behavior_check_tasks")
    .select("*")
    .eq("is_active", true);

  /* 2. 筛选今天应该执行的任务 */
  const todayTasks = (taskData || []).filter((t: { frequency: string; execute_weekday: number | null; execute_day: number | null; employee_ids: string[] | null }) => {
    if (t.frequency === "daily") return true;
    if (t.frequency === "weekly" && t.execute_weekday === weekday) return true;
    if (t.frequency === "monthly" && t.execute_day === dayOfMonth) return true;
    return false;
  }).filter((t: { employee_ids: string[] | null }) => {
    /* 检查当前用户是否在考核范围内 */
    if (!t.employee_ids || t.employee_ids.length === 0) return true;
    return t.employee_ids.includes(userData.user.id);
  });

  /* 3. 为今天应该执行但还没有记录的任务创建记录 */
  for (const task of todayTasks) {
    const { data: existing } = await supabase
      .from("behavior_check_records")
      .select("id")
      .eq("task_id", (task as { id: string }).id)
      .eq("employee_id", userData.user.id)
      .eq("check_date", today)
      .single();

    if (!existing) {
      await supabase.from("behavior_check_records").insert({
        task_id: (task as { id: string }).id,
        employee_id: userData.user.id,
        check_date: today,
        status: "pending",
      });
    }
  }

  /* 4. 获取今天的考核记录 */
  const { data } = await supabase
    .from("behavior_check_records")
    .select("*, behavior_check_tasks(name, item_id, behavior_score_items(name, score_value, score_type))")
    .eq("employee_id", userData.user.id)
    .eq("check_date", today)
    .order("created_at", { ascending: true });

  const mapped = (data || []).map((r: unknown) => {
    const rec = r as {
      id: string;
      task_id: string;
      check_date: string;
      status: string;
      score_record_id: string | null;
      behavior_check_tasks: {
        name: string;
        item_id: string;
        behavior_score_items: { name: string; score_value: number; score_type: string }[] | { name: string; score_value: number; score_type: string } | null;
      } | null;
    };
    const item = Array.isArray(rec.behavior_check_tasks?.behavior_score_items)
      ? rec.behavior_check_tasks?.behavior_score_items[0]
      : rec.behavior_check_tasks?.behavior_score_items;
    return {
      id: rec.id,
      task_id: rec.task_id,
      item_id: rec.behavior_check_tasks?.item_id || "",
      task_name: rec.behavior_check_tasks?.name || "",
      item_name: item?.name || "",
      item_score: item?.score_value || 0,
      item_score_type: item?.score_type || "bonus",
      check_date: rec.check_date,
      status: rec.status,
      score_record_id: rec.score_record_id,
      media_urls: [] as string[],
    };
  });

  return <BehaviorChecksContent initialRecords={mapped} />;
}

import { createClient } from "@/lib/supabase/server";
import BehaviorTasksContent from "./BehaviorTasksContent";

interface 行为项目 {
  id: string;
  name: string;
  score_type: string;
  score_value: number;
  responsible_ids: string[];
  checker_ids: string[];
}

interface 员工 {
  id: string;
  full_name: string;
}

interface 考核任务 {
  id: string;
  name: string;
  item_id: string;
  item_name: string;
  item_score: number;
  item_score_type: string;
  frequency: string;
  execute_time: string;
  end_time: string;
  execute_weekday: number;
  execute_day: number;
  employee_ids: string[];
  is_active: boolean;
}

/* 首屏数据在服务端查询（原客户端 useEffect 加载会闪空白），
 * 增删改后的客户端重查逻辑在 BehaviorTasksContent 内保持不变 */
export default async function BehaviorTasksPage() {
  const supabase = await createClient();
  /* 首屏任务只取第一页（20 条）+ 总数，防止任务增多后全量拉取拖慢页面 */
  const [{ data: itemData }, { data: empData }, { data: taskData, count: taskCount }] = await Promise.all([
    supabase.from("behavior_score_items").select("id, name, score_type, score_value, responsible_ids, checker_ids").eq("is_active", true).order("name"),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase.from("behavior_check_tasks").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(0, 19),
  ]);

  const itemMap = new Map((itemData as 行为项目[] | null)?.map((i) => [i.id, i]) || []);

  const tasks = ((taskData || []) as 考核任务[]).map((t) => {
    const item = itemMap.get(t.item_id);
    return {
      ...t,
      item_name: item?.name || "",
      item_score: item?.score_value || 0,
      item_score_type: item?.score_type || "bonus",
      employee_ids: t.employee_ids || [],
    };
  });

  return (
    <BehaviorTasksContent
      initialItems={(itemData as 行为项目[] | null) || []}
      initialEmployees={(empData as 员工[] | null) || []}
      initialTasks={tasks}
      initialCount={taskCount || 0}
    />
  );
}

import { createClient } from "@/lib/supabase/server";
import BehaviorChecksContent, { 考核记录视图, 细节视图 } from "./BehaviorChecksContent";
import { 本地今日字符串, 过滤今日任务 } from "@/lib/behaviorCheck";

/* 任务嵌套项目的查询结果形状 */
interface 嵌套项目 {
  id: string;
  name: string;
  score_type: string;
  score_value: number;
  description: string | null;
  responsible_id: string | null;
  checker_id: string | null;
  responsible: { full_name: string }[] | { full_name: string } | null;
  checker: { full_name: string }[] | { full_name: string } | null;
}

interface 嵌套任务 {
  id: string;
  name: string;
  item_id: string;
  frequency: string;
  execute_time: string;
  end_time: string;
  execute_weekday: number | null;
  execute_day: number | null;
  employee_ids: string[] | null;
  behavior_score_items: 嵌套项目[] | 嵌套项目 | null;
}

function 取单<T>(v: T[] | T | null | undefined): T | null {
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
}

/* 懒生成今日考核记录（先查后插 + 忽略唯一冲突，约束上线前后都安全），
 * 返回 true 表示本次有新记录生成 */
async function 懒生成今日记录(
  supabase: Awaited<ReturnType<typeof createClient>>,
  uid: string,
  today: string
): Promise<void> {
  const { data: taskData } = await supabase
    .from("behavior_check_tasks")
    .select("*, behavior_score_items(id, name, score_type, score_value, description, responsible_id, checker_id, responsible:profiles!behavior_score_items_responsible_id_fkey(full_name), checker:profiles!behavior_score_items_checker_id_fkey(full_name))")
    .eq("is_active", true);

  const todayTasks = 过滤今日任务((taskData || []) as 嵌套任务[]);

  for (const task of todayTasks) {
    const item = 取单(task.behavior_score_items);
    let 被考核人: string;
    let 应检查人: string;

    if (item?.responsible_id) {
      /* 责任人模式：被考核人=责任人，检查人=配置的检查人（空=责任人自检）；
       * 只由"应检查人"打开页面时生成，任务上的考核对象设置在此模式下不生效 */
      被考核人 = item.responsible_id;
      应检查人 = item.checker_id || item.responsible_id;
      if (uid !== 应检查人) continue;
    } else {
      /* 旧模式：任务 employee_ids 空=全员，否则只给名单内的人生成；本人自检 */
      if (task.employee_ids && task.employee_ids.length > 0 && !task.employee_ids.includes(uid)) continue;
      被考核人 = uid;
      应检查人 = uid;
    }

    const { data: existing } = await supabase
      .from("behavior_check_records")
      .select("id")
      .eq("task_id", task.id)
      .eq("employee_id", 被考核人)
      .eq("check_date", today)
      .maybeSingle();

    if (!existing) {
      const { error } = await supabase.from("behavior_check_records").insert({
        task_id: task.id,
        employee_id: 被考核人,
        checker_id: 应检查人,
        check_date: today,
        status: "pending",
      });
      /* 23505 = 唯一约束冲突（两台设备同时打开页面），忽略即可 */
      if (error && error.code !== "23505") {
        console.error("生成今日考核记录失败:", error.message);
      }
    }
  }
}

/* 首屏数据在服务端查询（客户端 useEffect 加载会闪空白） */
export default async function BehaviorChecksPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return <BehaviorChecksContent initialRecords={[]} currentUserId="" />;
  }
  const uid = userData.user.id;
  const today = 本地今日字符串();

  await 懒生成今日记录(supabase, uid, today);

  /* 查今天"待我检查"（checker_id=我）或"考核我的"（employee_id=我）的记录；
   * checker_id 为 NULL 的旧记录走 employee_id=我 命中 */
  const { data } = await supabase
    .from("behavior_check_records")
    .select("*, employee:profiles!behavior_check_records_employee_id_fkey(full_name), behavior_check_tasks(name, execute_time, end_time, item_id, behavior_score_items(id, name, score_type, score_value, description, responsible_id, checker_id, responsible:profiles!behavior_score_items_responsible_id_fkey(full_name), checker:profiles!behavior_score_items_checker_id_fkey(full_name)))")
    .eq("check_date", today)
    .or(`checker_id.eq.${uid},employee_id.eq.${uid}`)
    .order("created_at", { ascending: true });

  const 记录列表 = data || [];

  /* 并行补查：涉及项目的检查细节 + 记录的评论数 */
  const itemIds = [...new Set(记录列表.map((r) => 取单((r as { behavior_check_tasks: 嵌套任务 | null }).behavior_check_tasks)?.item_id).filter(Boolean))] as string[];
  const recordIds = 记录列表.map((r) => r.id);

  const [细节结果, 评论结果] = await Promise.all([
    itemIds.length > 0
      ? supabase.from("behavior_item_details").select("*").in("item_id", itemIds).order("sort_order", { ascending: true }).order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),
    recordIds.length > 0
      ? supabase.from("behavior_check_comments").select("check_record_id").in("check_record_id", recordIds)
      : Promise.resolve({ data: [] }),
  ]);

  /* 细节按项目分组 */
  const 细节按项目 = new Map<string, 细节视图[]>();
  for (const d of 细节结果.data || []) {
    const list = 细节按项目.get(d.item_id) || [];
    list.push({
      id: d.id,
      name: d.name,
      description: d.description,
      guide_images: d.guide_images || [],
      score_value: d.score_value,
    });
    细节按项目.set(d.item_id, list);
  }

  /* 评论数按记录分组 */
  const 评论数 = new Map<string, number>();
  for (const c of 评论结果.data || []) {
    评论数.set(c.check_record_id, (评论数.get(c.check_record_id) || 0) + 1);
  }

  const mapped: 考核记录视图[] = 记录列表.map((r) => {
    const task = 取单((r as { behavior_check_tasks: 嵌套任务 | null }).behavior_check_tasks);
    const item = 取单(task?.behavior_score_items);
    const responsible = 取单(item?.responsible);
    const checker = 取单(item?.checker);
    const employee = 取单((r as { employee: { full_name: string }[] | { full_name: string } | null }).employee);
    return {
      id: r.id,
      task_id: r.task_id,
      item_id: task?.item_id || "",
      checker_id: r.checker_id,
      employee_id: r.employee_id,
      check_date: r.check_date,
      status: r.status,
      score_record_id: r.score_record_id,
      detail_results: (r.detail_results as 考核记录视图["detail_results"]) || [],
      task_name: task?.name || "",
      execute_time: task?.execute_time || "00:00",
      end_time: task?.end_time || "23:59",
      item_name: item?.name || "",
      item_score: item?.score_value || 0,
      item_score_type: item?.score_type || "bonus",
      item_description: item?.description || null,
      responsible_name: responsible?.full_name || employee?.full_name || "",
      checker_name: checker?.full_name || "",
      employee_name: employee?.full_name || "",
      details: 细节按项目.get(task?.item_id || "") || [],
      comment_count: 评论数.get(r.id) || 0,
    };
  });

  return <BehaviorChecksContent initialRecords={mapped} currentUserId={uid} />;
}

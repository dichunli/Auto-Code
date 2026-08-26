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
  responsible_ids: string[] | null;
  checker_ids: string[] | null;
  guide_images: string[] | null;
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

/* 懒生成今日考核记录（先查后插 + 忽略唯一冲突，约束上线前后都安全） */
async function 懒生成今日记录(
  supabase: Awaited<ReturnType<typeof createClient>>,
  uid: string,
  today: string
): Promise<void> {
  const { data: taskData } = await supabase
    .from("behavior_check_tasks")
    .select("*, behavior_score_items(id, name, score_type, score_value, description, responsible_ids, checker_ids, guide_images)")
    .eq("is_active", true);

  const todayTasks = 过滤今日任务((taskData || []) as 嵌套任务[]);

  for (const task of todayTasks) {
    const item = 取单(task.behavior_score_items);

    if (item?.responsible_ids && item.responsible_ids.length > 0) {
      /* 责任人模式：每个责任人各生成一条记录（各自被考核）。
       * 应检查人集合=配置的检查人（空=该责任人自检）。
       * 责任人本人（要自检上报）或检查人（要核查）打开页面都会触发生成 */
      for (const 责任人 of item.responsible_ids) {
        const 应检查人集合 = item.checker_ids && item.checker_ids.length > 0 ? item.checker_ids : [责任人];
        if (uid !== 责任人 && !应检查人集合.includes(uid)) continue;

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
          /* 23505 = 唯一约束冲突（两台设备同时打开页面），忽略即可 */
          if (error && error.code !== "23505") {
            console.error("生成今日考核记录失败:", error.message);
          }
        }
      }
    } else {
      /* 旧模式：任务 employee_ids 空=全员，否则只给名单内的人生成；本人自检 */
      if (task.employee_ids && task.employee_ids.length > 0 && !task.employee_ids.includes(uid)) continue;

      const { data: existing } = await supabase
        .from("behavior_check_records")
        .select("id")
        .eq("task_id", task.id)
        .eq("employee_id", uid)
        .eq("check_date", today)
        .maybeSingle();

      if (!existing) {
        const { error } = await supabase.from("behavior_check_records").insert({
          task_id: task.id,
          employee_id: uid,
          checker_ids: [uid],
          check_date: today,
          status: "pending",
        });
        if (error && error.code !== "23505") {
          console.error("生成今日考核记录失败:", error.message);
        }
      }
    }
  }
}

/* 首屏数据在服务端查询（客户端 useEffect 加载会闪空白） */
export default async function BehaviorChecksPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return <BehaviorChecksContent initialRecords={[]} initialCount={0} currentUserId="" />;
  }
  const uid = userData.user.id;
  const today = 本地今日字符串();

  await 懒生成今日记录(supabase, uid, today);

  /* 查今天"待我检查"（checker_ids 含我）或"考核我的"（employee_id=我）的记录；
   * checker_ids 为空数组的旧记录走 employee_id=我 命中（自检语义）；
   * 首屏只取第一页（20 条）+ 总数 */
  const { data, count } = await supabase
    .from("behavior_check_records")
    .select("*, employee:profiles!behavior_check_records_employee_id_fkey(full_name), behavior_check_tasks(name, execute_time, end_time, item_id, behavior_score_items(id, name, score_type, score_value, description, responsible_ids, checker_ids, guide_images))", { count: "exact" })
    .eq("check_date", today)
    .or(`checker_ids.cs.["${uid}"],employee_id.eq.${uid}`)
    .order("created_at", { ascending: true })
    .range(0, 19);

  const 记录列表 = data || [];

  /* 并行补查：涉及项目的检查细节 + 记录的评论数 + 员工姓名表（多选 id 数组无法 join，客户端拼接） */
  const itemIds = [...new Set(记录列表.map((r) => 取单((r as { behavior_check_tasks: 嵌套任务 | null }).behavior_check_tasks)?.item_id).filter(Boolean))] as string[];
  const recordIds = 记录列表.map((r) => r.id);

  const [细节结果, 评论结果, 员工结果] = await Promise.all([
    itemIds.length > 0
      ? supabase.from("behavior_item_details").select("*").in("item_id", itemIds).order("sort_order", { ascending: true }).order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),
    recordIds.length > 0
      ? supabase.from("behavior_check_comments").select("check_record_id").in("check_record_id", recordIds)
      : Promise.resolve({ data: [] }),
    supabase.from("profiles").select("id, full_name"),
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

  const 姓名表 = new Map((员工结果.data || []).map((e) => [e.id, e.full_name]));
  const 姓名拼接 = (ids: string[]) => ids.map((id) => 姓名表.get(id) || "?").join("、");

  const mapped: 考核记录视图[] = 记录列表.map((r) => {
    const task = 取单((r as { behavior_check_tasks: 嵌套任务 | null }).behavior_check_tasks);
    const item = 取单(task?.behavior_score_items);
    const employee = 取单((r as { employee: { full_name: string }[] | { full_name: string } | null }).employee);
    const checker_ids = (r.checker_ids as string[] | null) || [];
    return {
      id: r.id,
      task_id: r.task_id,
      item_id: task?.item_id || "",
      checker_ids,
      employee_id: r.employee_id,
      check_date: r.check_date,
      status: r.status,
      score_record_id: r.score_record_id,
      review_score_record_id: r.review_score_record_id,
      detail_results: (r.detail_results as 考核记录视图["detail_results"]) || [],
      self_report_photos: (r.self_report_photos as string[] | null) || [],
      self_report_note: r.self_report_note,
      self_reported_at: r.self_reported_at,
      task_name: task?.name || "",
      execute_time: task?.execute_time || "00:00",
      end_time: task?.end_time || "23:59",
      item_name: item?.name || "",
      item_score: item?.score_value || 0,
      item_score_type: item?.score_type || "bonus",
      item_description: item?.description || null,
      item_guide_images: (item?.guide_images as string[] | null) || [],
      checker_names: 姓名拼接(checker_ids),
      employee_name: employee?.full_name || "",
      details: 细节按项目.get(task?.item_id || "") || [],
      comment_count: 评论数.get(r.id) || 0,
    };
  });

  return <BehaviorChecksContent initialRecords={mapped} initialCount={count || 0} currentUserId={uid} />;
}

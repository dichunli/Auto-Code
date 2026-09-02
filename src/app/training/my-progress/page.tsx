import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MyProgressContent from "./MyProgressContent";

interface 课程分配 {
  id: string;
  course_title: string;
  category: string;
  status: string;
  score: number | null;
  due_date: string | null;
  points: number;
}

interface 考试记录 {
  id: string;
  course_title: string;
  total_score: number;
  max_score: number;
  status: string;
  exam_count: number;
  created_at: string;
}

interface 行为记录 {
  id: string;
  item_name: string;
  score: number;
  scored_at: string;
}

interface 返工记录 {
  id: string;
  description: string;
  loss_amount: number;
  recorded_at: string;
}

interface 损失记录 {
  id: string;
  loss_type: string;
  description: string;
  loss_amount: number;
  recorded_at: string;
}

/* 首屏数据在服务端查询（原客户端 useEffect 加载会闪空白），
 * 本页为纯展示，无增删改，无客户端重查 */
export default async function MyProgressPage() {
  const supabase = await createClient();
  const { data: sessionData } = await supabase.auth.getSession();
    const userData = { user: sessionData.session?.user ?? null }; /* getSession本地读不联网（2026-09-03） */
  if (!userData.user) {
    redirect("/login");
  }
  const userId = userData.user.id;

  /* 1. 课程分配 */
  const { data: assignData } = await supabase
    .from("training_assignments")
    .select("id, status, score, due_date, training_courses(id, title, category, points)")
    .eq("employee_id", userId)
    .order("created_at", { ascending: false });

  const courses: 课程分配[] = (assignData || []).map((a: unknown) => {
    const rec = a as {
      id: string;
      status: string;
      score: number | null;
      due_date: string | null;
      training_courses: { title: string; category: string; points: number }[] | { title: string; category: string; points: number } | null;
    };
    const course = Array.isArray(rec.training_courses) ? rec.training_courses[0] : rec.training_courses;
    return {
      id: rec.id,
      course_title: course?.title || "",
      category: course?.category || "",
      status: rec.status,
      score: rec.score,
      due_date: rec.due_date,
      points: course?.points || 0,
    };
  });

  /* 2. 考试记录 */
  const { data: examData } = await supabase
    .from("exam_results")
    .select("id, total_score, max_score, status, exam_count, created_at, training_courses(title)")
    .eq("employee_id", userId)
    .order("created_at", { ascending: false });

  const exams: 考试记录[] = (examData || []).map((e: unknown) => {
    const rec = e as {
      id: string;
      total_score: number;
      max_score: number;
      status: string;
      exam_count: number;
      created_at: string;
      training_courses: { title: string }[] | { title: string } | null;
    };
    const course = Array.isArray(rec.training_courses) ? rec.training_courses[0] : rec.training_courses;
    return {
      id: rec.id,
      course_title: course?.title || "",
      total_score: rec.total_score,
      max_score: rec.max_score,
      status: rec.status,
      exam_count: rec.exam_count,
      created_at: rec.created_at,
    };
  });

  /* 3. 行为规范记录（最近30条） */
  const { data: behaviorData } = await supabase
    .from("behavior_score_records")
    .select("id, score, scored_at, behavior_score_items(name)")
    .eq("employee_id", userId)
    .order("scored_at", { ascending: false })
    .limit(30);

  const behaviors: 行为记录[] = (behaviorData || []).map((b: unknown) => {
    const rec = b as {
      id: string;
      score: number;
      scored_at: string;
      behavior_score_items: { name: string }[] | { name: string } | null;
    };
    const item = Array.isArray(rec.behavior_score_items) ? rec.behavior_score_items[0] : rec.behavior_score_items;
    return {
      id: rec.id,
      item_name: item?.name || "",
      score: rec.score,
      scored_at: rec.scored_at,
    };
  });

  /* 4. 返工记录 */
  const { data: reworkData } = await supabase
    .from("rework_records")
    .select("id, description, loss_amount, recorded_at")
    .eq("employee_id", userId)
    .order("recorded_at", { ascending: false })
    .limit(20);

  const reworks: 返工记录[] = (reworkData || []).map((r: unknown) => {
    const rec = r as { id: string; description: string; loss_amount: number; recorded_at: string };
    return { id: rec.id, description: rec.description, loss_amount: rec.loss_amount, recorded_at: rec.recorded_at };
  });

  /* 5. 日常损失记录 */
  const { data: lossData } = await supabase
    .from("daily_loss_records")
    .select("id, loss_type, description, loss_amount, recorded_at")
    .eq("employee_id", userId)
    .order("recorded_at", { ascending: false })
    .limit(20);

  const losses: 损失记录[] = (lossData || []).map((l: unknown) => {
    const rec = l as { id: string; loss_type: string; description: string; loss_amount: number; recorded_at: string };
    return { id: rec.id, loss_type: rec.loss_type, description: rec.description, loss_amount: rec.loss_amount, recorded_at: rec.recorded_at };
  });

  return (
    <MyProgressContent
      initialCourses={courses}
      initialExams={exams}
      initialBehaviors={behaviors}
      initialReworks={reworks}
      initialLosses={losses}
    />
  );
}

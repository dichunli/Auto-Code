import { createClient } from "@/lib/supabase/server";
import ExamManageContent from "./ExamManageContent";

interface 考题 {
  id: string;
  question_type: string;
  question_text: string;
  options: { label: string; text: string }[];
  correct_answer: string | null;
  score: number;
  sort_order: number;
}

/* 首屏数据在服务端查询（原客户端 useEffect 加载会闪空白），
 * 切换课程后的客户端重查逻辑在 ExamManageContent 内保持不变 */
export default async function ExamManagePage({
  searchParams,
}: {
  searchParams: Promise<{ courseId?: string }>;
}) {
  const { courseId } = await searchParams;
  const supabase = await createClient();

  const { data: courses } = await supabase
    .from("training_courses")
    .select("id, title")
    .eq("has_exam", true)
    .order("created_at", { ascending: false });

  let questions: 考题[] = [];
  if (courseId) {
    const { data } = await supabase
      .from("exam_questions")
      .select("*")
      .eq("course_id", courseId)
      .order("sort_order", { ascending: true });
    questions = (data as 考题[] || []).map((q: 考题) => ({ ...q, options: (q.options as { label: string; text: string }[]) || [] }));
  }

  return (
    <ExamManageContent
      initialCourses={courses || []}
      initialCourseId={courseId || ""}
      initialQuestions={questions}
    />
  );
}

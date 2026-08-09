import { createClient } from "@/lib/supabase/server";
import ExamGradeContent from "./ExamGradeContent";

interface 待判卷答题 {
  id: string;
  answer_text: string | null;
  score: number;
  max_score: number;
  graded_score: string;
  question_text: string;
  employee_name: string;
  course_title: string;
  exam_result_id: string;
}

/* 首屏数据在服务端查询（原客户端 useEffect 加载会闪空白），
 * 判卷写操作逻辑在 ExamGradeContent 内保持不变 */
export default async function ExamGradePage() {
  const supabase = await createClient();

  /* 查询所有简答题答题记录（待判卷：is_correct IS NULL） */
  const { data: answers } = await supabase
    .from("exam_answers")
    .select(`
      id,
      answer_text,
      score,
      question_id,
      employee_id,
      exam_results!inner(id, max_score, course_id)
    `)
    .is("is_correct", null)
    .eq("exam_questions.question_type", "essay");

  let list: 待判卷答题[] = [];

  if (answers && answers.length > 0) {
    /* 定义 Supabase 查询结果类型 */
    type 答题记录 = { id: string; answer_text: string | null; score: number; question_id: string; employee_id: string; exam_results: { id: string; max_score: number; course_id: string }[] };
    type 题目记录 = { id: string; question_text: string; score: number };
    type 员工记录 = { id: string; full_name: string };
    type 课程记录 = { id: string; title: string };

    const typedAnswers = answers as 答题记录[];

    /* 获取题目信息 */
    const questionIds = [...new Set(typedAnswers.map((a: 答题记录) => a.question_id))];
    const { data: questions } = await supabase
      .from("exam_questions")
      .select("id, question_text, score")
      .in("id", questionIds);

    const questionMap = new Map<string, { question_text: string; score: number }>();
    (questions as 题目记录[] | null)?.forEach((q: 题目记录) => questionMap.set(q.id, { question_text: q.question_text, score: q.score }));

    /* 获取员工信息 */
    const employeeIds = [...new Set(typedAnswers.map((a: 答题记录) => a.employee_id))];
    const { data: employees } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", employeeIds);

    const employeeMap = new Map<string, string>();
    (employees as 员工记录[] | null)?.forEach((e: 员工记录) => employeeMap.set(e.id, e.full_name));

    /* 获取课程信息 */
    const courseIds = [...new Set(typedAnswers.map((a: 答题记录) => a.exam_results[0]?.course_id).filter(Boolean))];
    const { data: courses } = await supabase
      .from("training_courses")
      .select("id, title")
      .in("id", courseIds);

    const courseMap = new Map<string, string>();
    (courses as 课程记录[] | null)?.forEach((c: 课程记录) => courseMap.set(c.id, c.title));

    list = typedAnswers.map((a: 答题记录) => {
      const q = questionMap.get(a.question_id);
      const examResult = a.exam_results[0];
      return {
        id: a.id,
        answer_text: a.answer_text,
        score: a.score,
        max_score: q?.score || 0,
        graded_score: "",
        question_text: q?.question_text || "",
        employee_name: employeeMap.get(a.employee_id) || "未知",
        course_title: courseMap.get(examResult?.course_id) || "",
        exam_result_id: examResult?.id || "",
      };
    });
  }

  return <ExamGradeContent initialPending={list} />;
}

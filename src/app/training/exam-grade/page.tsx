"use client";

import {useState, useEffect, useMemo} from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";

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

export default function ExamGradePage() {
  const supabase = useMemo(() => createClient(), []);
  const [pendingList, setPendingList] = useState<待判卷答题[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function fetchPending() {
    setLoading(true);

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

    if (!answers || answers.length === 0) {
      setPendingList([]);
      setLoading(false);
      return;
    }

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

    const list: 待判卷答题[] = typedAnswers.map((a: 答题记录) => {
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

    setPendingList(list);
    setLoading(false);
  }

  useEffect(() => {
    fetchPending();
  }, [supabase]);

  async function handleGrade(item: 待判卷答题, gradedScore: number) {
    if (gradedScore < 0 || gradedScore > item.max_score) {
      alert(`分数必须在 0-${item.max_score} 之间`);
      return;
    }

    setSavingId(item.id);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const graderId = userData.user?.id;

      /* 更新答题记录 */
      const { error: answerError } = await supabase
        .from("exam_answers")
        .update({
          score: gradedScore,
          is_correct: gradedScore > 0,
          graded_by: graderId,
          graded_at: new Date().toISOString(),
        })
        .eq("id", item.id);

      if (answerError) throw answerError;

      /* 重新计算考试总分 */
      await supabase
        .from("exam_answers")
        .select("score, is_correct")
        .eq("assignment_id", item.exam_result_id);

      /* 获取考试成绩记录 */
      const { data: resultRecord } = await supabase
        .from("exam_results")
        .select("assignment_id, total_score, max_score")
        .eq("id", item.exam_result_id)
        .single();

      if (resultRecord) {
        /* 查询该考试所有答题记录（按 assignment_id） */
        const { data: examAnswers } = await supabase
          .from("exam_answers")
          .select("score")
          .eq("assignment_id", resultRecord.assignment_id);

        const newTotal = (examAnswers || []).reduce((sum: number, a: { score: number | null }) => sum + (a.score || 0), 0);

        /* 检查是否还有未判卷的题 */
        const { data: pendingAnswers } = await supabase
          .from("exam_answers")
          .select("id")
          .eq("assignment_id", resultRecord.assignment_id)
          .is("is_correct", null);

        const newStatus = pendingAnswers && pendingAnswers.length > 0 ? "pending" : newTotal >= (resultRecord.max_score * 0.6) ? "passed" : "failed";

        await supabase
          .from("exam_results")
          .update({
            total_score: newTotal,
            status: newStatus,
          })
          .eq("id", item.exam_result_id);

        /* 如果全部判完且通过，更新分配记录 */
        if (newStatus === "passed") {
          await supabase
            .from("training_assignments")
            .update({
              status: "completed",
              score: newTotal,
              completed_at: new Date().toISOString(),
            })
            .eq("id", resultRecord.assignment_id);
        }
      }

      /* 刷新列表 */
      setPendingList(pendingList.filter((p) => p.id !== item.id));
    } catch (err: unknown) {
      alert("判卷失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="简答题判卷"
        description="批改员工简答题答卷"
      />

      {loading ? (
        <div className="p-8 text-center text-gray-400">加载中...</div>
      ) : pendingList.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-500">暂无待判卷的简答题</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pendingList.map((item) => (
            <div key={item.id} className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">{item.employee_name}</span>
                  <span className="text-xs text-gray-400">{item.course_title}</span>
                </div>
                <span className="text-xs px-2 py-0.5 rounded bg-yellow-50 text-yellow-700 border border-yellow-200">
                  待判卷
                </span>
              </div>

              <div className="mb-3">
                <p className="text-sm font-medium text-gray-800 mb-1">题目：</p>
                <p className="text-sm text-gray-600">{item.question_text}</p>
              </div>

              <div className="mb-4 bg-gray-50 rounded-lg p-3">
                <p className="text-sm font-medium text-gray-800 mb-1">员工答案：</p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{item.answer_text || "未作答"}</p>
              </div>

              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-700">打分：</label>
                <input
                  type="number"
                  min={0}
                  max={item.max_score}
                  value={item.graded_score}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPendingList(
                      pendingList.map((p) => (p.id === item.id ? { ...p, graded_score: val } : p))
                    );
                  }}
                  className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder={`0-${item.max_score}`}
                />
                <span className="text-sm text-gray-500">/ {item.max_score} 分</span>
                <button
                  onClick={() => handleGrade(item, parseInt(item.graded_score) || 0)}
                  disabled={savingId === item.id || item.graded_score === ""}
                  className="ml-auto px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingId === item.id ? "保存中..." : "确认打分"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

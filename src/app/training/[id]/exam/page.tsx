"use client";

import {useState, useEffect, useMemo} from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { 提交考试 } from "../../actions";
import { PageHeader } from "@/components/PageHeader";
import { useConfirm } from "@/components/ConfirmDialog";

interface 考题 {
  id: string;
  question_type: string;
  question_text: string;
  options: { label: string; text: string }[];
  correct_answer: string | null;
  score: number;
}

interface 分配记录 {
  id: string;
  status: string;
  score: number | null;
}

export default function ExamPage() {
  const router = useRouter();
  const params = useParams();
  const courseId = params.id as string;
  const supabase = useMemo(() => createClient(), []);

  const [courseTitle, setCourseTitle] = useState("");
  /* 通过分数线：仅用于提交后的提示文案（真实判定在服务端） */
  const [passingScore, setPassingScore] = useState(60);
  const [questions, setQuestions] = useState<考题[]>([]);
  const [assignment, setAssignment] = useState<分配记录 | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const { 请求确认, 确认弹窗 } = useConfirm();

  /* 答题状态 */
  const [answers, setAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    async function init() {
      /* 获取当前用户 */
      const { data: sessionData } = await supabase.auth.getSession();
    const userData = { user: sessionData.session?.user ?? null }; /* getSession本地读不联网（2026-09-03） */
      if (!userData.user) {
        alert("请先登录");
        router.push("/login");
        return;
      }

      /* 查询课程信息 */
      const { data: course } = await supabase
        .from("training_courses")
        .select("title, has_exam, exam_mode, passing_score")
        .eq("id", courseId)
        .single();

      if (!course) {
        alert("课程不存在");
        router.push("/training");
        return;
      }

      setCourseTitle(course.title);
      if (course.passing_score) setPassingScore(course.passing_score);

      if (!course.has_exam) {
        alert("该课程不包含考试");
        router.push(`/training/${courseId}`);
        return;
      }

      if (course.exam_mode === "offline") {
        alert("该课程为线下考试，请在课程详情页查看考试安排");
        router.push(`/training/${courseId}`);
        return;
      }

      /* 查询分配记录 */
      const { data: assignData } = await supabase
        .from("training_assignments")
        .select("id, status, score")
        .eq("course_id", courseId)
        .eq("employee_id", userData.user.id)
        .single();

      if (!assignData) {
        alert("您未被分配该课程，无法参加考试");
        router.push(`/training/${courseId}`);
        return;
      }

      setAssignment(assignData);

      /* 查询考题 */
      const { data: questionData } = await supabase
        .from("exam_questions")
        .select("*")
        .eq("course_id", courseId)
        .order("sort_order", { ascending: true });

      if (!questionData || questionData.length === 0) {
        alert("该课程暂未添加考题");
        router.push(`/training/${courseId}`);
        return;
      }

      setQuestions(
        (questionData as 考题[]).map((q: 考题) => ({
          ...q,
          options: (q.options as { label: string; text: string }[]) || [],
        }))
      );

      setLoading(false);
    }
    init();
  }, [courseId, router, supabase]);

  function handleSingleChoice(questionId: string, label: string) {
    setAnswers({ ...answers, [questionId]: label });
  }

  function handleMultipleChoice(questionId: string, label: string, checked: boolean) {
    const current = answers[questionId] || "";
    const selected = current.split(",").filter(Boolean);
    if (checked) {
      selected.push(label);
    } else {
      const idx = selected.indexOf(label);
      if (idx > -1) selected.splice(idx, 1);
    }
    /* 按字母顺序排序 */
    selected.sort();
    setAnswers({ ...answers, [questionId]: selected.join(",") });
  }

  function handleEssay(questionId: string, text: string) {
    setAnswers({ ...answers, [questionId]: text });
  }

  async function handleSubmit() {
    /* 检查是否全部作答 */
    const unanswered = questions.filter((q) => !answers[q.id]?.trim());
    if (unanswered.length > 0) {
      if (!(await 请求确认(`还有 ${unanswered.length} 道题未作答，确定提交吗？`))) return;
    }

    if (!assignment) return;
    setSubmitting(true);

    try {
      /* 逐题判卷（客观题判分在客户端做，需要题目数据；写库走 Server Action） */
      let totalScore = 0;
      let maxScore = 0;
      let hasEssay = false;
      const answerRecords: { question_id: string; answer_text: string | null; is_correct: boolean | null; score: number }[] = [];

      for (const q of questions) {
        maxScore += q.score;
        const userAnswer = answers[q.id] || "";
        let isCorrect: boolean | null = null;
        let score = 0;

        if (q.question_type === "single_choice") {
          isCorrect = userAnswer.trim().toUpperCase() === (q.correct_answer || "").trim().toUpperCase();
          score = isCorrect ? q.score : 0;
          totalScore += score;
        } else if (q.question_type === "multiple_choice") {
          const userSelected = userAnswer
            .split(",")
            .map((s: string) => s.trim().toUpperCase())
            .filter(Boolean)
            .sort()
            .join(",");
          const correctSelected = (q.correct_answer || "")
            .split(",")
            .map((s: string) => s.trim().toUpperCase())
            .filter(Boolean)
            .sort()
            .join(",");
          isCorrect = userSelected === correctSelected;
          score = isCorrect ? q.score : 0;
          totalScore += score;
        } else if (q.question_type === "essay") {
          hasEssay = true;
          isCorrect = null; /* 简答题待人工判卷 */
          score = 0;
        }

        answerRecords.push({
          question_id: q.id,
          answer_text: userAnswer.trim() || null,
          is_correct: isCorrect,
          score,
        });
      }

      /* 写库走 Server Action：插答题 + 插成绩 + 更新分配，考生身份取服务端登录用户 */
      const 提交结果 = await 提交考试({
        assignmentId: assignment.id,
        courseId,
        hasEssay,
        totalScore,
        maxScore,
        answerRecords,
      });
      if (!提交结果.success) throw new Error(提交结果.error || "提交失败");
      const status = 提交结果.status || "pending";

      if (hasEssay) {
        alert(`试卷已提交，包含简答题待人工判卷。客观题得分: ${totalScore}/${maxScore}`);
      } else if (status === "passed") {
        alert(`恭喜通过考试！得分: ${totalScore}/${maxScore}`);
      } else {
        alert(`未通过考试，得分: ${totalScore}/${maxScore}，通过分数: ${passingScore}`);
      }

      router.push(`/training/${courseId}`);
      router.refresh();
    } catch (err: unknown) {
      alert("提交失败: " + (err instanceof Error ? err.message : String(err)));
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="在线考试" />
        <div className="p-8 text-center text-gray-400">加载中...</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={`在线考试 - ${courseTitle}`} />

      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-3xl space-y-6">
        {questions.map((q, index) => (
          <div key={q.id} className="border-b border-gray-100 pb-6 last:border-0">
            <div className="flex items-start gap-2 mb-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs flex items-center justify-center font-medium">
                {index + 1}
              </span>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">{q.question_text}</p>
                <span className="text-xs text-gray-400">{q.score} 分</span>
              </div>
            </div>

            {/* 单选题 */}
            {q.question_type === "single_choice" && (
              <div className="ml-8 space-y-2">
                {q.options.map((opt) => (
                  <label
                    key={opt.label}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      answers[q.id] === opt.label
                        ? "border-blue-300 bg-blue-50"
                        : "border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`question_${q.id}`}
                      value={opt.label}
                      checked={answers[q.id] === opt.label}
                      onChange={() => handleSingleChoice(q.id, opt.label)}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="text-sm text-gray-700">
                      {opt.label}. {opt.text}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {/* 多选题 */}
            {q.question_type === "multiple_choice" && (
              <div className="ml-8 space-y-2">
                {q.options.map((opt) => {
                  const selected = (answers[q.id] || "").split(",").includes(opt.label);
                  return (
                    <label
                      key={opt.label}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        selected
                          ? "border-blue-300 bg-blue-50"
                          : "border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(e) => handleMultipleChoice(q.id, opt.label, e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded"
                      />
                      <span className="text-sm text-gray-700">
                        {opt.label}. {opt.text}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            {/* 简答题 */}
            {q.question_type === "essay" && (
              <div className="ml-8">
                <textarea
                  rows={4}
                  value={answers[q.id] || ""}
                  onChange={(e) => handleEssay(q.id, e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="请输入您的答案..."
                />
              </div>
            )}
          </div>
        ))}

        <div className="flex gap-3 justify-end pt-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            返回
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "提交中..." : "提交试卷"}
          </button>
        </div>
      </div>
      {确认弹窗}
    </div>
  );
}

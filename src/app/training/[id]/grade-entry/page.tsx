"use client";

import {useState, useEffect, useMemo} from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { 录入成绩 } from "../../actions";
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

interface 学员 {
  id: string;
  employee_id: string;
  profiles: { full_name: string } | null;
}

interface 答题记录 {
  question_id: string;
  answer_text: string;
  score: string;
  is_correct: boolean | null;
}

export default function GradeEntryPage() {
  const router = useRouter();
  const params = useParams();
  const courseId = params.id as string;
  const supabase = useMemo(() => createClient(), []);

  const [courseTitle, setCourseTitle] = useState("");
  const [passingScore, setPassingScore] = useState(60);
  const [questions, setQuestions] = useState<考题[]>([]);
  const [students, setStudents] = useState<学员[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [answers, setAnswers] = useState<Record<string, 答题记录>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const { 请求确认, 确认弹窗 } = useConfirm();

  useEffect(() => {
    async function init() {
      /* 查询课程信息 */
      const { data: course } = await supabase
        .from("training_courses")
        .select("title, passing_score, exam_mode")
        .eq("id", courseId)
        .single();

      if (!course) {
        alert("课程不存在");
        router.push("/training");
        return;
      }

      if (course.exam_mode !== "offline") {
        alert("该课程不是线下考试");
        router.push(`/training/${courseId}`);
        return;
      }

      setCourseTitle(course.title);
      setPassingScore(course.passing_score || 60);

      /* 查询考题 */
      const { data: questionData } = await supabase
        .from("exam_questions")
        .select("*")
        .eq("course_id", courseId)
        .order("sort_order", { ascending: true });

      const parsedQuestions = (questionData || []).map((q) => ({
        ...q,
        options: (q.options as { label: string; text: string }[]) || [],
      })) as 考题[];

      setQuestions(parsedQuestions);

      /* 初始化答题记录 */
      const initialAnswers: Record<string, 答题记录> = {};
      parsedQuestions.forEach((q) => {
        initialAnswers[q.id] = {
          question_id: q.id,
          answer_text: "",
          score: "",
          is_correct: null,
        };
      });
      setAnswers(initialAnswers);

      /* 查询已分配学员（排除已有成绩的） */
      const { data: assignData } = await supabase
        .from("training_assignments")
        .select("id, employee_id, profiles!training_assignments_employee_id_fkey(full_name)")
        .eq("course_id", courseId)
        .order("created_at", { ascending: false });

      /* 查询已有成绩的 assignment_id */
      const assignmentIds = (assignData || []).map((a) => a.id);
      let gradedIds = new Set<string>();
      if (assignmentIds.length > 0) {
        const { data: results } = await supabase
          .from("exam_results")
          .select("assignment_id")
          .in("assignment_id", assignmentIds)
          .neq("status", "failed"); /* 未通过的可以重新录入 */
        gradedIds = new Set((results || []).map((r) => r.assignment_id));
      }

      const availableStudents = (assignData || []).filter((a) => !gradedIds.has(a.id)) as unknown as 学员[];
      setStudents(availableStudents);

      setLoading(false);
    }
    init();
  }, [courseId, router, supabase]);

  /* 自动计算客观题得分 */
  function autoScore(questionId: string, answerText: string) {
    const q = questions.find((q) => q.id === questionId);
    if (!q) return;

    if (q.question_type === "single_choice") {
      const isCorrect = answerText.trim().toUpperCase() === (q.correct_answer || "").trim().toUpperCase();
      setAnswers((prev) => ({
        ...prev,
        [questionId]: {
          ...prev[questionId],
          answer_text: answerText,
          score: isCorrect ? String(q.score) : "0",
          is_correct: isCorrect,
        },
      }));
    } else if (q.question_type === "multiple_choice") {
      const userSelected = answerText
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
        .sort()
        .join(",");
      const correctSelected = (q.correct_answer || "")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
        .sort()
        .join(",");
      const isCorrect = userSelected === correctSelected;
      setAnswers((prev) => ({
        ...prev,
        [questionId]: {
          ...prev[questionId],
          answer_text: answerText,
          score: isCorrect ? String(q.score) : "0",
          is_correct: isCorrect,
        },
      }));
    } else {
      setAnswers((prev) => ({
        ...prev,
        [questionId]: {
          ...prev[questionId],
          answer_text: answerText,
        },
      }));
    }
  }

  function updateScore(questionId: string, score: string) {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: {
        ...prev[questionId],
        score,
      },
    }));
  }

  const totalScore = questions.reduce((sum, q) => {
    const score = parseFloat(answers[q.id]?.score || "0");
    return sum + (isNaN(score) ? 0 : score);
  }, 0);

  const maxScore = questions.reduce((sum, q) => sum + q.score, 0);

  async function handleSubmit() {
    if (!selectedStudentId) {
      alert("请选择学员");
      return;
    }

    const student = students.find((s) => s.id === selectedStudentId);
    if (!student) {
      alert("学员信息错误");
      return;
    }

    /* 检查是否全部录入 */
    const unanswered = questions.filter((q) => !answers[q.id]?.score.trim());
    if (unanswered.length > 0) {
      if (!(await 请求确认(`还有 ${unanswered.length} 道题未录入得分，确定提交吗？`))) return;
    }

    setSubmitting(true);

    try {
      /* 逐题构建答题记录（判分人由服务端取登录用户） */
      const answerRecords: { question_id: string; answer_text: string | null; is_correct: boolean | null; score: number }[] = [];

      for (const q of questions) {
        const ans = answers[q.id];
        const score = parseFloat(ans.score || "0") || 0;
        let isCorrect: boolean | null = ans.is_correct;

        if (q.question_type === "essay") {
          isCorrect = score >= q.score ? true : score > 0 ? true : false; /* 简答题有分就算对 */
        } else if (q.question_type === "scoring") {
          isCorrect = score > 0 ? true : null; /* 评分项不判断对错 */
        }

        answerRecords.push({
          question_id: q.id,
          answer_text: ans.answer_text.trim() || null,
          is_correct: isCorrect,
          score,
        });
      }

      /* 写库走 Server Action：插答题 + 插成绩 + 更新分配 */
      const 录入结果 = await 录入成绩({
        assignmentId: selectedStudentId,
        courseId,
        employeeId: student.employee_id,
        totalScore,
        maxScore,
        passingScore,
        answerRecords,
      });
      if (!录入结果.success) throw new Error(录入结果.error || "录入失败");
      const status = 录入结果.status || "failed";

      alert(`成绩录入完成！${student.profiles?.full_name}: ${totalScore}/${maxScore} 分，${status === "passed" ? "通过" : "未通过"}`);
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
        <PageHeader title="成绩录入" />
        <div className="p-8 text-center text-gray-400">加载中...</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={`成绩录入 - ${courseTitle}`} />

      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-3xl space-y-6">
        {/* 学员选择 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">选择学员 *</label>
          <select
            value={selectedStudentId}
            onChange={(e) => setSelectedStudentId(e.target.value)}
            className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="">请选择学员</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.profiles?.full_name}
              </option>
            ))}
          </select>
          {students.length === 0 && (
            <p className="text-xs text-gray-400 mt-1">所有学员成绩已录入完毕</p>
          )}
        </div>

        {/* 考题列表 */}
        {questions.length === 0 ? (
          <div className="p-8 text-center text-gray-400">该课程暂未添加考题</div>
        ) : (
          <div className="space-y-6">
            {questions.map((q, index) => (
              <div key={q.id} className="border-b border-gray-100 pb-6 last:border-0">
                <div className="flex items-start gap-2 mb-3">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs flex items-center justify-center font-medium">
                    {index + 1}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">{q.question_text}</p>
                    <span className="text-xs text-gray-400">
                      {q.question_type === "single_choice" && "单选题"}
                      {q.question_type === "multiple_choice" && "多选题"}
                      {q.question_type === "essay" && "简答题"}
                      {q.question_type === "scoring" && "评分项"}
                      {" / "}{q.score} 分
                    </span>
                  </div>
                </div>

                {/* 选项显示（仅选择题） */}
                {(q.question_type === "single_choice" || q.question_type === "multiple_choice") && q.options.length > 0 && (
                  <div className="ml-8 mb-3 space-y-1">
                    {q.options.map((opt) => (
                      <div key={opt.label} className="text-sm text-gray-600 flex items-center gap-2">
                        <span
                          className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                            q.correct_answer?.includes(opt.label)
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {opt.label}
                        </span>
                        <span>{opt.text}</span>
                      </div>
                    ))}
                    <p className="text-xs text-green-600 mt-1">正确答案: {q.correct_answer}</p>
                  </div>
                )}

                {/* 评分说明（评分项） */}
                {q.question_type === "scoring" && q.correct_answer && (
                  <div className="ml-8 mb-3">
                    <p className="text-xs text-gray-500">评分说明: {q.correct_answer}</p>
                  </div>
                )}

                {/* 答案输入 */}
                <div className="ml-8 space-y-3">
                  {(q.question_type === "single_choice" || q.question_type === "multiple_choice") && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">学员答案</label>
                      <input
                        value={answers[q.id]?.answer_text || ""}
                        onChange={(e) => autoScore(q.id, e.target.value)}
                        className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        placeholder={q.question_type === "single_choice" ? "如 A" : "如 A,B,C"}
                      />
                    </div>
                  )}

                  {q.question_type === "essay" && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">学员答案</label>
                      <textarea
                        rows={3}
                        value={answers[q.id]?.answer_text || ""}
                        onChange={(e) =>
                          setAnswers((prev) => ({
                            ...prev,
                            [q.id]: { ...prev[q.id], answer_text: e.target.value },
                          }))
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        placeholder="录入学员答案..."
                      />
                    </div>
                  )}

                  {/* 得分输入 */}
                  <div className="flex items-center gap-3">
                    <label className="text-xs font-medium text-gray-600">得分</label>
                    <input
                      type="number"
                      step="0.1"
                      value={answers[q.id]?.score || ""}
                      onChange={(e) => updateScore(q.id, e.target.value)}
                      className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      placeholder={`0-${q.score}`}
                    />
                    <span className="text-xs text-gray-400">/ {q.score} 分</span>
                  </div>
                </div>
              </div>
            ))}

            {/* 总分 */}
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <span className="text-sm font-medium text-gray-700">总分: </span>
                <span className={`text-lg font-bold ${totalScore >= passingScore ? "text-green-600" : "text-red-600"}`}>
                  {totalScore}
                </span>
                <span className="text-sm text-gray-500"> / {maxScore}</span>
              </div>
              <span className="text-xs text-gray-500">通过分数: {passingScore} 分</span>
            </div>

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
                disabled={submitting || !selectedStudentId}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? "提交中..." : "提交成绩"}
              </button>
            </div>
          </div>
        )}
      </div>
      {确认弹窗}
    </div>
  );
}

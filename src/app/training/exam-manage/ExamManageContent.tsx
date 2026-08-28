"use client";

import {useState, useEffect, useRef, useMemo} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { 保存考题, 删除考题 } from "../actions";
import { PageHeader } from "@/components/PageHeader";
import { useConfirm } from "@/components/ConfirmDialog";

interface 考题 {
  id: string;
  question_type: string;
  question_text: string;
  options: { label: string; text: string }[];
  correct_answer: string | null;
  score: number;
  sort_order: number;
}

interface 课程 {
  id: string;
  title: string;
}

export default function ExamManageContent({
  initialCourses,
  initialCourseId,
  initialQuestions,
}: {
  initialCourses: 课程[];
  initialCourseId: string;
  initialQuestions: 考题[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  /* 首屏数据由服务端传入；loading 仅用于切换课程后的客户端重查 */
  const [courses] = useState<课程[]>(initialCourses);
  const [selectedCourseId, setSelectedCourseId] = useState(initialCourseId);
  const [questions, setQuestions] = useState<考题[]>(initialQuestions);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { 请求确认, 确认弹窗 } = useConfirm();

  /* 弹窗状态 */
  const [modalOpen, setModalOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<考题 | null>(null);
  const [questionForm, setQuestionForm] = useState({
    question_type: "single_choice",
    question_text: "",
    options: [
      { label: "A", text: "" },
      { label: "B", text: "" },
    ],
    correct_answer: "",
    score: "10",
  });

  /* URL 前进/后退时：服务端重渲染带来新 props，同步进本地 state
   * （useState 初始值只在挂载时生效，不同步则显示旧课程数据） */
  useEffect(() => {
    setSelectedCourseId(initialCourseId);
    setQuestions(initialQuestions);
  }, [initialCourseId, initialQuestions]);

  /* 首屏题目已由服务端按 courseId 查好传入，此 useEffect 只在切换课程时重查 */
  const 已跳过首屏 = useRef(false);
  useEffect(() => {
    if (!已跳过首屏.current) {
      已跳过首屏.current = true;
      return;
    }
    if (!selectedCourseId) {
      setQuestions([]);
      return;
    }
    async function fetchQuestions() {
      setLoading(true);
      const { data } = await supabase
        .from("exam_questions")
        .select("*")
        .eq("course_id", selectedCourseId)
        .order("sort_order", { ascending: true });
      setQuestions((data as 考题[] || []).map((q: 考题) => ({ ...q, options: (q.options as { label: string; text: string }[]) || [] })));
      setLoading(false);
    }
    fetchQuestions();
  }, [selectedCourseId, supabase]);

  function openAddModal() {
    setEditingQuestion(null);
    setQuestionForm({
      question_type: "single_choice",
      question_text: "",
      options: [
        { label: "A", text: "" },
        { label: "B", text: "" },
      ],
      correct_answer: "",
      score: "10",
    });
    setModalOpen(true);
  }

  function openEditModal(q: 考题) {
    setEditingQuestion(q);
    setQuestionForm({
      question_type: q.question_type,
      question_text: q.question_text,
      options: q.options.length > 0 ? q.options : [
        { label: "A", text: "" },
        { label: "B", text: "" },
      ],
      correct_answer: q.correct_answer || "",
      score: String(q.score),
    });
    setModalOpen(true);
  }

  function addOption() {
    const labels = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const nextLabel = labels[questionForm.options.length] || String.fromCharCode(65 + questionForm.options.length);
    setQuestionForm({
      ...questionForm,
      options: [...questionForm.options, { label: nextLabel, text: "" }],
    });
  }

  function removeOption(index: number) {
    if (questionForm.options.length <= 2) {
      alert("至少需要两个选项");
      return;
    }
    const newOptions = questionForm.options.filter((_, i) => i !== index);
    /* 重新标记选项字母 */
    const labels = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const reindexed = newOptions.map((o, i) => ({ ...o, label: labels[i] || o.label }));
    setQuestionForm({ ...questionForm, options: reindexed });
  }

  function updateOption(index: number, text: string) {
    const next = [...questionForm.options];
    next[index] = { ...next[index], text };
    setQuestionForm({ ...questionForm, options: next });
  }

  async function handleSaveQuestion() {
    if (!selectedCourseId) return;
    if (!questionForm.question_text.trim()) {
      alert("请输入题目内容");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        course_id: selectedCourseId,
        question_type: questionForm.question_type,
        question_text: questionForm.question_text.trim(),
        options: questionForm.question_type === "essay" || questionForm.question_type === "scoring" ? [] : questionForm.options.filter((o) => o.text.trim()),
        correct_answer: questionForm.correct_answer.trim() || null,
        score: parseInt(questionForm.score) || 10,
        sort_order: editingQuestion ? editingQuestion.sort_order : questions.length,
      };

      /* 写库走 Server Action */
      const result = await 保存考题({ id: editingQuestion?.id || null, payload });
      if (!result.success) throw new Error(result.error || "保存失败");

      setModalOpen(false);
      /* 刷新题目列表 */
      const { data } = await supabase
        .from("exam_questions")
        .select("*")
        .eq("course_id", selectedCourseId)
        .order("sort_order", { ascending: true });
      setQuestions((data as 考题[] || []).map((q: 考题) => ({ ...q, options: (q.options as { label: string; text: string }[]) || [] })));
    } catch (err: unknown) {
      alert("保存失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteQuestion(id: string) {
    if (!(await 请求确认("确定删除这道题吗？"))) return;
    const result = await 删除考题(id);
    if (!result.success) {
      alert("删除失败: " + (result.error || "未知错误"));
      return;
    }
    setQuestions(questions.filter((q) => q.id !== id));
  }

  const typeLabels: Record<string, string> = {
    single_choice: "单选题",
    multiple_choice: "多选题",
    essay: "简答题",
    scoring: "评分项",
  };

  return (
    <div>
      <PageHeader
        title="考题管理"
        description="为课程添加、编辑考试题目"
        action={
          selectedCourseId
            ? { label: "+ 添加题目", onClick: openAddModal }
            : undefined
        }
      />

      {/* 课程选择 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">选择课程</label>
        <select
          value={selectedCourseId}
          onChange={(e) => {
            setSelectedCourseId(e.target.value);
            router.push(`/training/exam-manage?courseId=${e.target.value}`);
          }}
          className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          <option value="">请选择课程</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </div>

      {/* 题目列表 */}
      {selectedCourseId && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-400">加载中...</div>
          ) : questions.length === 0 ? (
            <div className="p-8 text-center text-gray-400">暂无题目，点击上方按钮添加</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {questions.map((q, index) => (
                <div key={q.id} className="p-4 hover:bg-gray-50">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                          {index + 1}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600">
                          {typeLabels[q.question_type]}
                        </span>
                        <span className="text-xs text-gray-400">{q.score} 分</span>
                      </div>
                      <p className="text-sm text-gray-800 font-medium">{q.question_text}</p>
                      {q.options.length > 0 && (
                        <div className="mt-2 space-y-1">
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
                        </div>
                      )}
                      {q.correct_answer && q.question_type === "essay" && (
                        <p className="mt-2 text-xs text-gray-500">
                          参考答案: {q.correct_answer}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => openEditModal(q)}
                        className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-50 rounded border border-blue-200"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => handleDeleteQuestion(q.id)}
                        className="text-xs px-2 py-1 text-red-600 hover:bg-red-50 rounded border border-red-200"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 添加/编辑弹窗 */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-semibold text-gray-900 mb-4">
              {editingQuestion ? "编辑题目" : "添加题目"}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">题型</label>
                <select
                  value={questionForm.question_type}
                  onChange={(e) => setQuestionForm({ ...questionForm, question_type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="single_choice">单选题</option>
                  <option value="multiple_choice">多选题</option>
                  <option value="essay">简答题</option>
                  <option value="scoring">评分项</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">题目内容 *</label>
                <textarea
                  rows={3}
                  value={questionForm.question_text}
                  onChange={(e) => setQuestionForm({ ...questionForm, question_text: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="输入题目内容..."
                />
              </div>

              {/* 选项（仅选择题） */}
              {questionForm.question_type !== "essay" && questionForm.question_type !== "scoring" && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">选项</label>
                    {questionForm.options.length < 8 && (
                      <button
                        type="button"
                        onClick={addOption}
                        className="text-xs text-blue-600 hover:text-blue-700"
                      >
                        + 添加选项
                      </button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {questionForm.options.map((opt, i) => (
                      <div key={opt.label} className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-600 text-xs flex items-center justify-center shrink-0">
                          {opt.label}
                        </span>
                        <input
                          value={opt.text}
                          onChange={(e) => updateOption(i, e.target.value)}
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                          placeholder={`选项 ${opt.label}`}
                        />
                        <button
                          type="button"
                          onClick={() => removeOption(i)}
                          className="text-xs text-red-500 hover:text-red-700 px-2"
                        >
                          删除
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {questionForm.question_type === "essay"
                    ? "参考答案"
                    : questionForm.question_type === "scoring"
                    ? "评分说明"
                    : "正确答案"}
                </label>
                <input
                  value={questionForm.correct_answer}
                  onChange={(e) => setQuestionForm({ ...questionForm, correct_answer: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder={
                    questionForm.question_type === "single_choice"
                      ? "填写选项字母，如 A"
                      : questionForm.question_type === "multiple_choice"
                      ? "填写选项字母，如 A,B,C"
                      : questionForm.question_type === "scoring"
                      ? "填写评分标准说明"
                      : "填写参考答案（供判卷参考）"
                  }
                />
                {questionForm.question_type !== "essay" && (
                  <p className="text-xs text-gray-400 mt-1">
                    单选填一个字母，多选填逗号分隔的字母
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">分值</label>
                <input
                  type="number"
                  value={questionForm.score}
                  onChange={(e) => setQuestionForm({ ...questionForm, score: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
            </div>

            <div className="flex gap-3 justify-end pt-4 mt-4 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveQuestion}
                disabled={saving}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
      {确认弹窗}
    </div>
  );
}

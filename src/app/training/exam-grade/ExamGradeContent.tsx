"use client";

import {useState, useMemo} from "react";
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

export default function ExamGradeContent({ initialPending }: { initialPending: 待判卷答题[] }) {
  const supabase = useMemo(() => createClient(), []);
  /* 首屏数据由服务端传入；判卷后本地移除该条，无需整表重查 */
  const [pendingList, setPendingList] = useState<待判卷答题[]>(initialPending);
  const [savingId, setSavingId] = useState<string | null>(null);

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

      {pendingList.length === 0 ? (
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

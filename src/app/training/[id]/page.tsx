import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BlockNoteRenderer } from "@/components/BlockNoteRenderer";

export default async function CourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: course } = await supabase
    .from("training_courses")
    .select("*, profiles(full_name)")
    .eq("id", id)
    .single();

  if (!course) notFound();

  const { data: assignments } = await supabase
    .from("training_assignments")
    .select("*, profiles!training_assignments_employee_id_fkey(full_name)")
    .eq("course_id", id)
    .order("created_at", { ascending: false });

  /* 查询考试成绩 */
  const { data: examResults } = await supabase
    .from("exam_results")
    .select("assignment_id, total_score, max_score, status")
    .in(
      "assignment_id",
      (assignments || []).map((a) => a.id)
    );

  const resultMap = new Map<string, { total_score: number; max_score: number; status: string }>();
  examResults?.forEach((r) => resultMap.set(r.assignment_id, r));

  /* 查询考题数量 */
  const { count: questionCount } = await supabase
    .from("exam_questions")
    .select("id", { count: "exact", head: true })
    .eq("course_id", id);

  /* 获取当前用户，判断是否已分配该课程 */
  const { data: userData } = await supabase.auth.getUser();
  const currentUserId = userData.user?.id;
  let myAssignment = null;
  let myExamResult = null;

  if (currentUserId) {
    const { data: myAssign } = await supabase
      .from("training_assignments")
      .select("id, status, score")
      .eq("course_id", id)
      .eq("employee_id", currentUserId)
      .single();
    myAssignment = myAssign;

    if (myAssign) {
      const { data: myResult } = await supabase
        .from("exam_results")
        .select("status, total_score, max_score")
        .eq("assignment_id", myAssign.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      myExamResult = myResult;
    }
  }

  const categoryLabels: Record<string, string> = {
    safety: "安全",
    technical: "技术",
    service: "服务",
    management: "管理",
  };

  const canTakeExam = course.has_exam && myAssignment && (!myExamResult || myExamResult.status === "failed");

  return (
    <div className="space-y-6">
      <PageHeader title={course.title} />

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">
            {categoryLabels[course.category] || course.category}
          </span>
          {course.is_required && (
            <span className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-600 border border-red-100">必修</span>
          )}
          <span className="text-xs text-gray-400">通过分: {course.passing_score}</span>
          {course.points > 0 && (
            <span className="text-xs px-2 py-0.5 rounded bg-yellow-50 text-yellow-700 border border-yellow-100">
              积分: {course.points}
            </span>
          )}
          {course.has_exam && (
            <span className="text-xs px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-100">
              含考试
            </span>
          )}
        </div>

        {course.description && (
          <p className="text-sm text-gray-600 mb-4">{course.description}</p>
        )}

        {/* 视频播放 */}
        {course.video_url && (
          <div className="mb-4">
            <video
              src={course.video_url}
              controls
              className="w-full max-w-2xl rounded-lg border border-gray-200"
              preload="metadata"
            />
          </div>
        )}

        {/* 文档内容 */}
        {course.content_text && (
          <div className="max-w-none">
            <CourseContent content={course.content_text} />
          </div>
        )}

        {/* 学员考试入口 */}
        {canTakeExam && (
          <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-blue-800">
                  {myExamResult ? "上次未通过，可重新考试" : "学习完成后请参加考试"}
                </p>
                <p className="text-xs text-blue-600 mt-0.5">
                  通过分数: {course.passing_score} 分
                </p>
              </div>
              <Link
                href={`/training/${id}/exam`}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                {myExamResult ? "重新考试" : "开始考试"}
              </Link>
            </div>
          </div>
        )}

        {/* 已通过的提示 */}
        {myExamResult?.status === "passed" && (
          <div className="mt-4 p-4 bg-green-50 rounded-lg border border-green-200">
            <p className="text-sm font-medium text-green-800">
              已通过考试（{myExamResult.total_score}/{myExamResult.max_score} 分）
            </p>
          </div>
        )}

        {/* 待判卷的提示 */}
        {myExamResult?.status === "pending" && (
          <div className="mt-4 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
            <p className="text-sm font-medium text-yellow-800">
              试卷已提交，简答题待人工判卷（客观题 {myExamResult.total_score}/{myExamResult.max_score} 分）
            </p>
          </div>
        )}
      </div>

      {/* 管理员操作区 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">课程管理</h3>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/training/${id}/assign`}
            className="px-4 py-2 text-sm text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 border border-blue-200"
          >
            分配学员
          </Link>
          {course.has_exam && (
            <Link
              href={`/training/exam-manage?courseId=${id}`}
              className="px-4 py-2 text-sm text-purple-600 bg-purple-50 rounded-lg hover:bg-purple-100 border border-purple-200"
            >
              考题管理 ({questionCount || 0} 题)
            </Link>
          )}
        </div>
      </div>

      {/* 学习进度 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">学习进度</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">学员</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">状态</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">分数</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">考试</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">截止日期</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {assignments?.map((a) => {
                const result = resultMap.get(a.id);
                return (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">{a.profiles?.full_name}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          a.status === "completed"
                            ? "bg-green-50 text-green-700"
                            : a.status === "in_progress"
                            ? "bg-blue-50 text-blue-700"
                            : "bg-gray-50 text-gray-500"
                        }`}
                      >
                        {a.status === "completed" ? "已完成" : a.status === "in_progress" ? "学习中" : "待开始"}
                      </span>
                    </td>
                    <td className="px-4 py-3">{a.score ?? "-"}</td>
                    <td className="px-4 py-3">
                      {course.has_exam && result ? (
                        <span
                          className={`text-xs px-2 py-0.5 rounded ${
                            result.status === "passed"
                              ? "bg-green-50 text-green-700"
                              : result.status === "failed"
                              ? "bg-red-50 text-red-700"
                              : "bg-yellow-50 text-yellow-700"
                          }`}
                        >
                          {result.status === "passed"
                            ? `通过 (${result.total_score}/${result.max_score})`
                            : result.status === "failed"
                            ? `未通过 (${result.total_score}/${result.max_score})`
                            : "待判卷"}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{a.due_date || "-"}</td>
                  </tr>
                );
              })}
              {(!assignments || assignments.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    暂无分配记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* 课程内容渲染组件：兼容旧数据（纯文本）和新数据（BlockNote JSON） */
function CourseContent({ content }: { content: string }) {
  /* 尝试解析为 BlockNote JSON */
  let parsedBlocks: unknown = null;
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.length > 0) {
      parsedBlocks = parsed;
    }
  } catch {
    /* 解析失败，按纯文本显示 */
  }

  if (parsedBlocks) {
    return <BlockNoteRenderer blocks={parsedBlocks} />;
  }

  /* 旧数据或空数组，按纯文本显示 */
  return (
    <div className="prose prose-sm max-w-none text-sm text-gray-700 whitespace-pre-wrap">
      {content}
    </div>
  );
}

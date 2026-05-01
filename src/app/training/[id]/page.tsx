import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import { notFound } from "next/navigation";

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

  const categoryLabels: Record<string, string> = {
    safety: "安全",
    technical: "技术",
    service: "服务",
    management: "管理",
  };

  return (
    <div className="space-y-6">
      <PageHeader title={course.title} />

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">
            {categoryLabels[course.category] || course.category}
          </span>
          {course.is_required && (
            <span className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-600 border border-red-100">必修</span>
          )}
          <span className="text-xs text-gray-400">通过分: {course.passing_score}</span>
        </div>

        {course.description && (
          <p className="text-sm text-gray-600 mb-4">{course.description}</p>
        )}

        {course.content_text && (
          <div className="prose prose-sm max-w-none text-sm text-gray-700 whitespace-pre-wrap">
            {course.content_text}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">学习进度</h3>
          <Link
            href={`/training/${id}/assign`}
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            + 分配学员
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">学员</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">状态</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">分数</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">截止日期</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {assignments?.map((a: any) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">{a.profiles?.full_name}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      a.status === "completed"
                        ? "bg-green-50 text-green-700"
                        : a.status === "in_progress"
                        ? "bg-blue-50 text-blue-700"
                        : "bg-gray-50 text-gray-500"
                    }`}>
                      {a.status === "completed" ? "已完成" : a.status === "in_progress" ? "学习中" : "待开始"}
                    </span>
                  </td>
                  <td className="px-4 py-3">{a.score ?? "-"}</td>
                  <td className="px-4 py-3 text-gray-500">{a.due_date || "-"}</td>
                </tr>
              ))}
              {(!assignments || assignments.length === 0) && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
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

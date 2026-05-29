import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";

export default async function TrainingPage() {
  const supabase = await createClient();

  const { data: courses } = await supabase
    .from("training_courses")
    .select("*, profiles(full_name)")
    .order("created_at", { ascending: false });

  const categoryLabels: Record<string, string> = {
    safety: "安全",
    technical: "技术",
    service: "服务",
    management: "管理",
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="授课学堂"
        description="员工培训与学习管理"
        action={{ href: "/training/new", label: "新建课程" }}
      />

      {/* 快捷入口 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap gap-2">
          <span className="text-sm font-medium text-gray-700 mr-2">管理:</span>
          <Link href="/training/exam-manage" className="text-xs px-3 py-1.5 rounded-lg bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100">
            考题管理
          </Link>
          <Link href="/training/exam-grade" className="text-xs px-3 py-1.5 rounded-lg bg-yellow-50 text-yellow-700 border border-yellow-200 hover:bg-yellow-100">
            简答题判卷
          </Link>
          <Link href="/training/behavior-items" className="text-xs px-3 py-1.5 rounded-lg bg-green-50 text-green-700 border border-green-200 hover:bg-green-100">
            行为项目
          </Link>
          <Link href="/training/behavior-score" className="text-xs px-3 py-1.5 rounded-lg bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100">
            行为打分
          </Link>
          <Link href="/training/rework-records" className="text-xs px-3 py-1.5 rounded-lg bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100">
            返工记录
          </Link>
          <Link href="/training/loss-records" className="text-xs px-3 py-1.5 rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100">
            损失记录
          </Link>
          <Link href="/training/promotion-rules" className="text-xs px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100">
            晋级规则
          </Link>
          <Link href="/training/promotion-overview" className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100">
            晋级总览
          </Link>
          <Link href="/training/promotion-records" className="text-xs px-3 py-1.5 rounded-lg bg-cyan-50 text-cyan-700 border border-cyan-200 hover:bg-cyan-100">
            晋级审核
          </Link>
        </div>
        <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-gray-100">
          <span className="text-sm font-medium text-gray-700 mr-2">个人:</span>
          <Link href="/training/my-progress" className="text-xs px-3 py-1.5 rounded-lg bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100">
            我的学习
          </Link>
          <Link href="/training/promotion-status" className="text-xs px-3 py-1.5 rounded-lg bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100">
            我的晋级
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {courses?.map((course: { id: string; category: string; is_required: boolean; title: string; description: string | null; duration_minutes: number | null; passing_score: number; points: number | null; video_url: string | null; has_exam: boolean | null; profiles: { full_name: string } | null }) => (
          <Link
            key={course.id}
            href={`/training/${course.id}`}
            className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-sm transition-shadow"
          >
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">
                {categoryLabels[course.category] || course.category}
              </span>
              {course.is_required && (
                <span className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-600 border border-red-100">必修</span>
              )}
              {(course.points ?? 0) > 0 && (
                <span className="text-xs px-2 py-0.5 rounded bg-yellow-50 text-yellow-700 border border-yellow-100">
                  积分 {course.points}
                </span>
              )}
              {course.video_url && (
                <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-600 border border-green-100">
                  视频
                </span>
              )}
              {course.has_exam && (
                <span className="text-xs px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-100">
                  考试
                </span>
              )}
            </div>
            <h3 className="text-base font-semibold text-gray-900">{course.title}</h3>
            {course.description && (
              <p className="text-sm text-gray-500 mt-1 line-clamp-2">{course.description}</p>
            )}
            <div className="flex items-center gap-3 mt-3 text-xs text-gray-400">
              {course.duration_minutes && <span>{course.duration_minutes} 分钟</span>}
              <span>通过分: {course.passing_score}</span>
              <span>创建: {course.profiles?.full_name}</span>
            </div>
          </Link>
        ))}
        {(!courses || courses.length === 0) && (
          <div className="col-span-full text-center text-gray-400 py-12">暂无课程</div>
        )}
      </div>
    </div>
  );
}

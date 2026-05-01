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
    <div>
      <PageHeader
        title="授课学堂"
        description="员工培训与学习管理"
        action={{ href: "/training/new", label: "新建课程" }}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {courses?.map((course: any) => (
          <Link
            key={course.id}
            href={`/training/${course.id}`}
            className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-sm transition-shadow"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">
                {categoryLabels[course.category] || course.category}
              </span>
              {course.is_required && (
                <span className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-600 border border-red-100">必修</span>
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

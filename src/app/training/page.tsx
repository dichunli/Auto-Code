import { createClient } from "@/lib/supabase/server";
import TrainingContent, { type 课程 } from "./TrainingContent";

export default async function TrainingPage() {
  const supabase = await createClient();

  /* 并行查询课程和分类，减少关联查询开销；只选择列表需要展示的字段 */
  const [{ data: courses }, { data: categoriesData }] = await Promise.all([
    supabase
      .from("training_courses")
      .select(`
        id,
        title,
        description,
        category,
        category_id,
        content_type,
        duration_minutes,
        passing_score,
        is_required,
        points,
        video_url,
        has_exam,
        exam_mode,
        sort_order,
        created_at,
        created_by
      `)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("training_categories").select("id, name"),
  ]);

  const categoriesMap = new Map((categoriesData || []).map((c) => [String(c.id), String(c.name)]));

  /* 批量查询创建人姓名 */
  const creatorIds = [...new Set((courses || []).map((c) => c.created_by).filter(Boolean))];
  let profilesMap = new Map<string, string>();
  if (creatorIds.length > 0) {
    const { data: profilesData } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", creatorIds);
    profilesMap = new Map(
      (profilesData || []).map((p) => [String(p.id), String(p.full_name || "")])
    );
  }

  const typedCourses: 课程[] = ((courses as 课程[]) || []).map((c) => ({
    ...c,
    category_name: categoriesMap.get(String(c.category_id || "")) || c.category || "",
    profiles: { full_name: profilesMap.get(String(c.created_by || "")) || "" },
  }));

  return <TrainingContent initialCourses={typedCourses} />;
}

import { createClient } from "@/lib/supabase/server";
import TrainingContent, { type 课程 } from "./TrainingContent";

interface 课程分类 {
  id: string;
  name: string;
  parent_id: string | null;
}

interface 专题 {
  id: string;
  name: string;
}

export default async function TrainingPage() {
  const supabase = await createClient();

  /* 并行查询课程、分类、专题、课程-专题关联 */
  const [
    { data: courses },
    { data: categoriesData },
    { data: topicsData },
    { data: courseTopicsData },
  ] = await Promise.all([
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
    supabase.from("training_categories").select("id, name, parent_id").order("sort_order"),
    supabase.from("training_topics").select("id, name").eq("is_active", true).order("sort_order"),
    supabase.from("training_course_topics").select("course_id, topic_id"),
  ]);

  const categoriesMap = new Map((categoriesData || []).map((c) => [String(c.id), String(c.name)]));

  const categories: 课程分类[] = (categoriesData || []).map((c) => ({
    id: String(c.id),
    name: String(c.name),
    parent_id: c.parent_id ? String(c.parent_id) : null,
  }));

  const topics: 专题[] = (topicsData || []).map((t) => ({
    id: String(t.id),
    name: String(t.name),
  }));

  /* 构建课程→专题映射 */
  const courseTopicMap = new Map<string, string[]>();
  (courseTopicsData || []).forEach((ct) => {
    const cid = String(ct.course_id);
    const tid = String(ct.topic_id);
    if (!courseTopicMap.has(cid)) courseTopicMap.set(cid, []);
    courseTopicMap.get(cid)!.push(tid);
  });

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
    topic_ids: courseTopicMap.get(String(c.id)) || [],
  }));

  return (
    <TrainingContent
      initialCourses={typedCourses}
      categories={categories}
      topics={topics}
    />
  );
}

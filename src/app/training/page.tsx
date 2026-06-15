import { createClient } from "@/lib/supabase/server";
import TrainingContent, { type 课程 } from "./TrainingContent";

export default async function TrainingPage() {
  const supabase = await createClient();
  const { data: courses } = await supabase
    .from("training_courses")
    .select("*, profiles(full_name), training_categories(id, name)")
    .order("created_at", { ascending: false });

  const typedCourses: 课程[] = ((courses as 课程[]) || []).map((c) => ({
    ...c,
    category_name: c.training_categories?.name || c.category || "",
  }));

  return <TrainingContent initialCourses={typedCourses} />;
}

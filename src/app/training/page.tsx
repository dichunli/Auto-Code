import { createClient } from "@/lib/supabase/server";
import TrainingContent, { type 课程 } from "./TrainingContent";

export default async function TrainingPage() {
  const supabase = await createClient();
  const { data: courses } = await supabase
    .from("training_courses")
    .select("*, profiles(full_name)")
    .order("created_at", { ascending: false });

  return <TrainingContent initialCourses={(courses as 课程[]) || []} />;
}

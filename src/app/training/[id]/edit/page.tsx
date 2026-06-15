import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import CourseEditForm from "./CourseEditForm";

interface Course {
  id: string;
  title: string;
  description: string | null;
  category_id: string | null;
  content_type: string;
  content_text: string | null;
  video_url: string | null;
  duration_minutes: number | null;
  passing_score: number;
  is_required: boolean;
  points: number | null;
  has_exam: boolean;
  exam_mode?: string | null;
}

interface 课程分类 {
  id: string;
  name: string;
}

export default async function EditCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: courseData, error: courseError } = await supabase
    .from("training_courses")
    .select("*")
    .eq("id", id)
    .single();

  if (courseError || !courseData) {
    notFound();
  }

  const course: Course = {
    id: String(courseData.id),
    title: String(courseData.title || ""),
    description: courseData.description ? String(courseData.description) : null,
    category_id: courseData.category_id ? String(courseData.category_id) : null,
    content_type: String(courseData.content_type || "document"),
    content_text: courseData.content_text ? String(courseData.content_text) : null,
    video_url: courseData.video_url ? String(courseData.video_url) : null,
    duration_minutes: courseData.duration_minutes ? Number(courseData.duration_minutes) : null,
    passing_score: Number(courseData.passing_score) || 60,
    is_required: Boolean(courseData.is_required),
    points: courseData.points ? Number(courseData.points) : null,
    has_exam: Boolean(courseData.has_exam),
    exam_mode: courseData.exam_mode ? String(courseData.exam_mode) : null,
  };

  const { data: categoriesData } = await supabase
    .from("training_categories")
    .select("id, name")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const categories: 课程分类[] = (categoriesData || []).map((item) => ({
    id: String(item.id),
    name: String(item.name),
  }));

  return <CourseEditForm course={course} categories={categories} />;
}

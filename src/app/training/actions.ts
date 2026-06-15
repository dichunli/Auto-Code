"use server";

import { createClient } from "@/lib/supabase/server";

interface 新建课程数据 {
  title: string;
  description?: string;
  category_id?: string;
  content_type: string;
  content_text?: string;
  video_url?: string;
  knowledge_article_id?: string;
  duration_minutes?: number;
  passing_score?: number;
  is_required?: boolean;
  points?: number;
  has_exam?: boolean;
  exam_mode?: string;
}

interface 更新课程数据 extends 新建课程数据 {}

export async function 创建课程(data: 新建课程数据): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { error } = await supabase.from("training_courses").insert({
    title: data.title.trim(),
    description: data.description?.trim() || null,
    category_id: data.category_id || null,
    content_type: data.content_type,
    content_text: data.content_type === "document" ? data.content_text?.trim() || null : null,
    video_url: data.content_type === "video" ? data.video_url || null : null,
    knowledge_article_id: data.content_type === "knowledge" ? data.knowledge_article_id || null : null,
    duration_minutes: data.duration_minutes ?? null,
    passing_score: data.passing_score ?? 60,
    is_required: data.is_required ?? false,
    points: data.points ?? 0,
    has_exam: data.has_exam ?? false,
    exam_mode: data.has_exam ? data.exam_mode : "online",
  });

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}

export async function 更新课程(
  id: string,
  data: 更新课程数据
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("training_courses")
    .update({
      title: data.title.trim(),
      description: data.description?.trim() || null,
      category_id: data.category_id || null,
      content_type: data.content_type,
      content_text: data.content_type === "document" ? data.content_text?.trim() || null : null,
      video_url: data.content_type === "video" ? data.video_url || null : null,
      duration_minutes: data.duration_minutes ?? null,
      passing_score: data.passing_score ?? 60,
      is_required: data.is_required ?? false,
      points: data.points ?? 0,
      has_exam: data.has_exam ?? false,
      exam_mode: data.has_exam ? data.exam_mode : "online",
    })
    .eq("id", id);

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}

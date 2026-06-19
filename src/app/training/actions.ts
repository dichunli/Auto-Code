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

type 更新课程数据 = 新建课程数据;

/* 包装 Promise，防止网络异常导致请求无限挂起 */
async function 带超时<T>(promise: Promise<T>, 毫秒: number, 操作名: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const 超时Promise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${操作名}超时，请检查网络后重试`));
    }, 毫秒);
  });
  try {
    const result = await Promise.race([promise, 超时Promise]);
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function 创建课程(data: 新建课程数据): Promise<{ success: boolean; error?: string }> {
  try {
    if (!data.title || !data.title.trim()) {
      return { success: false, error: "课程标题不能为空" };
    }

    const supabase = await createClient();

    const { error } = await 带超时(
      supabase.from("training_courses").insert({
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
      }),
      10000,
      "保存课程到数据库"
    );

    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[创建课程] 异常:", msg);
    return { success: false, error: "保存异常: " + msg };
  }
}

export async function 更新课程(
  id: string,
  data: 更新课程数据
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!id) {
      return { success: false, error: "课程ID不能为空" };
    }
    if (!data.title || !data.title.trim()) {
      return { success: false, error: "课程标题不能为空" };
    }

    const supabase = await createClient();

    const { error } = await 带超时(
      supabase
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
        .eq("id", id),
      10000,
      "更新课程到数据库"
    );

    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[更新课程] 异常:", msg);
    return { success: false, error: "保存异常: " + msg };
  }
}

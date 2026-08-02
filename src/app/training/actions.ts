"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";

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
  topic_ids?: string[];
}

type 更新课程数据 = 新建课程数据;

/* 包装 Promise，防止网络异常导致请求无限挂起（supabase 查询构建器是 PromiseLike） */
async function 带超时<T>(promise: PromiseLike<T>, 毫秒: number, 操作名: string): Promise<T> {
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
    const { user, error: 登录错误 } = await 验证用户已登录();
    if (!user) return { success: false, error: 登录错误 || "未登录" };

    const { data: created, error } = await 带超时(
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
      }).select("id").single(),
      10000,
      "保存课程到数据库"
    );

    if (error) {
      return { success: false, error: error.message };
    }

    /* 同步专题关联 */
    if (created && data.topic_ids && data.topic_ids.length > 0) {
      const topicRows = data.topic_ids.map((topicId) => ({
        course_id: created.id,
        topic_id: topicId,
      }));
      await supabase.from("training_course_topics").insert(topicRows);
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
    const { user, error: 登录错误 } = await 验证用户已登录();
    if (!user) return { success: false, error: 登录错误 || "未登录" };

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

    /* 同步专题关联：先删后插 */
    if (data.topic_ids !== undefined) {
      await supabase.from("training_course_topics").delete().eq("course_id", id);
      if (data.topic_ids.length > 0) {
        const topicRows = data.topic_ids.map((topicId) => ({
          course_id: id,
          topic_id: topicId,
        }));
        await supabase.from("training_course_topics").insert(topicRows);
      }
    }

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[更新课程] 异常:", msg);
    return { success: false, error: "保存异常: " + msg };
  }
}

export async function 删除学员分配(assignmentId: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (!assignmentId) {
      return { success: false, error: "分配记录ID不能为空" };
    }

    const supabase = await createClient();
    const { user, error: 登录错误 } = await 验证用户已登录();
    if (!user) return { success: false, error: 登录错误 || "未登录" };

    /* 删除分配记录，关联的 training_progress、exam_answers、exam_results 会通过 CASCADE 自动删除 */
    const { error } = await 带超时(
      supabase.from("training_assignments").delete().eq("id", assignmentId),
      10000,
      "删除学员分配记录"
    );

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[删除学员分配] 异常:", msg);
    return { success: false, error: "删除异常: " + msg };
  }
}

export async function 删除课程(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (!id) {
      return { success: false, error: "课程ID不能为空" };
    }

    const supabase = await createClient();
    const { user, error: 登录错误 } = await 验证用户已登录();
    if (!user) return { success: false, error: 登录错误 || "未登录" };

    /* 检查是否已分配学员 */
    const { data: assignments, error: assignError } = await 带超时(
      supabase.from("training_assignments").select("id").eq("course_id", id).limit(1),
      10000,
      "查询课程分配记录"
    );
    if (assignError) {
      return { success: false, error: "检查分配记录失败: " + assignError.message };
    }
    if (assignments && assignments.length > 0) {
      return { success: false, error: "该课程已分配学员，无法删除。请先移除分配记录。" };
    }

    /* 检查是否有关联考题 */
    const { data: questions, error: questionError } = await 带超时(
      supabase.from("exam_questions").select("id").eq("course_id", id).limit(1),
      10000,
      "查询课程考题"
    );
    if (questionError) {
      return { success: false, error: "检查考题失败: " + questionError.message };
    }
    if (questions && questions.length > 0) {
      return { success: false, error: "该课程下已有考题，无法删除。请先删除相关考题。" };
    }

    const { error } = await 带超时(
      supabase.from("training_courses").delete().eq("id", id),
      10000,
      "删除课程"
    );

    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[删除课程] 异常:", msg);
    return { success: false, error: "删除异常: " + msg };
  }
}

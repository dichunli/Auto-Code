"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

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

/* ═══ 培训分类删除 Server Action ═══
 * 删除操作从客户端直写收口到服务端，删除前检查分类下是否有课程。 */
export async function 删除培训分类(id: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();

  /* 删除前检查：是否有子分类 */
  const { data: children } = await supabase
    .from("training_categories")
    .select("id")
    .eq("parent_id", id)
    .limit(1);
  if (children && children.length > 0) {
    return { success: false, error: "该分类下有子分类，请先删除子分类" };
  }

  /* 删除前检查：该分类下是否还有课程 */
  const { data: courses, error: countError } = await supabase
    .from("training_courses")
    .select("id")
    .eq("category_id", id)
    .limit(1);
  if (countError) {
    return { success: false, error: "检查关联课程失败: " + countError.message };
  }
  if (courses && courses.length > 0) {
    return { success: false, error: "该分类下已有课程，无法删除。请先将课程移动到其他分类。" };
  }

  const { error } = await supabase.from("training_categories").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/training/categories");
  return { success: true };
}

/* ═══ 培训分类/专题/排序/分配/考题/考试/判卷/损失/返工/晋级 写操作收编 ═══
 * 以下函数从客户端直写收口到服务端（2026-08-27 第五批），
 * 判卷人/审批人/申请人等身份字段一律取服务端验证的 user.id。 */

interface 操作结果 {
  success: boolean;
  error?: string;
}

/* ─── 培训分类（新建/编辑，查重和父子校验在服务端兜底） ─── */
export async function 保存培训分类(参数: {
  id: string | null;
  name: string;
  code: string;
  parentId: string;
  isActive: boolean;
}): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };

  const name = 参数.name.trim();
  if (!name) return { success: false, error: "请填写分类名称" };
  const parentId = 参数.parentId || null;
  if (参数.id && parentId === 参数.id) {
    return { success: false, error: "不能将自己设为父分类" };
  }

  const supabase = await createClient();

  /* 重名检查（排除自己） */
  let dupQuery = supabase.from("training_categories").select("id").ilike("name", name);
  if (参数.id) dupQuery = dupQuery.neq("id", 参数.id);
  const { data: dup } = await dupQuery.maybeSingle();
  if (dup) return { success: false, error: "该分类名称已存在，请更换" };

  const payload = { name, code: 参数.code.trim() || null, parent_id: parentId, is_active: 参数.isActive };
  const { error } = 参数.id
    ? await supabase.from("training_categories").update(payload).eq("id", 参数.id)
    : await supabase.from("training_categories").insert(payload);
  if (error) return { success: false, error: error.message };

  revalidatePath("/training/categories");
  return { success: true };
}

/* ─── 培训专题（新建/编辑，查重在服务端） ─── */
export async function 保存培训专题(参数: {
  id: string | null;
  name: string;
  isActive: boolean;
}): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };

  const name = 参数.name.trim();
  if (!name) return { success: false, error: "请填写专题名称" };

  const supabase = await createClient();
  let dupQuery = supabase.from("training_topics").select("id").ilike("name", name);
  if (参数.id) dupQuery = dupQuery.neq("id", 参数.id);
  const { data: dup } = await dupQuery.maybeSingle();
  if (dup) return { success: false, error: "该专题名称已存在，请更换" };

  const { error } = 参数.id
    ? await supabase.from("training_topics").update({ name, is_active: 参数.isActive }).eq("id", 参数.id)
    : await supabase.from("training_topics").insert({ name, is_active: 参数.isActive });
  if (error) return { success: false, error: error.message };

  revalidatePath("/training/topics");
  return { success: true };
}

/* ─── 删除培训专题（先清课程关联） ─── */
export async function 删除培训专题(id: string): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };

  const supabase = await createClient();
  await supabase.from("training_course_topics").delete().eq("topic_id", id);
  const { error } = await supabase.from("training_topics").delete().eq("id", id);
  if (error) return { success: false, error: error.message };

  revalidatePath("/training/topics");
  return { success: true };
}

/* ─── 课程拖拽排序（批量） ─── */
export async function 保存课程排序(updates: { id: string; sort_order: number }[]): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };

  const supabase = await createClient();
  for (const u of updates) {
    const { error } = await supabase.from("training_courses").update({ sort_order: u.sort_order }).eq("id", u.id);
    if (error) return { success: false, error: "排序保存失败: " + error.message };
  }
  return { success: true };
}

/* ─── 分配培训课程（批量插入分配记录） ─── */
export async function 分配培训课程(参数: {
  courseId: string;
  employeeIds: string[];
  dueDate: string;
}): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  if (参数.employeeIds.length === 0) return { success: false, error: "请至少选择一位学员" };

  const supabase = await createClient();
  const records = 参数.employeeIds.map((empId) => ({
    course_id: 参数.courseId,
    employee_id: empId,
    due_date: 参数.dueDate || null,
  }));
  const { error } = await supabase.from("training_assignments").insert(records);
  if (error) return { success: false, error: error.message };

  revalidatePath(`/training/${参数.courseId}`);
  return { success: true };
}

/* ─── 考题（新建/编辑/删除） ─── */
export async function 保存考题(参数: {
  id: string | null;
  payload: {
    course_id: string;
    question_type: string;
    question_text: string;
    options: { label: string; text: string }[];
    correct_answer: string | null;
    score: number;
    sort_order: number;
  };
}): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  if (!参数.payload.question_text.trim()) return { success: false, error: "请输入题目内容" };

  const supabase = await createClient();
  const { error } = 参数.id
    ? await supabase.from("exam_questions").update(参数.payload).eq("id", 参数.id)
    : await supabase.from("exam_questions").insert(参数.payload);
  if (error) return { success: false, error: error.message };

  return { success: true };
}

export async function 删除考题(id: string): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };

  const supabase = await createClient();
  const { error } = await supabase.from("exam_questions").delete().eq("id", id);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

/* ─── 判卷打分（改答题分 + 重算总分 + 更新成绩状态 + 通过则完成分配） ───
 * 原来是客户端 5 步连写，收编后服务端一次完成；判卷人取服务端 user.id。 */
export async function 判卷打分(参数: {
  answerId: string;
  examResultId: string;
  gradedScore: number;
  maxScore: number;
}): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  if (参数.gradedScore < 0 || 参数.gradedScore > 参数.maxScore) {
    return { success: false, error: `分数必须在 0-${参数.maxScore} 之间` };
  }

  const supabase = await createClient();

  /* 更新答题记录 */
  const { error: answerError } = await supabase
    .from("exam_answers")
    .update({
      score: 参数.gradedScore,
      is_correct: 参数.gradedScore > 0,
      graded_by: user.id,
      graded_at: new Date().toISOString(),
    })
    .eq("id", 参数.answerId);
  if (answerError) return { success: false, error: answerError.message };

  /* 重算该考试总分并更新状态 */
  const { data: resultRecord } = await supabase
    .from("exam_results")
    .select("assignment_id, total_score, max_score")
    .eq("id", 参数.examResultId)
    .single();

  if (resultRecord) {
    const { data: examAnswers } = await supabase
      .from("exam_answers")
      .select("score")
      .eq("assignment_id", resultRecord.assignment_id);
    const newTotal = (examAnswers || []).reduce((sum, a) => sum + ((a.score as number | null) || 0), 0);

    const { data: pendingAnswers } = await supabase
      .from("exam_answers")
      .select("id")
      .eq("assignment_id", resultRecord.assignment_id)
      .is("is_correct", null);

    const newStatus =
      pendingAnswers && pendingAnswers.length > 0
        ? "pending"
        : newTotal >= (resultRecord.max_score as number) * 0.6
        ? "passed"
        : "failed";

    await supabase
      .from("exam_results")
      .update({ total_score: newTotal, status: newStatus })
      .eq("id", 参数.examResultId);

    /* 全部判完且通过 → 更新分配记录 */
    if (newStatus === "passed") {
      await supabase
        .from("training_assignments")
        .update({ status: "completed", score: newTotal, completed_at: new Date().toISOString() })
        .eq("id", resultRecord.assignment_id);
    }
  }

  revalidatePath("/training/exam-grade");
  return { success: true };
}

/* ─── 提交考试（员工在线考：插答题 + 插成绩 + 更新分配） ───
 * 客观题判分在客户端完成（需要题目数据），写库步骤收编到服务端。 */
export async function 提交考试(参数: {
  assignmentId: string;
  courseId: string;
  hasEssay: boolean;
  totalScore: number;
  maxScore: number;
  answerRecords: {
    question_id: string;
    answer_text: string | null;
    is_correct: boolean | null;
    score: number;
  }[];
}): Promise<操作结果 & { status?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  if (参数.answerRecords.length === 0) return { success: false, error: "没有答题记录" };

  const supabase = await createClient();
  const employeeId = user.id;

  /* 已考试次数（服务端查，不用客户端传） */
  const { count: examCount } = await supabase
    .from("exam_results")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", 参数.assignmentId);
  const currentExamCount = (examCount || 0) + 1;

  /* 通过分数线（服务端读课程设置） */
  const { data: course } = await supabase
    .from("training_courses")
    .select("passing_score")
    .eq("id", 参数.courseId)
    .single();
  const passingScore = (course?.passing_score as number | null) || 60;
  const status = 参数.hasEssay ? "pending" : 参数.totalScore >= passingScore ? "passed" : "failed";

  /* 批量插入答题记录（考生身份取服务端登录用户） */
  const { error: answerError } = await supabase.from("exam_answers").insert(
    参数.answerRecords.map((r) => ({
      assignment_id: 参数.assignmentId,
      question_id: r.question_id,
      employee_id: employeeId,
      answer_text: r.answer_text,
      is_correct: r.is_correct,
      score: r.score,
    }))
  );
  if (answerError) return { success: false, error: answerError.message };

  /* 插入考试成绩 */
  const { error: resultError } = await supabase.from("exam_results").insert({
    assignment_id: 参数.assignmentId,
    employee_id: employeeId,
    course_id: 参数.courseId,
    total_score: 参数.totalScore,
    max_score: 参数.maxScore,
    status,
    exam_count: currentExamCount,
  });
  if (resultError) return { success: false, error: resultError.message };

  /* 更新分配记录 */
  await supabase
    .from("training_assignments")
    .update({
      status: !参数.hasEssay && status === "passed" ? "completed" : "in_progress",
      score: 参数.totalScore,
      ...(!参数.hasEssay && status === "passed" ? { completed_at: new Date().toISOString() } : {}),
    })
    .eq("id", 参数.assignmentId);

  return { success: true, status };
}

/* ─── 录入成绩（管理员代录：插答题（含判分人） + 插成绩 + 更新分配） ─── */
export async function 录入成绩(参数: {
  assignmentId: string;
  courseId: string;
  employeeId: string;
  totalScore: number;
  maxScore: number;
  passingScore: number;
  answerRecords: {
    question_id: string;
    answer_text: string | null;
    is_correct: boolean | null;
    score: number;
  }[];
}): Promise<操作结果 & { status?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  if (参数.answerRecords.length === 0) return { success: false, error: "没有答题记录" };

  const supabase = await createClient();

  const { count: examCount } = await supabase
    .from("exam_results")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", 参数.assignmentId);
  const currentExamCount = (examCount || 0) + 1;

  const status = 参数.totalScore >= 参数.passingScore ? "passed" : "failed";

  /* 判分人取服务端登录用户 */
  const { error: answerError } = await supabase.from("exam_answers").insert(
    参数.answerRecords.map((r) => ({
      assignment_id: 参数.assignmentId,
      question_id: r.question_id,
      employee_id: 参数.employeeId,
      answer_text: r.answer_text,
      is_correct: r.is_correct,
      score: r.score,
      graded_by: user.id,
      graded_at: new Date().toISOString(),
    }))
  );
  if (answerError) return { success: false, error: answerError.message };

  const { error: resultError } = await supabase.from("exam_results").insert({
    assignment_id: 参数.assignmentId,
    employee_id: 参数.employeeId,
    course_id: 参数.courseId,
    total_score: 参数.totalScore,
    max_score: 参数.maxScore,
    status,
    exam_count: currentExamCount,
  });
  if (resultError) return { success: false, error: resultError.message };

  await supabase
    .from("training_assignments")
    .update({
      status: status === "passed" ? "completed" : "in_progress",
      score: 参数.totalScore,
      completed_at: status === "passed" ? new Date().toISOString() : null,
    })
    .eq("id", 参数.assignmentId);

  return { success: true, status };
}

/* ─── 日常损失记录（新增/删除） ─── */
export async function 录入日常损失(参数: {
  employeeId: string;
  lossType: string;
  description: string;
  lossAmount: number;
}): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  if (!参数.employeeId) return { success: false, error: "请选择责任人" };
  if (!参数.description.trim()) return { success: false, error: "请输入损失描述" };

  const supabase = await createClient();
  const { error } = await supabase.from("daily_loss_records").insert({
    employee_id: 参数.employeeId,
    loss_type: 参数.lossType,
    description: 参数.description.trim(),
    loss_amount: 参数.lossAmount,
  });
  if (error) return { success: false, error: error.message };

  revalidatePath("/training/loss-records");
  return { success: true };
}

export async function 删除日常损失(id: string): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };

  const supabase = await createClient();
  const { error } = await supabase.from("daily_loss_records").delete().eq("id", id);
  if (error) return { success: false, error: error.message };

  revalidatePath("/training/loss-records");
  return { success: true };
}

/* ─── 返工记录（新增（工单号服务端查实）/删除） ─── */
export async function 录入返工记录(参数: {
  employeeId: string;
  workOrderNo: string;
  description: string;
  lossAmount: number;
}): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  if (!参数.employeeId) return { success: false, error: "请选择责任人" };
  if (!参数.description.trim()) return { success: false, error: "请输入返工原因" };

  const supabase = await createClient();

  /* 工单号 → 工单ID（服务端查实） */
  let workOrderId: string | null = null;
  if (参数.workOrderNo.trim()) {
    const { data: wo } = await supabase
      .from("work_orders")
      .select("id")
      .eq("order_no", 参数.workOrderNo.trim())
      .maybeSingle();
    if (wo) workOrderId = wo.id as string;
  }

  const { error } = await supabase.from("rework_records").insert({
    employee_id: 参数.employeeId,
    work_order_id: workOrderId,
    description: 参数.description.trim(),
    loss_amount: 参数.lossAmount,
  });
  if (error) return { success: false, error: error.message };

  revalidatePath("/training/rework-records");
  return { success: true };
}

export async function 删除返工记录(id: string): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };

  const supabase = await createClient();
  const { error } = await supabase.from("rework_records").delete().eq("id", id);
  if (error) return { success: false, error: error.message };

  revalidatePath("/training/rework-records");
  return { success: true };
}

/* ─── 发起晋级申请（管理员代员工发起 / 员工自主申请） ───
 * 自主申请时 employee_id 强制取服务端登录用户，防止代别人申请。 */
export async function 发起晋级申请(参数: {
  employeeId: string;
  selfApply: boolean;
  fromLevelId: string | null;
  toLevelId: string;
  reason: string;
  coursePoints: number;
  workOrderCount: number;
  reworkLossTotal: number;
  dailyLossTotal: number;
  behaviorScoreTotal: number;
}): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };

  const supabase = await createClient();
  const { error } = await supabase.from("promotion_records").insert({
    employee_id: 参数.selfApply ? user.id : 参数.employeeId,
    type: "promotion",
    from_level_id: 参数.fromLevelId,
    to_level_id: 参数.toLevelId,
    reason: 参数.reason,
    course_points: 参数.coursePoints,
    work_order_count: 参数.workOrderCount,
    rework_loss_total: 参数.reworkLossTotal,
    daily_loss_total: 参数.dailyLossTotal,
    behavior_score_total: 参数.behaviorScoreTotal,
    status: "pending",
  });
  if (error) return { success: false, error: error.message };

  revalidatePath("/training/promotion-overview");
  revalidatePath("/training/promotion-records");
  return { success: true };
}

/* ─── 审核晋级（批准时同步更新员工等级；审批人取服务端 user.id） ─── */
export async function 审核晋级(参数: {
  recordId: string;
  approve: boolean;
  reason?: string;
}): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };

  const supabase = await createClient();

  /* 批准需要读记录拿员工和目标等级 */
  let 员工id: string | null = null;
  let 目标等级id: string | null = null;
  if (参数.approve) {
    const { data: record } = await supabase
      .from("promotion_records")
      .select("employee_id, to_level_id")
      .eq("id", 参数.recordId)
      .single();
    if (!record || !(record.to_level_id as string | null)) {
      return { success: false, error: "目标等级不存在" };
    }
    员工id = record.employee_id as string;
    目标等级id = record.to_level_id as string;
  }

  const { error: updateError } = await supabase
    .from("promotion_records")
    .update({
      status: 参数.approve ? "approved" : "rejected",
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      ...(!参数.approve && 参数.reason ? { reason: 参数.reason } : {}),
    })
    .eq("id", 参数.recordId);
  if (updateError) return { success: false, error: updateError.message };

  /* 批准 → 更新员工等级 */
  if (参数.approve && 员工id && 目标等级id) {
    const { error: empError } = await supabase
      .from("profiles")
      .update({ mechanic_level_id: 目标等级id })
      .eq("id", 员工id);
    if (empError) return { success: false, error: empError.message };
  }

  revalidatePath("/training/promotion-records");
  return { success: true };
}

/* ─── 晋级规则（新建/编辑/删除） ─── */
export async function 保存晋级规则(参数: {
  id: string | null;
  payload: {
    from_level_id: string | null;
    to_level_id: string;
    min_course_points: number;
    min_work_orders: number;
    max_rework_loss: number;
    max_daily_loss: number;
    min_behavior_score: number;
    min_exam_score: number;
    exam_pass_required: boolean;
    period_months: number;
    required_course_ids: string[] | null;
    description: string | null;
    is_active: boolean;
  };
}): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  if (!参数.payload.to_level_id) return { success: false, error: "请选择目标等级" };

  const supabase = await createClient();
  const { error } = 参数.id
    ? await supabase.from("promotion_rules").update(参数.payload).eq("id", 参数.id)
    : await supabase.from("promotion_rules").insert(参数.payload);
  if (error) return { success: false, error: error.message };

  revalidatePath("/training/promotion-rules");
  return { success: true };
}

export async function 删除晋级规则(id: string): Promise<操作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };

  const supabase = await createClient();
  const { error } = await supabase.from("promotion_rules").delete().eq("id", id);
  if (error) return { success: false, error: error.message };

  revalidatePath("/training/promotion-rules");
  return { success: true };
}

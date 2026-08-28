"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { 计算时段状态, 本地今日字符串, 过滤今日任务 } from "@/lib/behaviorCheck";

/* ═══ 行为考核写操作 Server Action ═══
 * 自检上报（上报即合格直接按满分计分）与检查人核查打分（含事后改判）
 * 收编到服务端，避免客户端 session 异常导致计分失败；
 * 操作人身份一律取服务端验证的 user.id，不接受客户端传入。 */

interface 动作结果 {
  success: boolean;
  error?: string;
}

interface 项目信息 {
  id: string;
  name: string;
  score_type: string;
  score_value: number;
}

interface 任务信息 {
  name: string;
  execute_time: string;
  end_time: string;
  item_id: string;
  behavior_score_items: 项目信息 | 项目信息[] | null;
}

interface 考核记录行 {
  id: string;
  status: string;
  task_id: string;
  employee_id: string;
  checker_ids: string[] | null;
  score_record_id: string | null;
  behavior_check_tasks: 任务信息 | 任务信息[] | null;
}

interface 细节行 {
  id: string;
  name: string;
  score_value: number;
}

export interface 细节作答项 {
  detail_id: string;
  name: string;
  full_score: number;
  given: number;
  photos: string[];
  note: string | null;
}

function 取单<T>(v: T[] | T | null | undefined): T | null {
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
}

type 服务端客户端 = Awaited<ReturnType<typeof createClient>>;

/* 公共：查记录（带任务+项目）与该项目细节列表 */
async function 查记录上下文(supabase: 服务端客户端, recordId: string) {
  const { data: 记录, error } = await supabase
    .from("behavior_check_records")
    .select(
      "id, status, task_id, employee_id, checker_ids, score_record_id, behavior_check_tasks(name, execute_time, end_time, item_id, behavior_score_items(id, name, score_type, score_value))"
    )
    .eq("id", recordId)
    .single();
  if (error || !记录) return { error: "记录不存在，请刷新页面" } as const;

  const r = 记录 as unknown as 考核记录行;
  const 任务 = 取单(r.behavior_check_tasks);
  const 项目 = 取单(任务?.behavior_score_items);
  if (!任务 || !项目) return { error: "关联任务或项目已被删除" } as const;

  const { data: 细节 } = await supabase
    .from("behavior_item_details")
    .select("id, name, score_value")
    .eq("item_id", 项目.id)
    .order("sort_order", { ascending: true });

  return { 记录: r, 任务, 项目, 细节: (细节 || []) as 细节行[] } as const;
}

/* ─── 责任人自检上报：上报即合格，立即按满分计分（检查人事后核查可改判） ─── */
export async function 自检上报计分(参数: {
  recordId: string;
  photos: string[];
  note: string;
}): Promise<动作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 };
  if (参数.photos.length === 0) return { success: false, error: "请先拍现场照片再上报" };

  const supabase = await createClient();
  const 上下文 = await 查记录上下文(supabase, 参数.recordId);
  if ("error" in 上下文) return { success: false, error: 上下文.error };
  const { 记录, 任务, 项目, 细节 } = 上下文;

  if (记录.status === "self_reported") return { success: false, error: "已上报过了，请勿重复提交" };
  if (记录.status === "completed") return { success: false, error: "该记录已完成，无需上报" };
  if (记录.employee_id !== user.id) return { success: false, error: "只有责任人本人能自检上报" };
  if ((记录.checker_ids || []).includes(user.id)) {
    return { success: false, error: "该项目由你自检打分，请在“待我检查”里直接完成" };
  }
  if (计算时段状态(任务.execute_time, 任务.end_time, "pending") === "closed") {
    return { success: false, error: `已超过检查时间段（${任务.end_time.slice(0, 5)} 截止），本次检查已关闭` };
  }

  /* 上报即合格：加分项得满分；扣分项合格不扣分（计 0 分留痕） */
  const 满分 = 细节.length > 0 ? 细节.reduce((s, d) => s + d.score_value, 0) : 项目.score_value;
  const 加分制 = 项目.score_type !== "penalty";
  const 得分 = 加分制 ? 满分 : 0;

  const { data: 流水, error: 流水错误 } = await supabase
    .from("behavior_score_records")
    .insert({
      employee_id: 记录.employee_id,
      item_id: 项目.id,
      score: 得分,
      notes: `自检合格：${任务.name}（${项目.name}）`,
      media_urls: 参数.photos,
      scored_by: user.id,
      event_time: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (流水错误) return { success: false, error: "计分失败: " + 流水错误.message };

  /* 条件更新防并发：状态仍是 pending 才更新，抢不到说明已被处理 */
  const { data: 更新行, error: 更新错误 } = await supabase
    .from("behavior_check_records")
    .update({
      status: "self_reported",
      self_report_photos: 参数.photos,
      self_report_note: 参数.note.trim() || null,
      self_reported_at: new Date().toISOString(),
      score_record_id: 流水.id,
    })
    .eq("id", 参数.recordId)
    .eq("status", "pending")
    .select("id");

  if (更新错误 || !更新行 || 更新行.length === 0) {
    /* 流水已插入但记录没更新成 → 删掉流水补偿，避免多计分 */
    await supabase.from("behavior_score_records").delete().eq("id", 流水.id);
    return { success: false, error: "该记录状态已变化，请刷新页面后重试" };
  }

  revalidatePath("/behavior/checks");
  return { success: true };
}

/* ─── 检查人核查打分：
 *    pending（责任人未自检直接检查）→ 超时拦截，全额写流水；
 *    self_reported（核查自检结果）→ 超时仍可改判，已按满分计分的只写差额调整流水 ─── */
export async function 核查打分(参数: {
  recordId: string;
  detailResults: 细节作答项[];
  整体分数: number;
  整体照片: string[];
  评论: string;
}): Promise<动作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 };

  const supabase = await createClient();
  const 上下文 = await 查记录上下文(supabase, 参数.recordId);
  if ("error" in 上下文) return { success: false, error: 上下文.error };
  const { 记录, 任务, 项目, 细节 } = 上下文;

  if (记录.status === "completed") return { success: false, error: "该记录已完成，请勿重复提交" };

  /* 权限：检查人集合内；空数组旧数据 = 本人自检语义 */
  const 检查人集合 = 记录.checker_ids || [];
  const 可检查 = 检查人集合.length > 0 ? 检查人集合.includes(user.id) : 记录.employee_id === user.id;
  if (!可检查) return { success: false, error: "你不是该记录的检查人" };

  /* 超时拦截只针对"责任人还没自检"的直接检查；已自检的放行（事后核查改判不限时） */
  if (记录.status === "pending" && 计算时段状态(任务.execute_time, 任务.end_time, "pending") === "closed") {
    return { success: false, error: `已超过检查时间段（${任务.end_time.slice(0, 5)} 截止），本次检查已关闭` };
  }

  const 加分制 = 项目.score_type !== "penalty";
  const 有细节 = 细节.length > 0;

  /* 校验分值范围 + 不合格必拍（服务端双保险，与前端规则一致） */
  if (有细节) {
    const 满分表 = new Map(细节.map((d) => [d.id, d.score_value]));
    for (const r of 参数.detailResults) {
      const 上限 = 满分表.get(r.detail_id);
      if (上限 === undefined) return { success: false, error: `细节「${r.name}」已不存在，请刷新页面` };
      if (!Number.isInteger(r.given) || r.given < 0 || r.given > 上限) {
        return { success: false, error: `「${r.name}」的分值要在 0 ~ ${上限} 之间` };
      }
      const 不合格 = 加分制 ? r.given < 上限 : r.given > 0;
      if (不合格 && r.photos.length === 0) {
        return { success: false, error: `「${r.name}」判定不合格，必须拍现场照片才能提交` };
      }
    }
  } else {
    if (!Number.isInteger(参数.整体分数) || 参数.整体分数 < 0) {
      return { success: false, error: "请输入有效分数" };
    }
    const 不合格 = 加分制 ? 参数.整体分数 < 项目.score_value : 参数.整体分数 > 0;
    if (不合格 && 参数.整体照片.length === 0) {
      return { success: false, error: "判定不合格，必须拍现场照片才能提交" };
    }
  }

  /* 汇总照片；核查合计分 */
  const 全部照片: string[] = [];
  for (const r of 参数.detailResults) 全部照片.push(...r.photos);
  if (!有细节) 全部照片.push(...参数.整体照片);
  const 核查合计 = 有细节 ? 参数.detailResults.reduce((s, r) => s + r.given, 0) : 参数.整体分数;

  /* 已自检且已计分（新流程）→ 差额改判；否则 → 全额写流水 */
  const 已自检计分 = 记录.status === "self_reported" && 记录.score_record_id !== null;
  let 首条流水id: string | null = 记录.score_record_id;
  let 改判流水id: string | null = null;

  if (已自检计分) {
    const 满分 = 有细节 ? 细节.reduce((s, d) => s + d.score_value, 0) : 项目.score_value;
    /* 加分制：核查比满分少得 → 负分扣回；扣分制：核查扣分 → 负分补扣 */
    const 差额 = 加分制 ? 核查合计 - 满分 : -核查合计;
    if (差额 !== 0) {
      const { data: 调整流水, error: 调整错误 } = await supabase
        .from("behavior_score_records")
        .insert({
          employee_id: 记录.employee_id,
          item_id: 项目.id,
          score: 差额,
          notes: `核查改判：${任务.name}（${项目.name}）自检按满分计，核查后${加分制 ? `得 ${核查合计}` : `扣 ${核查合计}`} 分`,
          media_urls: 全部照片,
          scored_by: user.id,
          event_time: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (调整错误) return { success: false, error: "改判计分失败: " + 调整错误.message };
      改判流水id = 调整流水.id;
    }
  } else {
    const 正分 = Math.abs(核查合计);
    const { data: 流水, error: 流水错误 } = await supabase
      .from("behavior_score_records")
      .insert({
        employee_id: 记录.employee_id,
        item_id: 项目.id,
        score: 加分制 ? 正分 : -正分,
        notes: `完成考核：${任务.name}（${项目.name}）`,
        media_urls: 全部照片,
        scored_by: user.id,
        event_time: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (流水错误) return { success: false, error: "计分失败: " + 流水错误.message };
    首条流水id = 流水.id;
  }

  /* 条件更新防并发：只许从 pending/self_reported 完成，抢不到说明已被别人提交 */
  const 更新负载: Record<string, unknown> = {
    status: "completed",
    detail_results: 有细节 ? 参数.detailResults : [],
    score_record_id: 首条流水id,
  };
  if (改判流水id) 更新负载.review_score_record_id = 改判流水id;

  const { data: 更新行, error: 更新错误 } = await supabase
    .from("behavior_check_records")
    .update(更新负载)
    .eq("id", 参数.recordId)
    .neq("status", "completed")
    .select("id");

  if (更新错误 || !更新行 || 更新行.length === 0) {
    /* 流水已插入但记录没更新成 → 删掉流水补偿，避免多计分 */
    if (改判流水id) await supabase.from("behavior_score_records").delete().eq("id", 改判流水id);
    if (!已自检计分 && 首条流水id) await supabase.from("behavior_score_records").delete().eq("id", 首条流水id);
    return { success: false, error: "该记录已被处理，请刷新页面" };
  }

  /* 首条评论（可空；评论写入失败不阻塞主流程） */
  const 评论内容 = 参数.评论.trim();
  if (评论内容) {
    const { error: 评论错误 } = await supabase.from("behavior_check_comments").insert({
      check_record_id: 参数.recordId,
      author_id: user.id,
      content: 评论内容,
    });
    if (评论错误) console.error("核查评论写入失败:", 评论错误.message);
  }

  revalidatePath("/behavior/checks");
  return { success: true };
}

/* ─── 懒生成今日考核记录（先查后插 + 忽略唯一冲突，约束上线前后都安全） ───
 * 与 page.tsx 服务端渲染时同一套逻辑；客户端翻页/刷新前也调它，
 * 身份取服务端登录用户，不再由客户端组装插入。
 * （生成时机本身是否挪到按钮/cron 是待办清单第 6 项，另行处理） */
interface 懒生成任务 {
  id: string;
  frequency: string;
  execute_time: string;
  end_time: string;
  execute_weekday: number | null;
  execute_day: number | null;
  employee_ids: string[] | null;
  behavior_score_items: { responsible_ids: string[] | null; checker_ids: string[] | null }[] | { responsible_ids: string[] | null; checker_ids: string[] | null } | null;
}

export async function 懒生成今日考核记录(): Promise<动作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 };
  const uid = user.id;
  const today = 本地今日字符串();

  const supabase = await createClient();
  const { data: taskData } = await supabase
    .from("behavior_check_tasks")
    .select("*, behavior_score_items(responsible_ids, checker_ids)")
    .eq("is_active", true);

  const todayTasks = 过滤今日任务((taskData || []) as unknown as 懒生成任务[]);

  for (const task of todayTasks) {
    const item = 取单(task.behavior_score_items);

    if (item?.responsible_ids && item.responsible_ids.length > 0) {
      /* 责任人模式：每个责任人各生成一条记录（各自被考核）。
       * 应检查人集合=配置的检查人（空=该责任人自检）。
       * 责任人本人（要自检上报）或检查人（要核查）打开页面都会触发生成 */
      for (const 责任人 of item.responsible_ids) {
        const 应检查人集合 = item.checker_ids && item.checker_ids.length > 0 ? item.checker_ids : [责任人];
        if (uid !== 责任人 && !应检查人集合.includes(uid)) continue;

        const { data: existing } = await supabase
          .from("behavior_check_records")
          .select("id")
          .eq("task_id", task.id)
          .eq("employee_id", 责任人)
          .eq("check_date", today)
          .maybeSingle();

        if (!existing) {
          const { error } = await supabase.from("behavior_check_records").insert({
            task_id: task.id,
            employee_id: 责任人,
            checker_ids: 应检查人集合,
            check_date: today,
            status: "pending",
          });
          /* 23505 = 唯一约束冲突（两台设备同时打开页面），忽略即可 */
          if (error && error.code !== "23505") {
            console.error("生成今日考核记录失败:", error.message);
          }
        }
      }
    } else {
      /* 旧模式：任务 employee_ids 空=全员，否则只给名单内的人生成；本人自检 */
      if (task.employee_ids && task.employee_ids.length > 0 && !task.employee_ids.includes(uid)) continue;

      const { data: existing } = await supabase
        .from("behavior_check_records")
        .select("id")
        .eq("task_id", task.id)
        .eq("employee_id", uid)
        .eq("check_date", today)
        .maybeSingle();

      if (!existing) {
        const { error } = await supabase.from("behavior_check_records").insert({
          task_id: task.id,
          employee_id: uid,
          checker_ids: [uid],
          check_date: today,
          status: "pending",
        });
        if (error && error.code !== "23505") {
          console.error("生成今日考核记录失败:", error.message);
        }
      }
    }
  }

  return { success: true };
}

/* ─── 提交考核评论（作者取服务端登录用户） ─── */
export async function 提交考核评论(参数: {
  checkRecordId: string;
  content: string;
}): Promise<动作结果> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) return { success: false, error: 登录错误 };
  if (!参数.content.trim()) return { success: false, error: "评论内容不能为空" };

  const supabase = await createClient();
  const { error } = await supabase.from("behavior_check_comments").insert({
    check_record_id: 参数.checkRecordId,
    author_id: user.id,
    content: 参数.content.trim(),
  });
  if (error) return { success: false, error: error.message };

  return { success: true };
}

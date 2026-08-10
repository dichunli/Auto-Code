/**
 * 考勤同步核心逻辑
 *
 * 被两处调用：
 *   1. Server Action（考勤页"立即同步"按钮，管理员手动触发）
 *   2. API Route /api/cron/sync-attendance（Windows 计划任务每天自动触发）
 *
 * 流程：拉钉钉排班 + 打卡结果 → 按人按天汇总判定 → upsert 到 attendance_records
 * 写库用 service role（createAdminClient），因为定时任务没有用户登录态，且考勤表不对客户端开放写权限。
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  拉取某日排班,
  拉取打卡记录,
  type 钉钉打卡项,
} from "@/lib/dingtalk";

export interface 同步结果 {
  /** 同步了多少天 */
  天数: number;
  /** 参与同步的已绑定员工数 */
  员工数: number;
  /** 写入/更新了多少条考勤记录 */
  写入条数: number;
}

/** 已绑定钉钉的员工行 */
interface 绑定员工 {
  id: string;
  dingtalk_userid: string | null;
}

/** 一人一天的排班聚合（班次名 + 计划上下班时间） */
interface 当天排班 {
  shiftName: string;
  onDutyPlan: string;
  offDutyPlan: string;
}

/** 一人一天的打卡聚合 */
interface 当天打卡 {
  上班?: 钉钉打卡项;
  下班?: 钉钉打卡项;
}

/** 要写入 attendance_records 的行 */
interface 考勤行 {
  profile_id: string;
  dingtalk_userid: string;
  work_date: string;
  has_schedule: boolean;
  shift_name: string | null;
  check_in_at: string | null;
  check_in_result: string | null;
  check_out_at: string | null;
  check_out_result: string | null;
  day_result: string;
  synced_at: string;
}

/** 把 Date 格式化成 "2026-08-09"（本地时区，与钉钉返回的计划打卡时间口径一致） */
function 格式化日期(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 毫秒时间戳 → 存库字符串。
 * 必须用 toISOString()（带 Z 的 UTC 完整格式）：TIMESTAMPTZ 列收到无时区后缀的
 * 本地时间字符串会按 UTC 解析，导致时间整体偏 8 小时（2026-08-10 踩坑）。
 */
function 时间戳转存库格式(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * 当天汇总判定：
 *   无排班 → rest 休息
 *   上下班都缺卡 → absent 缺勤
 *   只缺一次卡 → miss_card 缺卡
 *   上班迟到（含严重迟到、旷工迟到）→ late 迟到
 *   下班早退 → early 早退
 *   其余 → normal 正常
 */
function 判定当天结果(has排班: boolean, 卡?: 当天打卡): string {
  if (!has排班) return "rest";
  const 上班缺卡 = !卡?.上班 || 卡.上班.timeResult === "NotSigned";
  const 下班缺卡 = !卡?.下班 || 卡.下班.timeResult === "NotSigned";
  if (上班缺卡 && 下班缺卡) return "absent";
  if (上班缺卡 || 下班缺卡) return "miss_card";
  if (["Late", "SeriousLate", "Absenteeism"].includes(卡!.上班!.timeResult)) return "late";
  if (卡!.下班!.timeResult === "Early") return "early";
  return "normal";
}

/**
 * 同步 from ~ to（含首尾两天）的考勤数据。
 * 重复同步会覆盖旧记录（UNIQUE(profile_id, work_date) upsert），可安全重跑。
 */
export async function 同步考勤数据(from: Date, to: Date): Promise<同步结果> {
  const supabase = createAdminClient();

  // 1. 查已绑定钉钉的在职员工
  const { data: 员工数据, error: 员工错误 } = await supabase
    .from("profiles")
    .select("id, dingtalk_userid")
    .eq("is_active", true)
    .not("dingtalk_userid", "is", null);
  if (员工错误) throw new Error("查询员工绑定信息失败: " + 员工错误.message);

  const 员工们 = ((员工数据 ?? []) as 绑定员工[]).filter((e) => e.dingtalk_userid);
  if (员工们.length === 0) {
    throw new Error("还没有员工绑定钉钉账号，请先在考勤月报页点「匹配钉钉账号」");
  }
  const userIds = 员工们.map((e) => e.dingtalk_userid as string);

  // 2. 构造天列表
  const 天列表: Date[] = [];
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    天列表.push(new Date(d));
  }

  // 3. 逐天拉全企业排班，聚合成 "userid|日期" → 当天排班
  const 排班表 = new Map<string, 当天排班>();
  for (const 天 of 天列表) {
    const 日期串 = 格式化日期(天);
    const 排班 = await 拉取某日排班(天);
    for (const 项 of 排班) {
      const key = `${项.userid}|${日期串}`;
      const 已有 = 排班表.get(key) ?? { shiftName: 项.shiftName, onDutyPlan: "", offDutyPlan: "" };
      if (项.checkType === "OnDuty") 已有.onDutyPlan = 项.planTime;
      if (项.checkType === "OffDuty") 已有.offDutyPlan = 项.planTime;
      if (!已有.shiftName && 项.shiftName) 已有.shiftName = 项.shiftName;
      排班表.set(key, 已有);
    }
  }

  // 4. 拉整段时间的打卡记录，聚合成 "userid|日期" → 当天打卡（日期以应打卡时间为准）
  const 打卡记录 = await 拉取打卡记录(userIds, from, to);
  const 打卡表 = new Map<string, 当天打卡>();
  for (const 项 of 打卡记录) {
    const 日期串 = 格式化日期(new Date(项.baseCheckTime));
    const key = `${项.userid}|${日期串}`;
    const 已有 = 打卡表.get(key) ?? {};
    if (项.checkType === "OnDuty") 已有.上班 = 项;
    if (项.checkType === "OffDuty") 已有.下班 = 项;
    打卡表.set(key, 已有);
  }

  // 5. 逐员工逐天生成记录（没排班的也写一条 rest，月报表格才完整）
  const 同步时刻 = new Date().toISOString();
  const 记录们: 考勤行[] = [];
  for (const 员工 of 员工们) {
    const userid = 员工.dingtalk_userid as string;
    for (const 天 of 天列表) {
      const 日期串 = 格式化日期(天);
      const key = `${userid}|${日期串}`;
      const 排班 = 排班表.get(key);
      const 卡 = 打卡表.get(key);
      const has排班 = !!排班;
      记录们.push({
        profile_id: 员工.id,
        dingtalk_userid: userid,
        work_date: 日期串,
        has_schedule: has排班,
        shift_name: 排班?.shiftName || null,
        check_in_at: 卡?.上班?.userCheckTime ? 时间戳转存库格式(卡.上班.userCheckTime) : null,
        check_in_result: 卡?.上班?.timeResult || null,
        check_out_at: 卡?.下班?.userCheckTime ? 时间戳转存库格式(卡.下班.userCheckTime) : null,
        check_out_result: 卡?.下班?.timeResult || null,
        day_result: 判定当天结果(has排班, 卡),
        synced_at: 同步时刻,
      });
    }
  }

  // 6. 分批 upsert（每批 500 条，稳妥）
  let 写入条数 = 0;
  for (let i = 0; i < 记录们.length; i += 500) {
    const 批 = 记录们.slice(i, i + 500);
    const { error: 写错 } = await supabase
      .from("attendance_records")
      .upsert(批, { onConflict: "profile_id,work_date" });
    if (写错) throw new Error("写入考勤记录失败: " + 写错.message);
    写入条数 += 批.length;
  }

  return { 天数: 天列表.length, 员工数: 员工们.length, 写入条数 };
}

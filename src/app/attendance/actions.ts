"use server";

/**
 * 考勤模块 Server Actions
 *  - 手动同步考勤（考勤页"立即同步"按钮）
 *  - 自动匹配钉钉账号（按员工档案手机号批量绑定）
 *  - 保存考勤扣款标准
 * 全部要求：已登录 + 管理角色（admin / boss / accountant）
 */

import { createClient, 验证用户已登录, 包装ServerAction错误 } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { 按手机号查用户id } from "@/lib/dingtalk";
import { 同步考勤数据, type 同步结果 } from "@/lib/attendanceSync";
import { 考勤管理角色名单, 是异常行 } from "@/lib/attendanceDays";
import { revalidatePath } from "next/cache";

/* 允许操作考勤/工资的角色（名单统一在 src/lib/attendanceDays.ts） */
const 管理角色名单 = 考勤管理角色名单;

/** 检查指定用户是否是管理角色 */
async function 是管理角色(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profile_roles")
    .select("roles(name)")
    .eq("profile_id", userId);
  return ((data || []) as unknown as { roles?: { name?: string } | null }[]).some(
    (d) => d.roles?.name != null && 管理角色名单.includes(d.roles.name)
  );
}

/** 统一的身份校验：返回 null 表示通过，否则返回错误响应 */
async function 校验管理权限(): Promise<{ success: false; error: string } | null> {
  const { user, error } = await 验证用户已登录();
  if (!user) return { success: false, error: error || "未登录" };
  if (!(await 是管理角色(user.id))) {
    return { success: false, error: "只有管理员、老板或财务能操作考勤" };
  }
  return null;
}

// ============================================================
// 手动同步考勤
// ============================================================

export async function 手动同步考勤(
  开始日期: string,
  结束日期: string
): Promise<{ success: boolean; data?: 同步结果; error?: string }> {
  return 包装ServerAction错误(async () => {
    const 拒绝 = await 校验管理权限();
    if (拒绝) return 拒绝;

    const from = new Date(开始日期 + "T00:00:00");
    const to = new Date(结束日期 + "T00:00:00");
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return { success: false, error: "日期格式不对" };
    }
    if (from > to) {
      return { success: false, error: "开始日期不能晚于结束日期" };
    }
    // 一次最多同步 62 天，防止误选太长时间把接口打爆
    const 天数 = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
    if (天数 > 62) {
      return { success: false, error: "一次最多同步 62 天，请分多次同步" };
    }

    const data = await 同步考勤数据(from, to);
    return { success: true, data };
  });
}

// ============================================================
// 自动匹配钉钉账号（按员工档案手机号）
// ============================================================

interface 匹配结果 {
  /** 匹配成功的员工姓名 */
  成功: string[];
  /** 匹配失败的员工及原因 */
  失败: { 姓名: string; 原因: string }[];
}

export async function 自动匹配钉钉账号(): Promise<{
  success: boolean;
  data?: 匹配结果;
  error?: string;
}> {
  return 包装ServerAction错误(async () => {
    const 拒绝 = await 校验管理权限();
    if (拒绝) return 拒绝;

    const admin = createAdminClient();
    // 只处理在职且未绑定的员工；已绑定的不动（换绑去员工编辑页手动改）
    const { data: 员工数据, error: 查询错误 } = await admin
      .from("profiles")
      .select("id, full_name, phone")
      .eq("is_active", true)
      .is("dingtalk_userid", null);
    if (查询错误) return { success: false, error: "查询员工列表失败: " + 查询错误.message };

    const 员工们 = (员工数据 ?? []) as { id: string; full_name: string; phone: string | null }[];
    const 结果: 匹配结果 = { 成功: [], 失败: [] };

    for (const 员工 of 员工们) {
      if (!员工.phone) {
        结果.失败.push({ 姓名: 员工.full_name, 原因: "员工档案没填手机号" });
        continue;
      }
      const userid = await 按手机号查用户id(员工.phone.trim());
      if (!userid) {
        结果.失败.push({ 姓名: 员工.full_name, 原因: "钉钉企业里找不到这个手机号" });
        continue;
      }
      const { error: 更新错误 } = await admin
        .from("profiles")
        .update({ dingtalk_userid: userid })
        .eq("id", 员工.id);
      if (更新错误) {
        结果.失败.push({ 姓名: 员工.full_name, 原因: "写入绑定失败: " + 更新错误.message });
        continue;
      }
      结果.成功.push(员工.full_name);
    }

    return { success: true, data: 结果 };
  });
}

// ============================================================
// 保存考勤扣款标准
// ============================================================

export async function 保存考勤扣款设置(
  迟到扣款: number,
  缺卡扣款: number,
  缺勤扣款: number
): Promise<{ success: boolean; error?: string }> {
  return 包装ServerAction错误(async () => {
    const 拒绝 = await 校验管理权限();
    if (拒绝) return 拒绝;

    for (const [名称, 值] of [["迟到扣款", 迟到扣款], ["缺卡扣款", 缺卡扣款], ["缺勤扣款", 缺勤扣款]] as const) {
      if (typeof 值 !== "number" || isNaN(值) || 值 < 0) {
        return { success: false, error: `${名称}必须是不小于 0 的数字` };
      }
    }

    const admin = createAdminClient();
    const { data: 现有 } = await admin.from("attendance_settings").select("id").limit(1);
    const 行 = (现有 ?? [])[0] as { id: string } | undefined;

    const 新值 = {
      late_penalty: 迟到扣款,
      miss_card_penalty: 缺卡扣款,
      absent_penalty: 缺勤扣款,
      updated_at: new Date().toISOString(),
    };
    const { error: 写错 } = 行
      ? await admin.from("attendance_settings").update(新值).eq("id", 行.id)
      : await admin.from("attendance_settings").insert(新值);
    if (写错) return { success: false, error: "保存失败: " + 写错.message };

    return { success: true };
  });
}

// ============================================================
// 手动调整出勤天数（每日统计页，仅异常行可改）
// ============================================================

/**
 * 手动调整某员工某天的出勤天数。
 * @param 天数 0 / 0.5 / 1；传 null 表示撤销手动调整、恢复自动计算
 *
 * 规则（2026-08-21 与用户确认）：
 *   - 只有异常行（迟到/早退/缺卡/缺勤）可改，正常出勤行固定 1 天不让改
 *   - 展示、月报汇总、工资折算统一用 有效出勤天数 = 手动值优先
 */
export async function 修改出勤天数(
  profileId: string,
  workDate: string,
  天数: number | null,
  说明?: string
): Promise<{ success: boolean; error?: string }> {
  return 包装ServerAction错误(async () => {
    const { user, error } = await 验证用户已登录();
    if (!user) return { success: false, error: error || "未登录" };
    if (!(await 是管理角色(user.id))) {
      return { success: false, error: "只有管理员、老板或财务能调整出勤天数" };
    }

    if (!profileId || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
      return { success: false, error: "参数不对" };
    }
    if (天数 != null) {
      if (typeof 天数 !== "number" || isNaN(天数) || 天数 < 0 || 天数 > 1 || (天数 * 2) % 1 !== 0) {
        return { success: false, error: "出勤天数只能填 0、0.5 或 1" };
      }
    }

    const admin = createAdminClient();
    /* 服务端双保险：只有异常行允许调整（前端入口同样做了限制） */
    const { data: 记录数据, error: 查错 } = await admin
      .from("attendance_records")
      .select("has_schedule, day_result")
      .eq("profile_id", profileId)
      .eq("work_date", workDate)
      .maybeSingle();
    if (查错) return { success: false, error: "查询考勤记录失败: " + 查错.message };
    const 记录 = 记录数据 as { has_schedule: boolean; day_result: string } | null;
    if (!记录) return { success: false, error: "当天没有考勤记录，请先同步" };
    if (!是异常行(记录)) {
      return { success: false, error: "只有迟到、早退、缺卡、缺勤的日期才能调整出勤天数" };
    }

    const { error: 写错 } = await admin
      .from("attendance_records")
      .update({
        manual_days: 天数,
        manual_note: 天数 != null ? (说明?.trim() || null) : null,
        manual_updated_by: 天数 != null ? user.id : null,
        manual_updated_at: 天数 != null ? new Date().toISOString() : null,
      })
      .eq("profile_id", profileId)
      .eq("work_date", workDate);
    if (写错) return { success: false, error: "保存失败: " + 写错.message };

    revalidatePath(`/attendance/${profileId}`);
    revalidatePath("/attendance");
    return { success: true };
  });
}

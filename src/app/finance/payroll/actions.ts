"use server";

/**
 * 工资单 Server Actions
 *  - 生成月工资单：底薪按考勤折算 + 考勤扣款自动算（提成人工填，二期再自动算）
 *  - 编辑工资单（草稿状态可改所有数字）
 *  - 状态流转：草稿 → 已审批 → 已发放（已审批可退回草稿）
 * 全部要求：已登录 + 管理角色（admin / boss / accountant）
 */

import { createClient, 验证用户已登录, 包装ServerAction错误 } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

/* 允许操作工资的角色 */
const 管理角色名单 = ["admin", "boss", "accountant"];

/** 统一的身份校验：返回 null 表示通过，否则返回错误响应 */
async function 校验管理权限(): Promise<{ success: false; error: string } | null> {
  const { user, error } = await 验证用户已登录();
  if (!user) return { success: false, error: error || "未登录" };
  const supabase = await createClient();
  const { data } = await supabase
    .from("profile_roles")
    .select("roles(name)")
    .eq("profile_id", user.id);
  const 是管理 = ((data || []) as unknown as { roles?: { name?: string } | null }[]).some(
    (d) => d.roles?.name != null && 管理角色名单.includes(d.roles.name)
  );
  if (!是管理) return { success: false, error: "只有管理员、老板或财务能操作工资单" };
  return null;
}

/** 底薪折算：实发底薪 = 底薪 × 实出勤 ÷ 应出勤（应出勤为 0 时全额发放） */
function 折算底薪(base: number, 实出勤: number, 应出勤: number): number {
  if (应出勤 <= 0) return Math.round(base * 100) / 100;
  // 先转分再算，避免浮点误差
  return Math.round((base * 100 * 实出勤) / 应出勤) / 100;
}

// ============================================================
// 生成月工资单
// ============================================================

interface 生成结果 {
  /** 新生成的员工数 */
  生成数: number;
  /** 已有工资单被跳过的员工姓名 */
  跳过名单: string[];
}

export async function 生成工资单(月份: string): Promise<{
  success: boolean;
  data?: 生成结果;
  error?: string;
}> {
  return 包装ServerAction错误(async () => {
    const 拒绝 = await 校验管理权限();
    if (拒绝) return 拒绝;

    if (!/^\d{4}-\d{2}$/.test(月份)) {
      return { success: false, error: "月份格式不对（应为 2026-08）" };
    }
    const [年, 月] = 月份.split("-").map(Number);
    const 当月天数 = new Date(年, 月, 0).getDate();
    const period_start = `${月份}-01`;
    const period_end = `${月份}-${String(当月天数).padStart(2, "0")}`;

    const admin = createAdminClient();

    // 1. 在职员工（含底薪）
    const { data: 员工数据, error: 员工错误 } = await admin
      .from("profiles")
      .select("id, full_name, base_salary")
      .eq("is_active", true);
    if (员工错误) return { success: false, error: "查询员工失败: " + 员工错误.message };
    const 员工们 = (员工数据 ?? []) as { id: string; full_name: string; base_salary: number | null }[];
    if (员工们.length === 0) return { success: false, error: "没有在职员工" };

    // 2. 本月已有工资单的员工（跳过，不覆盖人工改过的）
    const { data: 已有数据 } = await admin
      .from("payroll_records")
      .select("profile_id")
      .eq("period_start", period_start)
      .eq("period_end", period_end);
    const 已有集合 = new Set(((已有数据 ?? []) as { profile_id: string }[]).map((r) => r.profile_id));

    // 3. 考勤扣款标准
    const { data: 设置数据 } = await admin
      .from("attendance_settings")
      .select("late_penalty, miss_card_penalty, absent_penalty")
      .limit(1);
    const 设置 = ((设置数据 ?? [])[0] ?? { late_penalty: 0, miss_card_penalty: 0, absent_penalty: 0 }) as {
      late_penalty: number;
      miss_card_penalty: number;
      absent_penalty: number;
    };

    // 4. 当月考勤记录，按员工聚合
    const { data: 考勤数据 } = await admin
      .from("attendance_records")
      .select("profile_id, has_schedule, day_result")
      .gte("work_date", period_start)
      .lte("work_date", period_end);
    interface 考勤聚合 { 应出勤: number; 实出勤: number; 迟到: number; 缺卡: number; 缺勤: number }
    const 考勤按人 = new Map<string, 考勤聚合>();
    for (const r of (考勤数据 ?? []) as { profile_id: string; has_schedule: boolean; day_result: string }[]) {
      if (!r.has_schedule) continue;
      const 聚 = 考勤按人.get(r.profile_id) ?? { 应出勤: 0, 实出勤: 0, 迟到: 0, 缺卡: 0, 缺勤: 0 };
      聚.应出勤 += 1;
      if (r.day_result !== "absent") 聚.实出勤 += 1;
      if (r.day_result === "late") 聚.迟到 += 1;
      if (r.day_result === "miss_card") 聚.缺卡 += 1;
      if (r.day_result === "absent") 聚.缺勤 += 1;
      考勤按人.set(r.profile_id, 聚);
    }

    // 5. 给还没有工资单的员工生成草稿
    const 待生成 = 员工们.filter((e) => !已有集合.has(e.id));
    const 跳过名单 = 员工们.filter((e) => 已有集合.has(e.id)).map((e) => e.full_name);

    if (待生成.length === 0) {
      return { success: true, data: { 生成数: 0, 跳过名单 } };
    }

    const 行们 = 待生成.map((员工) => {
      const 考勤 = 考勤按人.get(员工.id) ?? { 应出勤: 0, 实出勤: 0, 迟到: 0, 缺卡: 0, 缺勤: 0 };
      const 底薪 = 员工.base_salary ?? 0;
      const 考勤扣款 =
        Math.round((考勤.迟到 * 设置.late_penalty + 考勤.缺卡 * 设置.miss_card_penalty + 考勤.缺勤 * 设置.absent_penalty) * 100) / 100;
      return {
        profile_id: 员工.id,
        period_start,
        period_end,
        base_salary: 折算底薪(底薪, 考勤.实出勤, 考勤.应出勤),
        should_attendance_days: 考勤.应出勤,
        attendance_days: 考勤.实出勤,
        late_count: 考勤.迟到,
        attendance_deduction: 考勤扣款,
        deduction: 考勤扣款,
        status: "draft",
        notes: 考勤.应出勤 === 0 ? "本月无考勤数据，底薪按全额发放" : null,
      };
    });

    const { error: 写入错误 } = await admin.from("payroll_records").insert(行们);
    if (写入错误) return { success: false, error: "生成工资单失败: " + 写入错误.message };

    revalidatePath("/finance/payroll");
    return { success: true, data: { 生成数: 待生成.length, 跳过名单 } };
  });
}

// ============================================================
// 编辑工资单（仅草稿状态可改）
// ============================================================

export interface 工资单编辑数据 {
  base_salary: number;
  commission_diagnosis: number;
  commission_repair: number;
  commission_sales: number;
  commission_qc: number;
  commission_picking: number;
  bonus: number;
  deduction: number;
  should_attendance_days: number | null;
  attendance_days: number | null;
  late_count: number;
  attendance_deduction: number;
  notes: string | null;
}

export async function 更新工资单(
  id: string,
  数据: 工资单编辑数据
): Promise<{ success: boolean; error?: string }> {
  return 包装ServerAction错误(async () => {
    const 拒绝 = await 校验管理权限();
    if (拒绝) return 拒绝;

    // 数字字段校验：都不能是负数
    const 数字项: [string, number | null][] = [
      ["底薪", 数据.base_salary],
      ["诊断提成", 数据.commission_diagnosis],
      ["维修提成", 数据.commission_repair],
      ["销售提成", 数据.commission_sales],
      ["质检提成", 数据.commission_qc],
      ["拣货提成", 数据.commission_picking],
      ["奖金", 数据.bonus],
      ["扣款", 数据.deduction],
    ];
    for (const [名称, 值] of 数字项) {
      if (值 == null || isNaN(值) || 值 < 0) {
        return { success: false, error: `${名称}必须是不小于 0 的数字` };
      }
    }

    const admin = createAdminClient();
    // 只允许编辑草稿（已审批/已发放的工资单不能动数字，防止改乱）
    const { data: 现有 } = await admin.from("payroll_records").select("status").eq("id", id).limit(1);
    const 行 = (现有 ?? [])[0] as { status: string } | undefined;
    if (!行) return { success: false, error: "工资单不存在" };
    if (行.status !== "draft") {
      return { success: false, error: "只有草稿状态的工资单能修改，已审批的可先退回草稿" };
    }

    const { error: 写错 } = await admin
      .from("payroll_records")
      .update({
        base_salary: 数据.base_salary,
        commission_diagnosis: 数据.commission_diagnosis,
        commission_repair: 数据.commission_repair,
        commission_sales: 数据.commission_sales,
        commission_qc: 数据.commission_qc,
        commission_picking: 数据.commission_picking,
        bonus: 数据.bonus,
        deduction: 数据.deduction,
        should_attendance_days: 数据.should_attendance_days,
        attendance_days: 数据.attendance_days,
        late_count: 数据.late_count,
        attendance_deduction: 数据.attendance_deduction,
        notes: 数据.notes?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (写错) return { success: false, error: "保存失败: " + 写错.message };

    revalidatePath("/finance/payroll");
    return { success: true };
  });
}

// ============================================================
// 状态流转：审批 / 发放 / 退回草稿
// ============================================================

export async function 变更工资单状态(
  id: string,
  动作: "approve" | "pay" | "reopen"
): Promise<{ success: boolean; error?: string }> {
  return 包装ServerAction错误(async () => {
    const 拒绝 = await 校验管理权限();
    if (拒绝) return 拒绝;

    const admin = createAdminClient();
    const { data: 现有 } = await admin.from("payroll_records").select("status").eq("id", id).limit(1);
    const 行 = (现有 ?? [])[0] as { status: string } | undefined;
    if (!行) return { success: false, error: "工资单不存在" };

    let 更新: Record<string, string | null>;
    if (动作 === "approve" && 行.status === "draft") {
      更新 = { status: "approved", updated_at: new Date().toISOString() };
    } else if (动作 === "pay" && 行.status === "approved") {
      更新 = { status: "paid", paid_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    } else if (动作 === "reopen" && 行.status === "approved") {
      更新 = { status: "draft", paid_at: null, updated_at: new Date().toISOString() };
    } else {
      const 状态中文: Record<string, string> = { draft: "草稿", approved: "已审批", paid: "已发放" };
      return { success: false, error: `当前状态是「${状态中文[行.status] || 行.status}」，不能执行这个操作` };
    }

    const { error: 写错 } = await admin.from("payroll_records").update(更新).eq("id", id);
    if (写错) return { success: false, error: "操作失败: " + 写错.message };

    revalidatePath("/finance/payroll");
    return { success: true };
  });
}

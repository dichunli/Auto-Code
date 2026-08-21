/**
 * 考勤出勤天数计算（唯一口径来源）
 *
 * 被三处共用，改动必须三处一起验证：
 *   1. 每日统计页 src/app/attendance/[id]/page.tsx（逐日显示 + 合计）
 *   2. 月报汇总页 src/app/attendance/AttendanceClient.tsx（实出勤汇总）
 *   3. 工资生成 src/app/finance/payroll/actions.ts（底薪折算）
 *
 * 口径（2026-08-21 定）：
 *   有效出勤天数 = manual_days（手动调整）优先，否则按自动规则：
 *     正常/迟到/早退 = 1 天、缺卡 = 0.5 天、缺勤 = 0 天、休息/无数据 = 不计（null）
 */

/** 计算所需的一天考勤字段 */
export interface 出勤天数上下文 {
  has_schedule: boolean;
  day_result: string;
  /** 手动调整后的出勤天数（null/缺省 = 未调整，按自动规则） */
  manual_days?: number | null;
}

/** 允许操作考勤/工资的管理角色（考勤 actions、每日统计页编辑入口共用） */
export const 考勤管理角色名单 = ["admin", "boss", "accountant"];

/**
 * 自动出勤天数：打卡=1（含迟到/早退）、缺卡=0.5、缺勤=0、休息/无数据不计（返回 null）
 */
export function 自动出勤天数(r: 出勤天数上下文): number | null {
  if (!r.has_schedule) return null;
  if (r.day_result === "normal" || r.day_result === "late" || r.day_result === "early") return 1;
  if (r.day_result === "miss_card") return 0.5;
  if (r.day_result === "absent") return 0;
  return null;
}

/**
 * 有效出勤天数：手动调整优先，未调整按自动规则。
 * 展示、汇总、工资折算统一用这个。
 */
export function 有效出勤天数(r: 出勤天数上下文): number | null {
  if (r.manual_days != null) return Number(r.manual_days);
  return 自动出勤天数(r);
}

/**
 * 是否异常行（迟到/早退/缺卡/缺勤）。
 * 只有异常行允许手动调整出勤天数，正常行固定 1 天不让改（2026-08-21 与用户确认）。
 */
export function 是异常行(r: 出勤天数上下文): boolean {
  return (
    r.has_schedule &&
    (r.day_result === "late" ||
      r.day_result === "early" ||
      r.day_result === "miss_card" ||
      r.day_result === "absent")
  );
}

/**
 * 单次打卡是否有效（用于打卡时间显示）。
 * 钉钉对「未打卡」记录返回的 userCheckTime 是计划时间而非真实打卡时间，
 * 所以 NotSigned / 无记录 都不显示时间。
 */
export function 是有效打卡(result: string | null, at: string | null): boolean {
  return !!at && !!result && result !== "NotSigned";
}

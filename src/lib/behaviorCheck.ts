/* ============================================================
   行为考核共享纯函数
   - 本地今日字符串（替代 UTC 日期，凌晨 0-8 点不再算成昨天）
   - 过滤今日任务（daily/weekly/monthly 匹配）
   - 计算时段状态（未开始/检查中/已关闭/已自检待核查/已完成）
   服务端 page.tsx 与客户端 Content 组件共用，不依赖 supabase
   ============================================================ */

/** 本地日期字符串 YYYY-MM-DD（不用 toISOString，它是 UTC 日期） */
export function 本地今日字符串(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** "HH:mm" 或 "HH:mm:ss" 转当天分钟数，如 "08:30" → 510 */
export function 时间转分钟(t: string): number {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export interface 可过滤任务 {
  frequency: string;
  execute_weekday: number | null;
  execute_day: number | null;
}

/** 从任务列表中筛出今天应执行的（daily 恒真；weekly 比周几；monthly 比几号） */
export function 过滤今日任务<T extends 可过滤任务>(tasks: T[], now: Date = new Date()): T[] {
  const weekday = now.getDay();
  const dayOfMonth = now.getDate();
  return tasks.filter((t) => {
    if (t.frequency === "daily") return true;
    if (t.frequency === "weekly" && t.execute_weekday === weekday) return true;
    if (t.frequency === "monthly" && t.execute_day === dayOfMonth) return true;
    return false;
  });
}

/** 时段状态：
 * not_started 未开始（允许提前完成，只提示） / in_window 检查中 /
 * closed 已关闭漏检（禁止提交） / completed 已完成 /
 * reported 已自检待核查（自检合格已计分，超时也不算漏检，检查人仍可改判） */
export type 时段状态 = "not_started" | "in_window" | "closed" | "completed" | "reported";

export function 计算时段状态(
  execute_time: string,
  end_time: string,
  recordStatus: string,
  now: Date = new Date()
): 时段状态 {
  if (recordStatus === "completed") return "completed";
  /* 已自检上报：无论是否超时都不算漏检，恒为待核查（检查人超时仍可改判） */
  if (recordStatus === "self_reported") return "reported";
  const 当前分钟 = now.getHours() * 60 + now.getMinutes();
  if (当前分钟 < 时间转分钟(execute_time)) return "not_started";
  if (当前分钟 > 时间转分钟(end_time)) return "closed";
  return "in_window";
}

/** 时段状态的中文文案与配色（今日考核卡片徽章用） */
export const 时段状态展示: Record<时段状态, { 文案: (start: string, end: string) => string; 样式: string }> = {
  not_started: {
    文案: (start) => `未开始 ${start} 开始`,
    样式: "bg-gray-50 text-gray-500 border border-gray-200",
  },
  in_window: {
    文案: (_start, end) => `检查中，${end} 截止`,
    样式: "bg-blue-50 text-blue-700 border border-blue-200",
  },
  closed: {
    文案: () => "已关闭（漏检）",
    样式: "bg-red-50 text-red-700 border border-red-200",
  },
  reported: {
    文案: () => "已自检待核查",
    样式: "bg-cyan-50 text-cyan-700 border border-cyan-200",
  },
  completed: {
    文案: () => "已完成",
    样式: "bg-green-50 text-green-700 border border-green-200",
  },
};

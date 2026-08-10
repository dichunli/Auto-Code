import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { AttendanceClient, type 考勤记录行, type 扣款设置 } from "./AttendanceClient";

export default async function AttendancePage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  /* 月份解析：默认当月，格式 "2026-08" */
  const 现在 = new Date();
  const 默认月 = `${现在.getFullYear()}-${String(现在.getMonth() + 1).padStart(2, "0")}`;
  const month = /^\d{4}-\d{2}$/.test(params?.month || "") ? (params!.month as string) : 默认月;
  const [年, 月] = month.split("-").map(Number);
  const 当月天数 = new Date(年, 月, 0).getDate();
  const 开始 = `${month}-01`;
  const 结束 = `${month}-${String(当月天数).padStart(2, "0")}`;

  const [{ data: records }, { data: settings }] = await Promise.all([
    supabase
      .from("attendance_records")
      .select(
        "profile_id, work_date, has_schedule, shift_name, check_in_at, check_in_result, check_out_at, check_out_result, day_result, profiles(full_name)"
      )
      .gte("work_date", 开始)
      .lte("work_date", 结束)
      .order("work_date", { ascending: true }),
    supabase
      .from("attendance_settings")
      .select("late_penalty, miss_card_penalty, absent_penalty")
      .limit(1),
  ]);

  const 扣款设置行 = (settings ?? [])[0] as 扣款设置 | undefined;

  return (
    <div className="space-y-6">
      <PageHeader title="考勤月报" description="打卡数据每天凌晨自动从钉钉同步，也可手动补拉" />
      <AttendanceClient
        month={month}
        当月天数={当月天数}
        记录={(records ?? []) as unknown as 考勤记录行[]}
        扣款设置={扣款设置行 ?? { late_penalty: 0, miss_card_penalty: 0, absent_penalty: 0 }}
      />
    </div>
  );
}

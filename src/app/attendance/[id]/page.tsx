import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PrintButton } from "./PrintButton";
import { PersonSwitcher } from "./PersonSwitcher";

/* 个人逐日考勤明细（日报表）：每人每天一行，打卡时间+结果+出勤天数+合计 */

interface 考勤日记录 {
  work_date: string;
  has_schedule: boolean;
  check_in_at: string | null;
  check_in_result: string | null;
  check_out_at: string | null;
  check_out_result: string | null;
  day_result: string;
}

const 星期名 = ["日", "一", "二", "三", "四", "五", "六"];

/** 钉钉判定结果 → 中文 + 底色 */
const 结果展示: Record<string, { 文字: string; className: string }> = {
  Normal: { 文字: "正常", className: "" },
  Late: { 文字: "迟到", className: "bg-amber-100 text-amber-800" },
  SeriousLate: { 文字: "严重迟到", className: "bg-orange-100 text-orange-800" },
  Absenteeism: { 文字: "旷工迟到", className: "bg-red-100 text-red-800" },
  Early: { 文字: "早退", className: "bg-orange-100 text-orange-800" },
  NotSigned: { 文字: "未打卡", className: "bg-red-100 text-red-700" },
};

/** ISO 时间 → "07:42"（服务端渲染，服务器时区即北京时间） */
function 格式化时分(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 出勤天数规则（已定）：打卡=1（含迟到/早退）、缺卡=0.5、缺勤=0、休息/无数据不计 */
function 出勤天数(r: 考勤日记录): number | null {
  if (!r.has_schedule) return null;
  if (r.day_result === "normal" || r.day_result === "late" || r.day_result === "early") return 1;
  if (r.day_result === "miss_card") return 0.5;
  if (r.day_result === "absent") return 0;
  return null;
}

/** 单次打卡的结果单元格（无打卡记录但有排班 → 缺卡） */
function 打卡结果格(结果: string | null, has排班: boolean) {
  if (!has排班) return { 文字: "—", className: "text-gray-300" };
  if (!结果) return { 文字: "缺卡", className: "bg-red-100 text-red-700" };
  return 结果展示[结果] ?? { 文字: 结果, className: "" };
}

export default async function 个人考勤明细页({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ month?: string }>;
}) {
  const { id } = await params;
  const 查询 = await searchParams;
  const supabase = await createClient();

  /* 月份解析，默认当月 */
  const 现在 = new Date();
  const 默认月 = `${现在.getFullYear()}-${String(现在.getMonth() + 1).padStart(2, "0")}`;
  const month = /^\d{4}-\d{2}$/.test(查询?.month || "") ? (查询!.month as string) : 默认月;
  const [年, 月] = month.split("-").map(Number);
  const 当月天数 = new Date(年, 月, 0).getDate();
  const 开始 = `${month}-01`;
  const 结束 = `${month}-${String(当月天数).padStart(2, "0")}`;

  const { data: 员工 } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("id", id)
    .single();
  if (!员工) notFound();

  /* 人员切换列表：所有已绑定钉钉的在职员工（考勤对象） */
  const { data: 绑定员工数据 } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("is_active", true)
    .not("dingtalk_userid", "is", null)
    .order("full_name", { ascending: true });
  const 绑定员工们 = (绑定员工数据 ?? []) as { id: string; full_name: string }[];

  const { data: 记录数据 } = await supabase
    .from("attendance_records")
    .select("work_date, has_schedule, check_in_at, check_in_result, check_out_at, check_out_result, day_result")
    .eq("profile_id", id)
    .gte("work_date", 开始)
    .lte("work_date", 结束)
    .order("work_date", { ascending: true });

  const 记录们 = (记录数据 ?? []) as 考勤日记录[];
  const 按天 = new Map(记录们.map((r) => [r.work_date, r]));

  /* 当月每一天都列出来（未同步的天显示空缺） */
  const 天列表: string[] = [];
  for (let d = 1; d <= 当月天数; d++) {
    天列表.push(`${month}-${String(d).padStart(2, "0")}`);
  }

  /* 合计出勤天数 */
  let 合计 = 0;
  for (const r of 记录们) {
    const n = 出勤天数(r);
    if (n != null) 合计 += n;
  }

  /* 上月/下月 */
  const 偏移 = (n: number) => {
    const d = new Date(年, 月 - 1 + n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* 操作条（打印时隐藏） */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Link
          href={`/attendance?month=${month}`}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50"
        >
          ← 返回月报
        </Link>
        <PersonSwitcher 员工们={绑定员工们} 当前id={id} month={month} />
        <Link
          href={`/attendance/${id}?month=${偏移(-1)}`}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50"
        >
          ← 上月
        </Link>
        <span className="text-sm text-gray-700 font-medium">{month}</span>
        <Link
          href={`/attendance/${id}?month=${偏移(1)}`}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50"
        >
          下月 →
        </Link>
        <div className="ml-auto">
          <PrintButton />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* 表头（照钉钉日报表样式） */}
        <div className="px-4 py-3 border-b border-gray-200 bg-cyan-50">
          <span className="font-bold text-gray-900">每日统计</span>
          <span className="ml-3 text-gray-700">
            统计日期：{开始} 至 {结束}
          </span>
          <span className="ml-3 font-medium text-gray-900">{(员工 as { full_name: string }).full_name}</span>
        </div>

        <table className="w-full text-sm">
          <thead className="bg-amber-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-700 border-b border-gray-200">日期</th>
              <th className="px-4 py-2 text-center font-medium text-gray-700 border-b border-gray-200">上班打卡时间</th>
              <th className="px-4 py-2 text-center font-medium text-gray-700 border-b border-gray-200">上班打卡结果</th>
              <th className="px-4 py-2 text-center font-medium text-gray-700 border-b border-gray-200">下班打卡时间</th>
              <th className="px-4 py-2 text-center font-medium text-gray-700 border-b border-gray-200">下班打卡结果</th>
              <th className="px-4 py-2 text-center font-medium text-gray-700 border-b border-gray-200">出勤天数</th>
            </tr>
          </thead>
          <tbody>
            {天列表.map((日期串) => {
              const r = 按天.get(日期串);
              const 日期对象 = new Date(日期串 + "T00:00:00");
              const 星期几 = 日期对象.getDay();
              const 是周末 = 星期几 === 0 || 星期几 === 6;
              const 日期显示 = `${日期串.slice(2)} 星期${星期名[星期几]}`;
              const 上班 = r ? 打卡结果格(r.check_in_result, r.has_schedule) : null;
              const 下班 = r ? 打卡结果格(r.check_out_result, r.has_schedule) : null;
              const 天数 = r ? 出勤天数(r) : null;
              return (
                <tr key={日期串} className="border-b border-gray-100">
                  <td className={`px-4 py-1.5 ${是周末 ? "text-red-600 font-medium" : "text-gray-700"}`}>
                    {日期显示}
                  </td>
                  {r && r.has_schedule ? (
                    <>
                      <td className="px-4 py-1.5 text-center text-gray-900">{格式化时分(r.check_in_at)}</td>
                      <td className="px-4 py-1.5 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded ${上班!.className}`}>{上班!.文字}</span>
                      </td>
                      <td className="px-4 py-1.5 text-center text-gray-900">{格式化时分(r.check_out_at)}</td>
                      <td className="px-4 py-1.5 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded ${下班!.className}`}>{下班!.文字}</span>
                      </td>
                      <td className="px-4 py-1.5 text-center text-gray-900">{天数 || ""}</td>
                    </>
                  ) : (
                    <td colSpan={5} className="px-4 py-1.5 text-center text-gray-400">
                      {r ? "休息" : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50">
              <td colSpan={5} className="px-4 py-2 font-bold text-gray-900">合计：</td>
              <td className="px-4 py-2 text-center font-bold text-gray-900">{合计}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-gray-400 print:hidden">
        出勤天数规则：上下班都打卡 = 1 天；只打了一次卡（缺卡）= 0.5 天；完全没打卡 = 0 天；休息日不计。
      </p>
    </div>
  );
}

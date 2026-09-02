import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PrintButton } from "./PrintButton";
import { PersonSwitcher } from "./PersonSwitcher";
import { DayCountCell } from "./DayCountCell";
import { 考勤管理角色名单, 有效出勤天数, 自动出勤天数, 是异常行, 是有效打卡 } from "@/lib/attendanceDays";

/* 个人逐日考勤明细（日报表）：每人每天一行，打卡时间+结果+出勤天数+合计 */

interface 考勤日记录 {
  work_date: string;
  has_schedule: boolean;
  check_in_at: string | null;
  check_in_result: string | null;
  check_out_at: string | null;
  check_out_result: string | null;
  day_result: string;
  manual_days: number | null;
  manual_note: string | null;
}

const 星期名 = ["日", "一", "二", "三", "四", "五", "六"];

/** 钉钉判定结果 → 中文 + 整格底色（照钉钉导出报表：迟到绿底、早退黄底、缺卡红底，字黑加粗） */
const 结果展示: Record<string, { 文字: string; className: string }> = {
  Normal: { 文字: "正常", className: "text-black" },
  Late: { 文字: "迟到", className: "bg-green-300 text-black font-bold" },
  SeriousLate: { 文字: "严重迟到", className: "bg-green-300 text-black font-bold" },
  Absenteeism: { 文字: "旷工迟到", className: "bg-green-300 text-black font-bold" },
  Early: { 文字: "早退", className: "bg-yellow-200 text-black font-bold" },
  NotSigned: { 文字: "缺卡", className: "bg-red-400 text-black font-bold" },
};

/** ISO 时间 → "07:42"（服务端渲染，服务器时区即北京时间） */
function 格式化时分(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 单次打卡的结果单元格（无打卡记录但有排班 → 缺卡；底色铺在 td 上整格填充） */
function 打卡结果格(结果: string | null, has排班: boolean) {
  if (!has排班) return { 文字: "—", className: "text-gray-400" };
  if (!结果) return { 文字: "缺卡", className: "bg-red-400 text-black font-bold" };
  return 结果展示[结果] ?? { 文字: 结果, className: "text-black" };
}

/* 表格单元格基础样式（照钉钉导出报表：黑色实线网格、居中、行高加大） */
const 格 = "border border-black px-2 py-0 text-center";

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
    .select("work_date, has_schedule, check_in_at, check_in_result, check_out_at, check_out_result, day_result, manual_days, manual_note")
    .eq("profile_id", id)
    .gte("work_date", 开始)
    .lte("work_date", 结束)
    .order("work_date", { ascending: true });

  const 记录们 = (记录数据 ?? []) as 考勤日记录[];
  const 按天 = new Map(记录们.map((r) => [r.work_date, r]));
  const 员工姓名 = (员工 as { full_name: string }).full_name;

  /* 当前登录用户是否管理角色（决定出勤天数是否显示编辑入口） */
  const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user ?? null; /* getSession本地读不联网 */ 
  let 是管理 = false;
  if (user) {
    const { data: 角色数据 } = await supabase
      .from("profile_roles")
      .select("roles(name)")
      .eq("profile_id", user.id);
    是管理 = ((角色数据 ?? []) as unknown as { roles?: { name?: string } | null }[]).some(
      (d) => d.roles?.name != null && 考勤管理角色名单.includes(d.roles.name)
    );
  }

  /* 当月每一天都列出来（未同步的天显示空缺） */
  const 天列表: string[] = [];
  for (let d = 1; d <= 当月天数; d++) {
    天列表.push(`${month}-${String(d).padStart(2, "0")}`);
  }

  /* 合计出勤天数（有效口径：手动调整优先） */
  let 合计 = 0;
  for (const r of 记录们) {
    const n = 有效出勤天数(r);
    if (n != null) 合计 += n;
  }

  /* 上月/下月 */
  const 偏移 = (n: number) => {
    const d = new Date(年, 月 - 1 + n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };

  return (
    <div className="max-w-4xl mx-auto space-y-1">
      {/* 操作条（打印时隐藏） */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Link
          href={`/attendance?month=${month}`}
          className="px-2 py-1 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50"
        >
          ← 返回月报
        </Link>
        <PersonSwitcher 员工们={绑定员工们} 当前id={id} month={month} />
        <Link
          href={`/attendance/${id}?month=${偏移(-1)}`}
          className="px-2 py-1 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50"
        >
          ← 上月
        </Link>
        <span className="text-sm text-gray-700 font-medium">{month}</span>
        <Link
          href={`/attendance/${id}?month=${偏移(1)}`}
          className="px-2 py-1 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50"
        >
          下月 →
        </Link>
        <div className="ml-auto">
          <PrintButton />
        </div>
      </div>

      {/* 每日统计表（照钉钉导出报表样式：标题青底、表头黄底、黑色网格线、缺卡红底/迟到绿底/早退黄底） */}
      <div className="overflow-x-auto">
        <table className="w-auto mx-auto text-sm bg-white border-collapse">
          <thead>
            <tr>
              <th colSpan={7} className={`${格} bg-cyan-100 text-base font-bold text-black`}>
                每日统计　统计日期：{开始} 至 {结束}
              </th>
            </tr>
            <tr>
              <th className={`${格} bg-yellow-100 font-bold text-black`}>姓名</th>
              <th className={`${格} bg-yellow-100 font-bold text-black`}>日期</th>
              <th className={`${格} bg-yellow-100 font-bold text-black`}>上班时间</th>
              <th className={`${格} bg-yellow-100 font-bold text-black`}>上班结果</th>
              <th className={`${格} bg-yellow-100 font-bold text-black`}>下班时间</th>
              <th className={`${格} bg-yellow-100 font-bold text-black`}>下班结果</th>
              <th className={`${格} bg-yellow-100 font-bold text-black`}>天数</th>
            </tr>
          </thead>
          <tbody>
            {天列表.map((日期串) => {
              const r = 按天.get(日期串);
              const 日期对象 = new Date(日期串 + "T00:00:00");
              const 星期几 = 日期对象.getDay();
              const 是周末 = 星期几 === 0 || 星期几 === 6;
              const 日期显示 = `${日期串.slice(5)} 周${星期名[星期几]}`;
              const 上班 = r ? 打卡结果格(r.check_in_result, r.has_schedule) : null;
              const 下班 = r ? 打卡结果格(r.check_out_result, r.has_schedule) : null;
              /* 打卡时间只显示真实打卡：未打卡（NotSigned/无记录）时库里可能是计划时间，不显示 */
              const 上班时间显示 = r && 是有效打卡(r.check_in_result, r.check_in_at) ? 格式化时分(r.check_in_at) : "";
              const 下班时间显示 = r && 是有效打卡(r.check_out_result, r.check_out_at) ? 格式化时分(r.check_out_at) : "";
              return (
                <tr key={日期串}>
                  <td className={`${格} text-black whitespace-nowrap`}>{员工姓名}</td>
                  <td className={`${格} w-24 whitespace-nowrap ${是周末 ? "text-red-600 font-bold" : "text-black"}`}>
                    {日期显示}
                  </td>
                  {r && r.has_schedule ? (
                    <>
                      <td className={`${格} text-black`}>{上班时间显示}</td>
                      <td className={`${格} ${上班!.className}`}>{上班!.文字}</td>
                      <td className={`${格} text-black`}>{下班时间显示}</td>
                      <td className={`${格} ${下班!.className}`}>{下班!.文字}</td>
                      <td className={`${格} text-black`}>
                        <DayCountCell
                          profileId={id}
                          workDate={日期串}
                          自动天数={自动出勤天数(r)}
                          手动天数={r.manual_days}
                          可编辑={是管理 && 是异常行(r)}
                        />
                      </td>
                    </>
                  ) : (
                    <td colSpan={5} className={`${格} text-gray-400`}>
                      {r ? "休息" : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className={`${格} text-left font-bold text-black`}>合计：</td>
              <td className={格}></td>
              <td className={格}></td>
              <td className={格}></td>
              <td className={格}></td>
              <td className={格}></td>
              <td className={`${格} text-right font-bold text-black`}>{合计}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-gray-400 print:hidden">
        打卡规则：全打=1天，缺卡=0.5天，未打=0天，休息不计；异常日期可点天数手动调。
      </p>
    </div>
  );
}

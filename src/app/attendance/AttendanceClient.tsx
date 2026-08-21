"use client";

/**
 * 考勤月报客户端组件
 *  - 工具条：月份切换 / 立即同步 / 匹配钉钉账号 / 扣款标准
 *  - 汇总表：每人应出勤、实出勤、迟到、缺卡、缺勤、预估扣款
 *  - 明细表：员工 × 日期大格子（正/迟/早/卡/缺/休），鼠标悬停看打卡时间
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { 手动同步考勤, 自动匹配钉钉账号, 保存考勤扣款设置 } from "./actions";
import { 有效出勤天数, 是有效打卡 } from "@/lib/attendanceDays";

// ============================================================
// 类型定义
// ============================================================

export interface 考勤记录行 {
  profile_id: string;
  work_date: string;
  has_schedule: boolean;
  shift_name: string | null;
  check_in_at: string | null;
  check_in_result: string | null;
  check_out_at: string | null;
  check_out_result: string | null;
  day_result: string;
  /** 手动调整后的出勤天数（null=按自动规则） */
  manual_days: number | null;
  profiles: { full_name: string | null } | null;
}

export interface 扣款设置 {
  late_penalty: number;
  miss_card_penalty: number;
  absent_penalty: number;
}

interface 员工汇总 {
  profile_id: string;
  姓名: string;
  应出勤: number;
  实出勤: number;
  迟到: number;
  缺卡: number;
  缺勤: number;
  /** work_date → 当天记录 */
  按天: Map<string, 考勤记录行>;
}

// ============================================================
// 展示辅助
// ============================================================

/** 当天判定 → 格子文字与颜色 */
const 结果样式: Record<string, { 字: string; className: string }> = {
  normal: { 字: "正", className: "bg-green-100 text-green-700" },
  late: { 字: "迟", className: "bg-amber-100 text-amber-700" },
  early: { 字: "早", className: "bg-orange-100 text-orange-700" },
  miss_card: { 字: "卡", className: "bg-red-100 text-red-700" },
  absent: { 字: "缺", className: "bg-red-200 text-red-800" },
  rest: { 字: "休", className: "bg-gray-50 text-gray-300" },
};

/** 钉钉英文判定 → 中文 */
const 钉钉结果中文: Record<string, string> = {
  Normal: "正常",
  Late: "迟到",
  SeriousLate: "严重迟到",
  Absenteeism: "旷工迟到",
  Early: "早退",
  NotSigned: "未打卡",
};

/** ISO 时间 → "08:32" */
function 格式化时分(iso: string | null): string {
  if (!iso) return "--:--";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 月份偏移："2026-08" ± n → "2026-07" */
function 偏移月份(月串: string, 偏移: number): string {
  const [y, m] = 月串.split("-").map(Number);
  const d = new Date(y, m - 1 + 偏移, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 昨天的日期串 "2026-08-08" */
function 昨天日期串(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ============================================================
// 同步弹窗（独立组件，禁止定义在父组件内；组件名 PascalCase 以便 lint 识别）
// ============================================================

function SyncModal({ on关闭 }: { on关闭: () => void }) {
  const router = useRouter();
  const 昨天 = 昨天日期串();
  const [开始, set开始] = useState(昨天);
  const [结束, set结束] = useState(昨天);
  const [同步中, set同步中] = useState(false);

  async function 执行同步() {
    set同步中(true);
    try {
      const res = await 手动同步考勤(开始, 结束);
      if (res.success && res.data) {
        alert(`同步完成：${res.data.天数} 天、${res.data.员工数} 名员工、写入 ${res.data.写入条数} 条记录`);
        on关闭();
        router.refresh();
      } else {
        alert("同步失败：" + (res.error || "未知错误"));
      }
    } catch {
      alert("同步失败：网络异常，请稍后再试");
    } finally {
      set同步中(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <h3 className="text-lg font-bold text-gray-900">从钉钉同步考勤</h3>
        <p className="text-sm text-gray-500">重复同步会覆盖旧数据，可以放心重拉。一次最多 62 天。</p>
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="text-gray-600">开始日期</span>
            <input
              type="date"
              value={开始}
              onChange={(e) => set开始(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-gray-600">结束日期</span>
            <input
              type="date"
              value={结束}
              onChange={(e) => set结束(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </label>
        </div>
        <div className="flex gap-3 pt-2">
          <button
            onClick={执行同步}
            disabled={同步中}
            className="flex-1 bg-blue-600 text-white rounded-lg py-2 font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {同步中 ? "同步中..." : "开始同步"}
          </button>
          <button
            onClick={on关闭}
            disabled={同步中}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 扣款标准弹窗（独立组件）
// ============================================================

function SettingsModal({ 初始, on关闭 }: { 初始: 扣款设置; on关闭: () => void }) {
  const router = useRouter();
  /* 数字字段按项目规范用字符串存储，保存时转 number */
  const [迟到, set迟到] = useState(String(初始.late_penalty));
  const [缺卡, set缺卡] = useState(String(初始.miss_card_penalty));
  const [缺勤, set缺勤] = useState(String(初始.absent_penalty));
  const [保存中, set保存中] = useState(false);

  async function 执行保存() {
    const 迟到数 = Number(迟到) || 0;
    const 缺卡数 = Number(缺卡) || 0;
    const 缺勤数 = Number(缺勤) || 0;
    if (迟到数 < 0 || 缺卡数 < 0 || 缺勤数 < 0) {
      alert("扣款金额不能是负数");
      return;
    }
    set保存中(true);
    try {
      const res = await 保存考勤扣款设置(迟到数, 缺卡数, 缺勤数);
      if (res.success) {
        alert("保存成功");
        on关闭();
        router.refresh();
      } else {
        alert("保存失败：" + (res.error || "未知错误"));
      }
    } catch {
      alert("保存失败：网络异常，请稍后再试");
    } finally {
      set保存中(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <h3 className="text-lg font-bold text-gray-900">考勤扣款标准</h3>
        <p className="text-sm text-gray-500">
          缺勤当天底薪已经按出勤折算少发，「缺勤每天扣款」是额外处罚，一般填 0。
        </p>
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="text-gray-600">迟到每次扣款（元）</span>
            <input
              type="number"
              min="0"
              step="1"
              value={迟到}
              onChange={(e) => set迟到(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-gray-600">缺卡每次扣款（元）</span>
            <input
              type="number"
              min="0"
              step="1"
              value={缺卡}
              onChange={(e) => set缺卡(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-gray-600">缺勤每天额外扣款（元）</span>
            <input
              type="number"
              min="0"
              step="1"
              value={缺勤}
              onChange={(e) => set缺勤(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </label>
        </div>
        <div className="flex gap-3 pt-2">
          <button
            onClick={执行保存}
            disabled={保存中}
            className="flex-1 bg-blue-600 text-white rounded-lg py-2 font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {保存中 ? "保存中..." : "保存"}
          </button>
          <button
            onClick={on关闭}
            disabled={保存中}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 主组件
// ============================================================

export function AttendanceClient({
  month,
  当月天数,
  记录,
  扣款设置,
}: {
  month: string;
  当月天数: number;
  记录: 考勤记录行[];
  扣款设置: 扣款设置;
}) {
  const router = useRouter();
  const [显示同步弹窗, set显示同步弹窗] = useState(false);
  const [显示设置弹窗, set显示设置弹窗] = useState(false);
  const [匹配中, set匹配中] = useState(false);

  /* 按员工聚合汇总（记录变化时才重算） */
  const 汇总 = useMemo<员工汇总[]>(() => {
    const 按员工 = new Map<string, 员工汇总>();
    for (const r of 记录) {
      let 员 = 按员工.get(r.profile_id);
      if (!员) {
        员 = {
          profile_id: r.profile_id,
          姓名: r.profiles?.full_name || "未知员工",
          应出勤: 0,
          实出勤: 0,
          迟到: 0,
          缺卡: 0,
          缺勤: 0,
          按天: new Map(),
        };
        按员工.set(r.profile_id, 员);
      }
      员.按天.set(r.work_date, r);
      if (r.has_schedule) {
        员.应出勤 += 1;
        /* 实出勤 = Σ有效出勤天数（手动调整优先；缺卡 0.5 天），与每日统计页、工资折算同口径 */
        员.实出勤 += 有效出勤天数(r) ?? 0;
        if (r.day_result === "late") 员.迟到 += 1;
        if (r.day_result === "miss_card") 员.缺卡 += 1;
        if (r.day_result === "absent") 员.缺勤 += 1;
      }
    }
    return [...按员工.values()].sort((a, b) => a.姓名.localeCompare(b.姓名, "zh"));
  }, [记录]);

  /* 日期列表 ["01","02",...,"31"] */
  const 日期们 = useMemo(
    () => Array.from({ length: 当月天数 }, (_, i) => String(i + 1).padStart(2, "0")),
    [当月天数]
  );

  /* 预估考勤扣款 */
  function 预估扣款(员: 员工汇总): number {
    return (
      员.迟到 * 扣款设置.late_penalty +
      员.缺卡 * 扣款设置.miss_card_penalty +
      员.缺勤 * 扣款设置.absent_penalty
    );
  }

  async function 执行匹配() {
    if (!confirm("将按员工档案里的手机号自动匹配钉钉账号（已绑定的不动）。继续？")) return;
    set匹配中(true);
    try {
      const res = await 自动匹配钉钉账号();
      if (res.success && res.data) {
        const { 成功, 失败 } = res.data;
        let 消息 = `匹配完成：成功 ${成功.length} 人`;
        if (成功.length > 0) 消息 += `\n${成功.join("、")}`;
        if (失败.length > 0) {
          消息 += `\n\n失败 ${失败.length} 人：\n` + 失败.map((f) => `${f.姓名}：${f.原因}`).join("\n");
        }
        alert(消息);
        router.refresh();
      } else {
        alert("匹配失败：" + (res.error || "未知错误"));
      }
    } catch {
      alert("匹配失败：网络异常，请稍后再试");
    } finally {
      set匹配中(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* 工具条 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => router.push(`/attendance?month=${偏移月份(month, -1)}`)}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50"
        >
          ← 上月
        </button>
        <input
          type="month"
          value={month}
          onChange={(e) => e.target.value && router.push(`/attendance?month=${e.target.value}`)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
        />
        <button
          onClick={() => router.push(`/attendance?month=${偏移月份(month, 1)}`)}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50"
        >
          下月 →
        </button>

        <div className="ml-auto flex flex-wrap gap-2">
          <button
            onClick={() => set显示同步弹窗(true)}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          >
            立即同步
          </button>
          <button
            onClick={执行匹配}
            disabled={匹配中}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-green-300 bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50"
          >
            {匹配中 ? "匹配中..." : "匹配钉钉账号"}
          </button>
          <button
            onClick={() => set显示设置弹窗(true)}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          >
            扣款标准
          </button>
        </div>
      </div>

      {记录.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          本月还没有考勤数据。点右上角「立即同步」从钉钉拉取；新接入时建议先同步上个月整月。
        </div>
      ) : (
        <>
          {/* 汇总表 */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 font-medium text-gray-900">月度汇总</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">员工</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-500">应出勤</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-500">实出勤</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-500">迟到</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-500">缺卡</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-500">缺勤</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-500">预估扣款</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {汇总.map((员) => (
                    <tr key={员.profile_id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-medium">
                        <Link href={`/attendance/${员.profile_id}?month=${month}`} className="text-blue-600 hover:underline">
                          {员.姓名}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{员.应出勤} 天</td>
                      <td className="px-4 py-2.5 text-right text-gray-900">{员.实出勤} 天</td>
                      <td className={`px-4 py-2.5 text-right ${员.迟到 > 0 ? "text-amber-600 font-medium" : "text-gray-400"}`}>
                        {员.迟到 > 0 ? `${员.迟到} 次` : "-"}
                      </td>
                      <td className={`px-4 py-2.5 text-right ${员.缺卡 > 0 ? "text-red-600 font-medium" : "text-gray-400"}`}>
                        {员.缺卡 > 0 ? `${员.缺卡} 次` : "-"}
                      </td>
                      <td className={`px-4 py-2.5 text-right ${员.缺勤 > 0 ? "text-red-700 font-bold" : "text-gray-400"}`}>
                        {员.缺勤 > 0 ? `${员.缺勤} 天` : "-"}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-600">
                        {预估扣款(员) > 0 ? `¥${预估扣款(员).toFixed(2)}` : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 明细格子表 */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 font-medium text-gray-900">
              每日明细
              <span className="ml-3 text-xs font-normal text-gray-400">
                正=正常 迟=迟到 早=早退 卡=缺卡 缺=缺勤 休=休息，鼠标悬停看打卡时间
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-500 sticky left-0 bg-gray-50">员工</th>
                    {日期们.map((d) => (
                      <th key={d} className="px-1 py-2 font-medium text-gray-500 min-w-7 text-center">
                        {Number(d)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {汇总.map((员) => (
                    <tr key={员.profile_id} className="hover:bg-gray-50">
                      <td className="px-3 py-1.5 font-medium whitespace-nowrap sticky left-0 bg-white">
                        <Link href={`/attendance/${员.profile_id}?month=${month}`} className="text-blue-600 hover:underline">
                          {员.姓名}
                        </Link>
                      </td>
                      {日期们.map((d) => {
                        const r = 员.按天.get(`${month}-${d}`);
                        if (!r) {
                          return <td key={d} className="px-1 py-1.5 text-center text-gray-200">·</td>;
                        }
                        const 样式 = 结果样式[r.day_result] ?? 结果样式.rest;
                        /* 打卡时间只显示真实打卡：未打卡（NotSigned/无记录）显示 --:-- */
                        const 上班时间 = 是有效打卡(r.check_in_result, r.check_in_at) ? 格式化时分(r.check_in_at) : "--:--";
                        const 下班时间 = 是有效打卡(r.check_out_result, r.check_out_at) ? 格式化时分(r.check_out_at) : "--:--";
                        const 提示 = r.has_schedule
                          ? `${r.work_date}${r.shift_name ? " " + r.shift_name : ""}\n上班 ${上班时间}（${钉钉结果中文[r.check_in_result || ""] || "未打卡"}）\n下班 ${下班时间}（${钉钉结果中文[r.check_out_result || ""] || "未打卡"}）`
                          : `${r.work_date} 休息`;
                        return (
                          <td key={d} className="px-1 py-1.5 text-center">
                            <span
                              title={提示}
                              className={`inline-block w-6 h-6 leading-6 rounded text-center ${样式.className}`}
                            >
                              {样式.字}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {显示同步弹窗 && <SyncModal on关闭={() => set显示同步弹窗(false)} />}
      {显示设置弹窗 && <SettingsModal 初始={扣款设置} on关闭={() => set显示设置弹窗(false)} />}
    </div>
  );
}

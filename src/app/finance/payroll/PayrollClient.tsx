"use client";

/**
 * 工资提成客户端组件
 *  - 生成月工资单：选月份 → 自动算折算底薪和考勤扣款（提成人工填）
 *  - 编辑工资单：草稿状态可改所有数字
 *  - 状态流转：审批 / 发放 / 退回草稿
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { 生成工资单, 更新工资单, 变更工资单状态, type 工资单编辑数据 } from "./actions";
import { formatCurrency } from "@/lib/utils";

// ============================================================
// 类型定义
// ============================================================

export interface 工资记录 {
  id: string;
  profile_id: string;
  status: string;
  period_start: string;
  period_end: string;
  base_salary: number | null;
  commission_diagnosis: number | null;
  commission_repair: number | null;
  commission_sales: number | null;
  commission_qc: number | null;
  commission_picking: number | null;
  commission_total: number | null;
  bonus: number | null;
  deduction: number | null;
  total_amount: number | null;
  should_attendance_days: number | null;
  attendance_days: number | null;
  late_count: number | null;
  attendance_deduction: number | null;
  notes: string | null;
  profiles: { full_name: string | null; mechanic_levels: { name: string | null } | null } | null;
}

const 状态样式: Record<string, { label: string; className: string }> = {
  draft: { label: "草稿", className: "bg-gray-50 text-gray-600" },
  approved: { label: "已审批", className: "bg-blue-50 text-blue-700" },
  paid: { label: "已发放", className: "bg-green-50 text-green-700" },
};

/** 上个月的 "2026-07" */
function 上月串(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ============================================================
// 生成工资单弹窗
// ============================================================

function GenerateModal({ on关闭 }: { on关闭: () => void }) {
  const router = useRouter();
  const [月份, set月份] = useState(上月串());
  const [生成中, set生成中] = useState(false);

  async function 执行生成() {
    if (!月份) {
      alert("请选择月份");
      return;
    }
    set生成中(true);
    try {
      const res = await 生成工资单(月份);
      if (res.success && res.data) {
        let 消息 = `生成完成：${res.data.生成数} 名员工的工资单（草稿）`;
        if (res.data.跳过名单.length > 0) {
          消息 += `\n\n以下员工本月已有工资单，未重复生成：\n${res.data.跳过名单.join("、")}`;
        }
        消息 += `\n\n注意：提成列为 0，请核对业绩后点「编辑」手工填写；底薪和考勤扣款已自动算好。`;
        alert(消息);
        on关闭();
        router.refresh();
      } else {
        alert("生成失败：" + (res.error || "未知错误"));
      }
    } catch {
      alert("生成失败：网络异常，请稍后再试");
    } finally {
      set生成中(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <h3 className="text-lg font-bold text-gray-900">生成月工资单</h3>
        <div className="text-sm text-gray-500 space-y-1">
          <p>对每位在职员工自动生成草稿工资单：</p>
          <p>· 底薪 = 月底薪 × 实际出勤 ÷ 应出勤</p>
          <p>· 扣款 = 迟到/缺卡/缺勤 × 扣款标准</p>
          <p>· 提成列先填 0，生成后人工核对填写</p>
          <p className="text-amber-600">生成前请先在「考勤月报」同步该月数据；员工请假请生成后手改出勤天数。</p>
        </div>
        <label className="block text-sm">
          <span className="text-gray-600">工资月份</span>
          <input
            type="month"
            value={月份}
            onChange={(e) => set月份(e.target.value)}
            className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
          />
        </label>
        <div className="flex gap-3 pt-2">
          <button
            onClick={执行生成}
            disabled={生成中}
            className="flex-1 bg-blue-600 text-white rounded-lg py-2 font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {生成中 ? "生成中..." : "生成"}
          </button>
          <button
            onClick={on关闭}
            disabled={生成中}
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
// 编辑工资单弹窗（数字字段统一字符串存储，保存时转 number）
// ============================================================

function EditModal({ 记录, on关闭 }: { 记录: 工资记录; on关闭: () => void }) {
  const router = useRouter();
  const [底薪, set底薪] = useState(String(记录.base_salary ?? 0));
  const [诊断提成, set诊断提成] = useState(String(记录.commission_diagnosis ?? 0));
  const [维修提成, set维修提成] = useState(String(记录.commission_repair ?? 0));
  const [销售提成, set销售提成] = useState(String(记录.commission_sales ?? 0));
  const [质检提成, set质检提成] = useState(String(记录.commission_qc ?? 0));
  const [拣货提成, set拣货提成] = useState(String(记录.commission_picking ?? 0));
  const [奖金, set奖金] = useState(String(记录.bonus ?? 0));
  const [扣款, set扣款] = useState(String(记录.deduction ?? 0));
  const [应出勤, set应出勤] = useState(记录.should_attendance_days != null ? String(记录.should_attendance_days) : "");
  const [实出勤, set实出勤] = useState(记录.attendance_days != null ? String(记录.attendance_days) : "");
  const [备注, set备注] = useState(记录.notes || "");
  const [保存中, set保存中] = useState(false);

  /* 实时预览合计（仅展示，最终以数据库计算列为准） */
  const 数字 = (s: string) => Number(s) || 0;
  const 提成合计 = 数字(诊断提成) + 数字(维修提成) + 数字(销售提成) + 数字(质检提成) + 数字(拣货提成);
  const 实发预览 = 数字(底薪) + 提成合计 + 数字(奖金) - 数字(扣款);

  async function 执行保存() {
    const 数据: 工资单编辑数据 = {
      base_salary: 数字(底薪),
      commission_diagnosis: 数字(诊断提成),
      commission_repair: 数字(维修提成),
      commission_sales: 数字(销售提成),
      commission_qc: 数字(质检提成),
      commission_picking: 数字(拣货提成),
      bonus: 数字(奖金),
      deduction: 数字(扣款),
      should_attendance_days: 应出勤.trim() ? 数字(应出勤) : null,
      attendance_days: 实出勤.trim() ? 数字(实出勤) : null,
      late_count: 记录.late_count ?? 0,
      attendance_deduction: 记录.attendance_deduction ?? 0,
      notes: 备注.trim() || null,
    };
    set保存中(true);
    try {
      const res = await 更新工资单(记录.id, 数据);
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

  const 输入框类 = "mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-bold text-gray-900">
          编辑工资单：{记录.profiles?.full_name || ""}
          <span className="ml-2 text-sm font-normal text-gray-400">{记录.period_start} ~ {记录.period_end}</span>
        </h3>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="text-gray-600">底薪（已按出勤折算）</span>
            <input type="number" min="0" step="0.01" value={底薪} onChange={(e) => set底薪(e.target.value)} className={输入框类} />
          </label>
          <label className="block text-sm">
            <span className="text-gray-600">奖金</span>
            <input type="number" min="0" step="0.01" value={奖金} onChange={(e) => set奖金(e.target.value)} className={输入框类} />
          </label>
          <label className="block text-sm">
            <span className="text-gray-600">诊断提成</span>
            <input type="number" min="0" step="0.01" value={诊断提成} onChange={(e) => set诊断提成(e.target.value)} className={输入框类} />
          </label>
          <label className="block text-sm">
            <span className="text-gray-600">维修提成</span>
            <input type="number" min="0" step="0.01" value={维修提成} onChange={(e) => set维修提成(e.target.value)} className={输入框类} />
          </label>
          <label className="block text-sm">
            <span className="text-gray-600">销售提成</span>
            <input type="number" min="0" step="0.01" value={销售提成} onChange={(e) => set销售提成(e.target.value)} className={输入框类} />
          </label>
          <label className="block text-sm">
            <span className="text-gray-600">质检提成</span>
            <input type="number" min="0" step="0.01" value={质检提成} onChange={(e) => set质检提成(e.target.value)} className={输入框类} />
          </label>
          <label className="block text-sm">
            <span className="text-gray-600">拣货提成</span>
            <input type="number" min="0" step="0.01" value={拣货提成} onChange={(e) => set拣货提成(e.target.value)} className={输入框类} />
          </label>
          <label className="block text-sm">
            <span className="text-gray-600">扣款合计（含考勤扣款 ¥{(记录.attendance_deduction ?? 0).toFixed(2)}）</span>
            <input type="number" min="0" step="0.01" value={扣款} onChange={(e) => set扣款(e.target.value)} className={输入框类} />
          </label>
          <label className="block text-sm">
            <span className="text-gray-600">应出勤天数</span>
            <input type="number" min="0" step="0.5" value={应出勤} onChange={(e) => set应出勤(e.target.value)} className={输入框类} />
          </label>
          <label className="block text-sm">
            <span className="text-gray-600">实际出勤天数（请假等请手改这里）</span>
            <input type="number" min="0" step="0.5" value={实出勤} onChange={(e) => set实出勤(e.target.value)} className={输入框类} />
          </label>
        </div>

        <label className="block text-sm">
          <span className="text-gray-600">备注</span>
          <input type="text" value={备注} onChange={(e) => set备注(e.target.value)} className={输入框类} />
        </label>

        <div className="bg-blue-50 rounded-lg px-4 py-3 text-sm text-blue-800 flex justify-between">
          <span>提成合计 {formatCurrency(提成合计)}</span>
          <span className="font-bold">实发预览 {formatCurrency(实发预览)}</span>
        </div>

        <div className="flex gap-3 pt-1">
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

export function PayrollClient({ 记录们 }: { 记录们: 工资记录[] }) {
  const router = useRouter();
  const [显示生成弹窗, set显示生成弹窗] = useState(false);
  const [编辑目标, set编辑目标] = useState<工资记录 | null>(null);
  const [操作中id, set操作中id] = useState<string | null>(null);

  async function 执行状态变更(id: string, 动作: "approve" | "pay" | "reopen", 提示语: string) {
    if (!confirm(提示语)) return;
    set操作中id(id);
    try {
      const res = await 变更工资单状态(id, 动作);
      if (res.success) {
        router.refresh();
      } else {
        alert("操作失败：" + (res.error || "未知错误"));
      }
    } catch {
      alert("操作失败：网络异常，请稍后再试");
    } finally {
      set操作中id(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => set显示生成弹窗(true)}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700"
        >
          生成月工资单
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">员工</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">核算周期</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">出勤</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">基本工资</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">提成合计</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">奖金/扣款</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">实发金额</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {记录们.map((r) => {
                const s = 状态样式[r.status] || { label: r.status, className: "bg-gray-50 text-gray-600" };
                const 提成明细 = [
                  (r.commission_diagnosis ?? 0) > 0 && `诊${formatCurrency(r.commission_diagnosis)}`,
                  (r.commission_repair ?? 0) > 0 && `修${formatCurrency(r.commission_repair)}`,
                  (r.commission_sales ?? 0) > 0 && `销${formatCurrency(r.commission_sales)}`,
                  (r.commission_qc ?? 0) > 0 && `检${formatCurrency(r.commission_qc)}`,
                  (r.commission_picking ?? 0) > 0 && `拣${formatCurrency(r.commission_picking)}`,
                ].filter(Boolean).join(" ");
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{r.profiles?.full_name || "-"}</div>
                      <div className="text-xs text-gray-500">{r.profiles?.mechanic_levels?.name || ""}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {r.period_start} ~ {r.period_end}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {r.should_attendance_days != null ? (
                        <>
                          {r.attendance_days ?? 0}/{r.should_attendance_days} 天
                          {(r.late_count ?? 0) > 0 && (
                            <span className="ml-1 text-amber-600 text-xs">迟{r.late_count}</span>
                          )}
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-900">{formatCurrency(r.base_salary)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-blue-600">{formatCurrency(r.commission_total)}</div>
                      {提成明细 && <div className="text-xs text-gray-400">{提成明细}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {(r.bonus ?? 0) > 0 && <span className="text-green-600">+{formatCurrency(r.bonus)}</span>}
                      {(r.deduction ?? 0) > 0 && <span className="text-red-600">-{formatCurrency(r.deduction)}</span>}
                      {(r.bonus ?? 0) === 0 && (r.deduction ?? 0) === 0 && "-"}
                    </td>
                    <td className="px-4 py-3 font-bold text-gray-900">{formatCurrency(r.total_amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${s.className}`}>{s.label}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex gap-2 text-xs">
                        {r.status === "draft" && (
                          <>
                            <button
                              onClick={() => set编辑目标(r)}
                              className="text-blue-600 hover:text-blue-800"
                            >
                              编辑
                            </button>
                            <button
                              onClick={() => 执行状态变更(r.id, "approve", "确定审批通过这份工资单吗？")}
                              disabled={操作中id === r.id}
                              className="text-green-600 hover:text-green-800 disabled:opacity-50"
                            >
                              审批
                            </button>
                          </>
                        )}
                        {r.status === "approved" && (
                          <>
                            <button
                              onClick={() => 执行状态变更(r.id, "pay", "确定已发放这份工资吗？发放后不可再修改。")}
                              disabled={操作中id === r.id}
                              className="text-green-600 hover:text-green-800 disabled:opacity-50"
                            >
                              发放
                            </button>
                            <button
                              onClick={() => 执行状态变更(r.id, "reopen", "确定退回草稿吗？退回后可重新编辑。")}
                              disabled={操作中id === r.id}
                              className="text-gray-500 hover:text-gray-700 disabled:opacity-50"
                            >
                              退回
                            </button>
                          </>
                        )}
                        {r.status === "paid" && <span className="text-gray-300">已完成</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {记录们.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-gray-400">
                    暂无工资记录，点右上角「生成月工资单」开始
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {显示生成弹窗 && <GenerateModal on关闭={() => set显示生成弹窗(false)} />}
      {编辑目标 && <EditModal 记录={编辑目标} on关闭={() => set编辑目标(null)} />}
    </div>
  );
}

"use client";

/**
 * 每日统计页 - 出勤天数单元格
 *  - 普通显示：有效出勤天数（手动调整过的用蓝色标记）
 *  - 管理角色 + 异常行（迟到/早退/缺卡/缺勤）：点击弹出调整窗口，可改 0 / 0.5 / 1 天或恢复自动
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { 修改出勤天数 } from "../actions";

export function DayCountCell({
  profileId,
  workDate,
  自动天数,
  手动天数,
  可编辑,
}: {
  profileId: string;
  workDate: string;
  /** 自动规则算出的天数（null=不计） */
  自动天数: number | null;
  /** 手动调整值（null=未调整） */
  手动天数: number | null;
  /** 当前登录用户是否管理角色 且 该行是异常行 */
  可编辑: boolean;
}) {
  const router = useRouter();
  const [显示弹窗, set显示弹窗] = useState(false);
  /* 数字字段按项目规范用字符串存储，保存时转 number */
  const [输入值, set输入值] = useState("");
  const [说明, set说明] = useState("");
  const [保存中, set保存中] = useState(false);

  const 显示天数 = 手动天数 ?? 自动天数;

  function 打开弹窗() {
    set输入值(String(显示天数 ?? 0));
    set说明("");
    set显示弹窗(true);
  }

  async function 执行保存(天数: number | null) {
    set保存中(true);
    try {
      const res = await 修改出勤天数(profileId, workDate, 天数, 说明);
      if (res.success) {
        set显示弹窗(false);
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

  function 执行提交() {
    const n = Number(输入值);
    if (输入值.trim() === "" || isNaN(n) || n < 0 || n > 1 || (n * 2) % 1 !== 0) {
      alert("出勤天数只能填 0、0.5 或 1");
      return;
    }
    void 执行保存(n);
  }

  return (
    <>
      {可编辑 ? (
        <button
          onClick={打开弹窗}
          title={手动天数 != null ? `手动调整为 ${手动天数} 天（自动规则为 ${自动天数 ?? "不计"} 天），点击修改` : "点击调整出勤天数"}
          className={`px-1 text-black underline decoration-dotted underline-offset-2 hover:bg-gray-100 print:no-underline ${手动天数 != null ? "font-bold" : ""}`}
        >
          {显示天数 ?? ""}
        </button>
      ) : (
        <span className={`text-black ${手动天数 != null ? "font-bold" : ""}`} title={手动天数 != null ? `手动调整（自动规则为 ${自动天数 ?? "不计"} 天）` : undefined}>
          {显示天数 ?? ""}
        </span>
      )}

      {显示弹窗 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 print:hidden">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4 text-left">
            <h3 className="text-lg font-bold text-gray-900">调整出勤天数</h3>
            <p className="text-sm text-gray-500">
              {workDate}，按打卡规则自动计算为 <b>{自动天数 ?? "不计"}</b> 天。
              迟到/早退要按半天算等情况，可以在这里手动改。
            </p>
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="text-gray-600">出勤天数（只能填 0、0.5 或 1）</span>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.5"
                  value={输入值}
                  onChange={(e) => set输入值(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                <span className="text-gray-600">调整说明（可选）</span>
                <input
                  type="text"
                  value={说明}
                  onChange={(e) => set说明(e.target.value)}
                  placeholder="例如：迟到 2 小时按半天算"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </label>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={执行提交}
                disabled={保存中}
                className="flex-1 bg-blue-600 text-white rounded-lg py-2 font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {保存中 ? "保存中..." : "保存"}
              </button>
              <button
                onClick={() => set显示弹窗(false)}
                disabled={保存中}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
            </div>
            {手动天数 != null && (
              <button
                onClick={() => void 执行保存(null)}
                disabled={保存中}
                className="w-full text-sm text-gray-500 hover:text-red-600 underline disabled:opacity-50"
              >
                撤销手动调整，恢复按打卡规则自动计算
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

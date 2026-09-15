"use client";

import type { Dispatch, SetStateAction } from "react";
import type { Profile, MechanicGroup, ExistingMechanic } from "./types";

/* 施工人选择子弹窗（2026-09-16 从 MobileItemEditor 原样拆出，JSX 未改一字）
 * 状态仍由父组件持有（保存/领单/等级预览等逻辑与父组件其他区域耦合），
 * 本组件只做展示与回传，纯 props 边界 */
interface MechanicAssignModalProps {
  onClose: () => void;
  profiles: Profile[];
  mechanicGroups: MechanicGroup[];
  existingMechanics: ExistingMechanic[];
  loading: boolean;
  /* 领单选择 */
  showClaimChoice: boolean;
  setShowClaimChoice: (v: boolean) => void;
  onSoloClaim: () => void;
  onCollaborateClaim: () => void;
  /* 模式与人员选择 */
  mechanicMode: "person" | "group";
  setMechanicMode: (v: "person" | "group") => void;
  mechanicSortAsc: boolean;
  setMechanicSortAsc: Dispatch<SetStateAction<boolean>>;
  selectedPersons: string[];
  togglePerson: (id: string) => void;
  selectedGroup: string;
  setSelectedGroup: (v: string) => void;
  /* 分成 */
  isMulti: boolean;
  personCount: number;
  commissionRule: "equal" | "byLevel" | "manual";
  setCommissionRule: (v: "equal" | "byLevel" | "manual") => void;
  levelPreview: { id: string; name: string; coeff: number; ratio: number }[];
  manualRatios: Record<string, string>;
  setManualRatios: Dispatch<SetStateAction<Record<string, string>>>;
  mechanicIds: string[];
  /* 底部按钮 */
  onClear: () => void;
  onSave: () => void;
}

export function MechanicAssignModal({
  onClose,
  profiles,
  mechanicGroups,
  existingMechanics,
  loading,
  showClaimChoice,
  setShowClaimChoice,
  onSoloClaim,
  onCollaborateClaim,
  mechanicMode,
  setMechanicMode,
  mechanicSortAsc,
  setMechanicSortAsc,
  selectedPersons,
  togglePerson,
  selectedGroup,
  setSelectedGroup,
  isMulti,
  personCount,
  commissionRule,
  setCommissionRule,
  levelPreview,
  manualRatios,
  setManualRatios,
  mechanicIds,
  onClear,
  onSave,
}: MechanicAssignModalProps) {
  return (
    <div className="fixed inset-0 z-[110] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl mx-2 mb-2 max-h-[85vh] flex flex-col animate-slide-up">
        {/* 头部 */}
        <div className="px-4 pt-4 pb-2 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h3 className="text-base font-semibold text-gray-900">指派施工人</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500"
          >
            ✕
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {/* 领单选择 */}
          {showClaimChoice && (
            <div className="space-y-3 py-2">
              <p className="text-xs text-gray-500 text-center">请选择领单方式</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={onSoloClaim}
                  disabled={loading}
                  className="px-3 py-4 text-sm font-medium text-white bg-green-600 rounded-xl disabled:opacity-50"
                >
                  独立完成
                </button>
                <button
                  type="button"
                  onClick={onCollaborateClaim}
                  disabled={loading}
                  className="px-3 py-4 text-sm font-medium text-white bg-blue-600 rounded-xl disabled:opacity-50"
                >
                  与人合作
                </button>
              </div>
              <button
                type="button"
                onClick={() => setShowClaimChoice(false)}
                className="w-full px-3 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg"
              >
                返回
              </button>
            </div>
          )}

          {!showClaimChoice && (
            <>
              {/* 模式切换 */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMechanicMode("person")}
                  className={`flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors ${mechanicMode === "person" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-200"}`}
                >
                  按人派工
                </button>
                <button
                  type="button"
                  onClick={() => setMechanicMode("group")}
                  className={`flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors ${mechanicMode === "group" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-200"}`}
                >
                  按组派工
                </button>
              </div>

              {/* 按人派工 */}
              {mechanicMode === "person" && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-gray-500">共 {profiles.length} 人</span>
                    <button
                      type="button"
                      onClick={() => setMechanicSortAsc((v) => !v)}
                      className="text-xs text-blue-600 flex items-center gap-0.5"
                    >
                      {mechanicSortAsc ? "按姓名升序" : "按姓名降序"}
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={mechanicSortAsc ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
                      </svg>
                    </button>
                  </div>
                  <div className="max-h-[55vh] overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
                    {[...profiles].sort((a, b) => {
                      const cmp = (a.full_name || "").localeCompare(b.full_name || "", "zh-CN");
                      return mechanicSortAsc ? cmp : -cmp;
                    }).map((p) => (
                      <label key={p.id} className="flex items-center gap-2.5 p-2 hover:bg-gray-50 rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedPersons.includes(p.id)}
                          onChange={() => togglePerson(p.id)}
                          className="w-4 h-4 accent-blue-600"
                        />
                        <span className="text-sm">{p.full_name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* 按组派工 */}
              {mechanicMode === "group" && (
                <div className="max-h-[55vh] overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
                  {mechanicGroups.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-4">暂无施工组</p>
                  )}
                  {mechanicGroups.map((g) => (
                    <label key={g.id} className="flex items-center gap-2 p-1.5 hover:bg-gray-50 rounded cursor-pointer">
                      <input
                        type="radio"
                        name="group"
                        checked={selectedGroup === g.id}
                        onChange={() => setSelectedGroup(g.id)}
                      />
                      <div>
                        <span className="text-sm font-medium">{g.name}</span>
                        <span className="text-xs text-gray-400 ml-2">
                          ({g.members.map((m) => m.profiles?.full_name || "-").join(", ")})
                        </span>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {/* 多人分成 */}
              {isMulti && (
                <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                  <p className="text-xs font-medium text-yellow-800 mb-2">提成分配（共 {personCount} 人）</p>
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input type="radio" name="commission" checked={commissionRule === "equal"} onChange={() => setCommissionRule("equal")} />
                      <span>平均分配（每人 {Math.round(100 / personCount * 100) / 100}%）</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input type="radio" name="commission" checked={commissionRule === "byLevel"} onChange={() => setCommissionRule("byLevel")} />
                      <span>按技师等级分配</span>
                    </label>
                    {commissionRule === "byLevel" && levelPreview.length > 0 && (
                      <div className="mt-1 ml-5 space-y-0.5 text-xs text-gray-600">
                        {levelPreview.map((p) => (
                          <div key={p.id} className="flex items-center gap-2">
                            <span className="flex-1">{p.name}</span>
                            <span className="text-gray-400">系数 {p.coeff}</span>
                            <span className="text-blue-700 font-medium">{p.ratio}%</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input type="radio" name="commission" checked={commissionRule === "manual"} onChange={() => setCommissionRule("manual")} />
                      <span>手动输入比例</span>
                    </label>
                  </div>
                  {commissionRule === "manual" && (
                    <div className="mt-2 space-y-1.5">
                      {(mechanicMode === "group" && selectedGroup
                        ? mechanicGroups.find((g) => g.id === selectedGroup)?.members.map((m) => ({ id: m.mechanic_id, name: m.profiles?.full_name || "-" })) || []
                        : profiles.filter((p) => selectedPersons.includes(p.id)).map((p) => ({ id: p.id, name: p.full_name || "-" }))
                      ).map((m) => (
                        <div key={m.id} className="flex items-center gap-2">
                          <span className="text-xs flex-1">{m.name}</span>
                          <input
                            type="number"
                            className="w-16 px-2 py-1 border border-gray-300 rounded text-xs"
                            placeholder="%"
                            value={manualRatios[m.id] || ""}
                            onChange={(e) => setManualRatios((prev) => ({ ...prev, [m.id]: e.target.value }))}
                          />
                          <span className="text-xs text-gray-500">%</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 按钮 */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 text-xs text-gray-600 bg-gray-100 rounded-lg"
                >
                  取消
                </button>
                {existingMechanics.length > 0 && (
                  <button
                    type="button"
                    onClick={onClear}
                    disabled={loading}
                    className="px-3 py-1.5 text-xs text-red-600 bg-red-50 rounded-lg disabled:opacity-50"
                  >
                    清空
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { setShowClaimChoice(true); }}
                  disabled={loading}
                  className="px-3 py-1.5 text-xs text-white bg-green-600 rounded-lg disabled:opacity-50"
                >
                  领单
                </button>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={loading || mechanicIds.length === 0}
                  className="flex-1 px-3 py-1.5 text-xs text-white bg-blue-600 rounded-lg disabled:opacity-50"
                >
                  {loading ? "保存中..." : "确认"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

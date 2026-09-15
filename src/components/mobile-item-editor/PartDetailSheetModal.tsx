"use client";

import type { RefObject } from "react";
import { getPartWorkflowStatus } from "@/lib/partWorkflow";
import { PartWorkflowActions } from "../PartWorkflowActions";
import { 是Capacitor环境 } from "@/lib/capacitorEnv";
import { 退料类型选项 } from "@/lib/returnTypes";
import type { ItemPart, PartImageRecord, 编码命中配件, 申领行, 可退领料行, 退料申请行 } from "./types";

/* 配件详情弹窗（2026-09-16 从 MobileItemEditor 原样拆出，JSX 未改一字）
 * 分支切换/基本信息编辑/状态工作流/申领/退料/图片/客户意见/备注/删除 全在这里；
 * 状态仍由父组件持有（保存、申领退料的查询 effect 等在父组件），纯 props 边界 */
interface PartDetailSheetModalProps {
  selectedPartForDetail: ItemPart;
  setSelectedPartForDetail: (v: ItemPart | null) => void;
  parts合并: ItemPart[];
  detailActiveBranchId: string | null;
  setDetailActiveBranchId: (v: string | null) => void;
  detailEditing: boolean;
  setDetailEditing: (v: boolean) => void;
  isLocked: boolean;
  loading: boolean;
  /* 图片 */
  分支图片: (branchId: string) => PartImageRecord[];
  set预览图片: (v: string | null) => void;
  removePartImage: (branchId: string, storagePath: string, index: number) => void;
  uploadPartImage: (file: File, branchId: string) => void;
  handleAppCamera: (branchId: string) => void;
  detailFileInputRef: RefObject<HTMLInputElement | null>;
  /* 编码智能候选 */
  编码候选: 编码命中配件[];
  设编码候选: (v: 编码命中配件[]) => void;
  设编码查询: (v: string) => void;
  应用命中配件到分支: (branchId: string, hit: 编码命中配件) => Promise<void>;
  /* 字段保存 */
  savePartField: (partId: string, field: string, value: unknown) => Promise<void>;
  savePartQuantity: (partId: string, qty: number) => Promise<void>;
  savePartOpinion: (partId: string, opinion: string) => Promise<void>;
  savePartNotes: (partId: string, notes: string) => Promise<void>;
  /* 分支操作 */
  handleSetDefaultBranch: (branchId: string) => Promise<void>;
  handleAddEmptyBranch: (target: ItemPart) => Promise<void>;
  deletePart: (partId: string, partName: string) => Promise<void>;
  handleDeleteGroup: (target: ItemPart) => Promise<void>;
  setReplacePartTarget: (v: ItemPart | null) => void;
  setAddBranchTarget: (v: ItemPart | null) => void;
  setBranchPickerOpen: (v: boolean) => void;
  setDetailScanOpen: (v: boolean) => void;
  /* 采购/到货标记 */
  切换采购: (part: ItemPart) => Promise<void>;
  切换到货: (part: ItemPart) => Promise<void>;
  /* 申领 */
  申领展开: boolean;
  set申领展开: (fn: (v: boolean) => boolean) => void;
  申领数量: string;
  set申领数量: (v: string) => void;
  申领列表: 申领行[];
  提交申领: () => Promise<void>;
  取消一条申领: (申领id: string) => Promise<void>;
  /* 退料 */
  退料展开: boolean;
  set退料展开: (fn: (v: boolean) => boolean) => void;
  退料数量: string;
  set退料数量: (v: string) => void;
  退料类型: string;
  set退料类型: (v: string) => void;
  选中领料记录id: string;
  set选中领料记录id: (v: string) => void;
  可退领料列表: (可退领料行 & { 可退: number })[];
  退申请列表: 退料申请行[];
  提交退料申请: () => Promise<void>;
  取消一条退申请: (申请id: string) => Promise<void>;
  /* 工作流上下文 */
  returnByPart: Record<string, number>;
  partInventory?: Record<string, number>;
  pendingSupplierReturnByPart?: Record<string, boolean>;
  申领ByPart?: Record<string, number>;
  suppliers: { id: string; name: string; region?: string | null }[];
  logisticsCompanies: { id: string; name: string; scopes?: string[] | null }[];
}

export function PartDetailSheetModal(props: PartDetailSheetModalProps) {
  const {
    selectedPartForDetail, setSelectedPartForDetail, parts合并,
    detailActiveBranchId, setDetailActiveBranchId, detailEditing, setDetailEditing,
    isLocked, loading,
    分支图片, set预览图片, removePartImage, uploadPartImage, handleAppCamera, detailFileInputRef,
    编码候选, 设编码候选, 设编码查询, 应用命中配件到分支,
    savePartField, savePartQuantity, savePartOpinion, savePartNotes,
    handleSetDefaultBranch, handleAddEmptyBranch, deletePart, handleDeleteGroup,
    setReplacePartTarget, setAddBranchTarget, setBranchPickerOpen, setDetailScanOpen,
    切换采购, 切换到货,
    申领展开, set申领展开, 申领数量, set申领数量, 申领列表, 提交申领, 取消一条申领,
    退料展开, set退料展开, 退料数量, set退料数量, 退料类型, set退料类型,
    选中领料记录id, set选中领料记录id, 可退领料列表, 退申请列表, 提交退料申请, 取消一条退申请,
    returnByPart, partInventory, pendingSupplierReturnByPart, 申领ByPart,
    suppliers, logisticsCompanies,
  } = props;

        const branchParts = selectedPartForDetail.branch_group_id
          ? parts合并.filter((p) => p.branch_group_id === selectedPartForDetail.branch_group_id)
          : selectedPartForDetail.part_name_id
          ? parts合并.filter((p) => p.part_name_id === selectedPartForDetail.part_name_id)
          : [selectedPartForDetail];
        const activeBranch = branchParts.find((p) => p.id === detailActiveBranchId) || branchParts[0];
        return (
          <div className="fixed inset-0 z-[110] flex flex-col justify-end">
            <div className="absolute inset-0 bg-black/50" onClick={() => setSelectedPartForDetail(null)} />
            <div className="relative bg-white rounded-t-2xl mx-2 mb-4 max-h-[85dvh] flex flex-col animate-slide-up">
              {/* 头部 */}
              <div className="px-4 pt-4 pb-2 border-b border-gray-100 flex items-center justify-between shrink-0">
                <h3 className="text-base font-bold text-gray-900 truncate">{activeBranch.name}</h3>
                <div className="flex items-center gap-2">
                  {!isLocked && !detailEditing && (
                    <button
                      type="button"
                      onClick={() => setDetailEditing(true)}
                      className="text-xs text-blue-600 px-2 py-1 rounded hover:bg-blue-50"
                    >
                      编辑
                    </button>
                  )}
                  {!isLocked && detailEditing && (
                    <button
                      type="button"
                      onClick={() => setDetailEditing(false)}
                      className="text-xs text-gray-600 px-2 py-1 rounded hover:bg-gray-100"
                    >
                      取消
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { setDetailEditing(false); setSelectedPartForDetail(null); }}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500"
                  >
                    ✕
                  </button>
                </div>
              </div>
              {/* 内容 */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 text-sm">
                {/* 配件分支：选择已有分支 + 添加新分支 */}
                {(branchParts.length > 1 || (!isLocked && activeBranch.branch_group_id)) && (
                  <div>
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <p className="text-xs text-gray-500 shrink-0">
                        {branchParts.length > 1 ? `配件分支（${branchParts.length} 个，左右滑动查看）` : "配件分支"}
                      </p>
                      {!isLocked && activeBranch.branch_group_id && (
                        <div className="flex items-center gap-3 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleAddEmptyBranch(activeBranch)}
                            disabled={loading}
                            className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-800 disabled:opacity-50"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            分支
                          </button>
                          <button
                            type="button"
                            onClick={() => setAddBranchTarget(activeBranch)}
                            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            选择配件
                          </button>
                        </div>
                      )}
                    </div>
                    {branchParts.length > 1 && (
                      <div className="flex gap-2 overflow-x-auto pb-2 snap-x snap-mandatory -mx-1 px-1">
                        {branchParts.map((bp, idx) => (
                        <button
                          key={bp.id}
                          type="button"
                          onClick={() => setDetailActiveBranchId(bp.id)}
                          className={`flex-shrink-0 w-36 p-2.5 rounded-xl border text-left snap-start transition-all duration-200 ${
                            bp.id === activeBranch.id
                              ? "bg-blue-50 border-blue-400 shadow-md ring-2 ring-blue-200 scale-[1.03]"
                              : "bg-white border-gray-200 hover:bg-gray-50 active:scale-95"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <div className={`text-xs font-medium ${bp.id === activeBranch.id ? "text-blue-700" : "text-gray-700"}`}>
                              分支 {idx + 1}
                            </div>
                            {bp.is_selected ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">选中</span>
                            ) : (
                              !isLocked && (
                                <span
                                  role="button"
                                  tabIndex={0}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSetDefaultBranch(bp.id);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.stopPropagation();
                                      handleSetDefaultBranch(bp.id);
                                    }
                                  }}
                                  className="text-[10px] px-1.5 py-0.5 rounded border border-blue-300 text-blue-600 hover:bg-blue-50"
                                >
                                  设为选中
                                </span>
                              )
                            )}
                          </div>
                          <div className="space-y-0.5">
                            {bp.part_number && (
                              <div className="text-[10px] text-gray-500 truncate font-mono">{bp.part_number}</div>
                            )}
                            {bp.brand && (
                              <div className="text-[10px] text-gray-500 truncate">{bp.brand}</div>
                            )}
                            {bp.specification && (
                              <div className="text-[10px] text-gray-500 truncate">{bp.specification}</div>
                            )}
                            <div className="flex items-center justify-between pt-0.5">
                              <span className="text-[10px] text-gray-400">x{bp.quantity}</span>
                              <span className={`text-[10px] font-medium ${bp.id === activeBranch.id ? "text-blue-600" : "text-gray-600"}`}>
                                ¥{bp.total_price || (bp.unit_price * bp.quantity)}
                              </span>
                            </div>
                          </div>
                        </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 基本信息（按当前分支 key，切换分支时重新播放淡入动画） */}
                <div key={activeBranch.id} className="space-y-2 branch-switch-anim">
                  {/* 编码（编辑态：可手输+智能候选、扫码、按名称搜配件，同桌面端分支编辑） */}
                  {detailEditing ? (
                    <div>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-gray-500 text-xs shrink-0">编码</span>
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            key={activeBranch.id + "-pn-" + (activeBranch.part_number || "")}
                            defaultValue={activeBranch.part_number || ""}
                            onChange={(e) => 设编码查询(e.target.value)}
                            onBlur={(e) => {
                              const val = e.target.value.trim() || null;
                              if (val !== (activeBranch.part_number || null)) {
                                savePartField(activeBranch.id, "part_number", val);
                              }
                              设编码查询("");
                              设编码候选([]);
                            }}
                            className="w-28 px-2 py-1 border border-gray-300 rounded text-xs text-right"
                          />
                          <button
                            type="button"
                            onClick={() => setDetailScanOpen(true)}
                            title="扫码录入编码"
                            className="w-7 h-7 flex items-center justify-center rounded border border-gray-300 text-gray-500 hover:bg-gray-50"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7V5a2 2 0 012-2h2m10 0h2a2 2 0 012 2v2m0 10v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2M4 12h16" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => setBranchPickerOpen(true)}
                            title="搜索该名称的配件"
                            className="w-7 h-7 flex items-center justify-center rounded border border-gray-300 text-gray-500 hover:bg-gray-50"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      {/* 编码智能候选：选中即把该配件信息带回本分支。
                         用 onMouseDown + preventDefault（不用 onClick）：点击候选若先触发输入框
                         失焦保存，候选列表会被卸载导致点击丢失，且失焦保存的原始输入会覆盖带回结果 */}
                      {编码候选.length > 0 && (
                        <div className="mt-1 border border-gray-200 rounded-lg max-h-40 overflow-y-auto">
                          {编码候选.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                void 应用命中配件到分支(activeBranch.id, c);
                              }}
                              className="w-full text-left px-2 py-1.5 text-xs hover:bg-blue-50 border-b border-gray-100 last:border-0"
                            >
                              <span className="font-mono text-gray-900">{c.part_number}</span>
                              <span className="ml-2 text-gray-600">{c.name}</span>
                              {c.brand && <span className="ml-1 text-gray-400">{c.brand}</span>}
                              {c.specification && <span className="ml-1 text-gray-400">{c.specification}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex justify-between">
                      <span className="text-gray-500 text-xs">编码</span>
                      <span className="text-gray-900 font-mono text-xs">{activeBranch.part_number || "-"}</span>
                    </div>
                  )}
                  {/* 单据名称（供应商采购单上的名称，可能与配件名称不同） */}
                  {detailEditing ? (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500 text-xs">单据名称</span>
                      <input
                        type="text"
                        key={activeBranch.id + "-docname"}
                        defaultValue={activeBranch.document_name || ""}
                        onBlur={(e) => {
                          const val = e.target.value.trim() || null;
                          if (val !== (activeBranch.document_name || null)) {
                            savePartField(activeBranch.id, "document_name", val);
                          }
                        }}
                        placeholder="采购单名称"
                        className="w-32 px-2 py-1 border border-gray-300 rounded text-xs text-right"
                      />
                    </div>
                  ) : activeBranch.document_name ? (
                    <div className="flex justify-between">
                      <span className="text-gray-500 text-xs">单据名称</span>
                      <span className="text-gray-900 text-xs">{activeBranch.document_name}</span>
                    </div>
                  ) : null}
                  {/* 数量 + 库存（数量无需进入编辑模式，未锁定即可直接改） */}
                  <div className="grid grid-cols-2 gap-3">
                    {!isLocked ? (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">数量</span>
                        <input
                          type="number"
                          min={1}
                          key={activeBranch.id + "-qty"}
                          defaultValue={activeBranch.quantity}
                          onBlur={(e) => {
                            const val = parseInt(e.target.value);
                            if (!isNaN(val) && val !== activeBranch.quantity) {
                              savePartQuantity(activeBranch.id, val);
                            }
                          }}
                          className="w-16 px-2 py-1 border border-gray-300 rounded text-xs text-center"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">数量</span>
                        <span className="text-gray-900 text-xs">x{activeBranch.quantity}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500 text-xs">库存</span>
                      <span className={`font-medium text-xs ${activeBranch.part_id && partInventory && (partInventory[activeBranch.part_id] || 0) > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                        {activeBranch.part_id && partInventory ? (partInventory[activeBranch.part_id] || 0) : "-"}
                      </span>
                    </div>
                  </div>
                  {/* 采购价 + 销售价 */}
                  <div className="grid grid-cols-2 gap-3">
                    {detailEditing ? (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">采购价</span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          key={activeBranch.id + "-cost"}
                          defaultValue={activeBranch.unit_cost ?? ""}
                          onBlur={(e) => {
                            const val = e.target.value === "" ? null : parseFloat(e.target.value);
                            if (val !== activeBranch.unit_cost) {
                              savePartField(activeBranch.id, "unit_cost", val);
                            }
                          }}
                          className="w-16 px-2 py-1 border border-gray-300 rounded text-xs text-right"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">采购价</span>
                        <span className="text-gray-900 text-xs">{activeBranch.unit_cost != null ? `¥${activeBranch.unit_cost}` : "-"}</span>
                      </div>
                    )}
                    {detailEditing ? (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">销售价</span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          key={activeBranch.id + "-price"}
                          defaultValue={activeBranch.unit_price}
                          onBlur={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val) && val !== activeBranch.unit_price) {
                              savePartField(activeBranch.id, "unit_price", val);
                            }
                          }}
                          className="w-16 px-2 py-1 border border-gray-300 rounded text-xs text-right"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">销售价</span>
                        <span className="text-gray-900 text-xs">¥{activeBranch.unit_price}</span>
                      </div>
                    )}
                  </div>
                  {/* 单位 + 分类 */}
                  <div className="grid grid-cols-2 gap-3">
                    {detailEditing ? (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">单位</span>
                        <input
                          type="text"
                          key={activeBranch.id + "-unit"}
                          defaultValue={activeBranch.unit || ""}
                          onBlur={(e) => {
                            const val = e.target.value.trim() || null;
                            if (val !== (activeBranch.unit || null)) {
                              savePartField(activeBranch.id, "unit", val);
                            }
                          }}
                          className="w-16 px-2 py-1 border border-gray-300 rounded text-xs text-right"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">单位</span>
                        <span className="text-gray-900 text-xs">{activeBranch.unit || "-"}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500 text-xs">分类</span>
                      <span className="text-gray-900 text-xs">{activeBranch.category || "-"}</span>
                    </div>
                  </div>
                  {/* 品牌 + 规格 */}
                  <div className="grid grid-cols-2 gap-3">
                    {detailEditing ? (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">品牌</span>
                        <input
                          type="text"
                          key={activeBranch.id + "-brand"}
                          defaultValue={activeBranch.brand || ""}
                          onBlur={(e) => {
                            const val = e.target.value.trim() || null;
                            if (val !== (activeBranch.brand || null)) {
                              savePartField(activeBranch.id, "brand", val);
                            }
                          }}
                          className="w-16 px-2 py-1 border border-gray-300 rounded text-xs text-right"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">品牌</span>
                        <span className="text-gray-900 text-xs">{activeBranch.brand || "-"}</span>
                      </div>
                    )}
                    {detailEditing ? (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">规格</span>
                        <input
                          type="text"
                          key={activeBranch.id + "-spec"}
                          defaultValue={activeBranch.specification || ""}
                          onBlur={(e) => {
                            const val = e.target.value.trim() || null;
                            if (val !== (activeBranch.specification || null)) {
                              savePartField(activeBranch.id, "specification", val);
                            }
                          }}
                          className="w-16 px-2 py-1 border border-gray-300 rounded text-xs text-right"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">规格</span>
                        <span className="text-gray-900 text-xs">{activeBranch.specification || "-"}</span>
                      </div>
                    )}
                  </div>
                  {/* 供应商（无需进入编辑模式，未锁定即可直接选） */}
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500 text-xs">供应商</span>
                    {!isLocked ? (
                      <select
                        key={activeBranch.id + "-supplier"}
                        value={activeBranch.supplier_name || ""}
                        onChange={(e) => {
                          const val = e.target.value || null;
                          if (val !== (activeBranch.supplier_name || null)) {
                            savePartField(activeBranch.id, "supplier_name", val);
                          }
                        }}
                        className="w-32 px-1 py-1 border border-gray-300 rounded text-xs text-right bg-white"
                      >
                        <option value="">未选择</option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.name}>{s.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-gray-900 text-xs">{activeBranch.supplier_name || "-"}</span>
                    )}
                  </div>
                  {/* 小计 */}
                  <div className="border-t border-gray-100 pt-1.5 flex justify-between"
                  >
                    <span className="font-medium text-gray-700 text-xs"
                    >小计</span>
                    <span className="font-bold text-gray-900 text-sm"
                    >¥{activeBranch.total_price || (activeBranch.unit_price * activeBranch.quantity)}</span>
                  </div>
                </div>

                {/* 配件状态 + 领料/退库/退货/采购/到货（状态判定与桌面端同一套 getPartWorkflowStatus，
                   领料/退库/退货直接复用桌面端的 PartWorkflowActions 组件和弹窗） */}
                {(() => {
                  const 退库数 = returnByPart[activeBranch.id] || 0;
                  const 净领 = Math.max(0, (activeBranch.pickedQty || 0) - 退库数);
                  const 库存数 = (activeBranch.part_id && partInventory) ? (partInventory[activeBranch.part_id] || 0) : 0;
                  const 工作流状态 = getPartWorkflowStatus({
                    unit_cost: activeBranch.unit_cost ?? null,
                    unit_price: activeBranch.unit_price ?? null,
                    customer_opinion: activeBranch.customer_opinion || null,
                    is_purchased: !!activeBranch.is_purchased,
                    is_arrived: !!activeBranch.is_arrived,
                    part_id: activeBranch.part_id || null,
                    quantity: activeBranch.quantity,
                    inventoryQty: 库存数,
                    pickedQty: 净领,
                    hasReturnRecords: 退库数 > 0,
                    hasPendingSupplierReturn: !!pendingSupplierReturnByPart[activeBranch.id],
                  });
                  return (
                    <div>
                      <p className="text-xs text-gray-500 mb-2">配件状态</p>
                      <div className="flex items-center flex-wrap gap-2">
                        <PartWorkflowActions
                          status={工作流状态}
                          partName={activeBranch.name}
                          workOrderItemPartId={activeBranch.id}
                          partId={activeBranch.part_id || null}
                          quantity={activeBranch.quantity}
                          pickedQty={净领}
                          returnQty={退库数}
                          suppliers={suppliers}
                          logisticsCompanies={logisticsCompanies}
                          locked={isLocked}
                        />
                        {/* 采购/到货标记（点按切换，守卫同桌面端） */}
                        <button
                          type="button"
                          onClick={() => !isLocked && 切换采购(activeBranch)}
                          disabled={isLocked || loading}
                          className={`text-[10px] px-1.5 py-0.5 rounded border disabled:opacity-50 ${
                            activeBranch.is_purchased
                              ? "bg-green-50 text-green-700 border-green-200 font-medium"
                              : "bg-white text-gray-400 border-gray-200"
                          }`}
                        >
                          {activeBranch.is_purchased ? "已采购" : "未采购"}
                        </button>
                        <button
                          type="button"
                          onClick={() => !isLocked && 切换到货(activeBranch)}
                          disabled={isLocked || loading}
                          className={`text-[10px] px-1.5 py-0.5 rounded border disabled:opacity-50 ${
                            activeBranch.is_arrived
                              ? "bg-green-50 text-green-700 border-green-200 font-medium"
                              : "bg-white text-gray-400 border-gray-200"
                          }`}
                        >
                          {activeBranch.is_arrived ? "已到货" : "未到货"}
                        </button>
                        {/* 申领角标（待出库数量） + 申领入口：师傅手机申领→库管确认实领→自动核销 */}
                        {(申领ByPart[activeBranch.id] || 0) > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">
                            已申领×{申领ByPart[activeBranch.id]}
                          </span>
                        )}
                        {!isLocked && (
                          <button
                            type="button"
                            onClick={() => set申领展开((v) => !v)}
                            className="text-[10px] px-1.5 py-0.5 rounded border bg-white text-amber-700 border-amber-300 hover:bg-amber-50"
                          >
                            申领
                          </button>
                        )}
                        {/* 退料申请入口：已领料（净领>0）才可申请；师傅申请→库管确认→生成退料单 */}
                        {!isLocked && 净领 > 0 && (
                          <button
                            type="button"
                            onClick={() => set退料展开((v) => !v)}
                            className="text-[10px] px-1.5 py-0.5 rounded border bg-white text-red-600 border-red-300 hover:bg-red-50"
                          >
                            退料
                          </button>
                        )}
                        {/* 空分支已到货 → 入库登记（跳转入库页自动带参，同桌面端） */}
                        {activeBranch.is_arrived && !activeBranch.part_id && (
                          <a
                            href={`/inventory/in?auto_fill=1&branch_id=${encodeURIComponent(activeBranch.id)}&part_number=${encodeURIComponent(activeBranch.part_number || "")}&name=${encodeURIComponent(activeBranch.name || "")}&unit=${encodeURIComponent(activeBranch.unit || "")}&brand=${encodeURIComponent(activeBranch.brand || "")}&specification=${encodeURIComponent(activeBranch.specification || "")}&unit_cost=${activeBranch.unit_cost || ""}&supplier=${encodeURIComponent(activeBranch.supplier_name || "")}`}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 hover:bg-orange-100 inline-block"
                          >
                            入库登记
                          </a>
                        )}
                      </div>
                      {/* 申领面板：数量 + 提交；待出库列表可取消 */}
                      {申领展开 && !isLocked && (
                        <div className="mt-2 border border-amber-200 rounded-lg p-2 bg-amber-50/50">
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={1}
                              value={申领数量}
                              onChange={(e) => set申领数量(e.target.value)}
                              aria-label="申领数量"
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-xs text-center"
                            />
                            <button
                              type="button"
                              onClick={提交申领}
                              disabled={loading}
                              className="px-2 py-1 text-xs text-white bg-amber-600 rounded disabled:opacity-50"
                            >
                              {loading ? "提交中..." : "提交申领"}
                            </button>
                            <span className="text-[10px] text-gray-400">申领后由库管确认出库</span>
                          </div>
                          {申领列表.length > 0 && (
                            <div className="mt-2 space-y-1 border-t border-amber-100 pt-1.5">
                              {申领列表.map((r) => (
                                <div key={r.id} className="flex items-center justify-between text-xs">
                                  <span className="text-gray-600">
                                    ×{r.quantity} · {new Date(r.created_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => 取消一条申领(r.id)}
                                    disabled={loading}
                                    className="text-red-500 disabled:opacity-50"
                                  >
                                    取消
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {/* 退料面板：选领料记录 + 数量 + 类型 + 提交；待确认申请可取消 */}
                      {退料展开 && !isLocked && (
                        <div className="mt-2 border border-red-200 rounded-lg p-2 bg-red-50/50">
                          {可退领料列表.length === 0 ? (
                            <p className="text-xs text-gray-400">该配件没有可退的领料记录</p>
                          ) : (
                            <>
                              <div className="space-y-1">
                                {可退领料列表.map((r) => (
                                  <label key={r.id} className="flex items-center gap-2 text-xs text-gray-700">
                                    <input
                                      type="radio"
                                      name="退料领料记录"
                                      checked={选中领料记录id === r.id}
                                      onChange={() => set选中领料记录id(r.id)}
                                      className="accent-red-600"
                                    />
                                    <span>
                                      {r.picking_orders?.picking_no || "领料"} ×{r.quantity}（可退 {r.可退}）
                                    </span>
                                  </label>
                                ))}
                              </div>
                              <div className="flex items-center gap-2 mt-2">
                                <select
                                  value={退料类型}
                                  onChange={(e) => set退料类型(e.target.value)}
                                  aria-label="退料类型"
                                  className="px-1.5 py-1 border border-gray-300 rounded text-xs bg-white"
                                >
                                  {退料类型选项.map((t) => (
                                    <option key={t.key} value={t.key}>
                                      {t.label}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  type="number"
                                  min={1}
                                  value={退料数量}
                                  onChange={(e) => set退料数量(e.target.value)}
                                  aria-label="退料数量"
                                  className="w-16 px-2 py-1 border border-gray-300 rounded text-xs text-center"
                                />
                                <button
                                  type="button"
                                  onClick={提交退料申请}
                                  disabled={loading}
                                  className="px-2 py-1 text-xs text-white bg-red-600 rounded disabled:opacity-50"
                                >
                                  {loading ? "提交中..." : "提交退料申请"}
                                </button>
                              </div>
                              <span className="text-[10px] text-gray-400">申请后由库管确认才会退回库存</span>
                            </>
                          )}
                          {退申请列表.length > 0 && (
                            <div className="mt-2 space-y-1 border-t border-red-100 pt-1.5">
                              {退申请列表.map((r) => (
                                <div key={r.id} className="flex items-center justify-between text-xs">
                                  <span className="text-gray-600">
                                    申请退 ×{r.quantity} · {new Date(r.created_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => 取消一条退申请(r.id)}
                                    disabled={loading}
                                    className="text-red-500 disabled:opacity-50"
                                  >
                                    取消
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* 图片上传 */}
                <div>
                  <p className="text-xs text-gray-500 mb-2">图片</p>
                  {/* 已上传图片（本地覆盖合并：上传/删除后立即显示；点开看大图；删除按钮手机上常显） */}
                  {分支图片(activeBranch.id).length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {分支图片(activeBranch.id).map((img, idx) => (
                        <div key={idx} className="relative w-16 h-16 rounded border border-gray-200 overflow-hidden">
                          <img
                            src={img.storage_path}
                            alt=""
                            className="w-full h-full object-cover cursor-pointer"
                            loading="lazy"
                            onClick={() => set预览图片(img.storage_path || null)}
                          />
                          {!isLocked && (
                            <button
                              type="button"
                              onClick={() => removePartImage(activeBranch.id, img.storage_path || "", idx)}
                              disabled={loading}
                              className="absolute top-0 right-0 w-4 h-4 bg-red-500 text-white rounded-full text-[8px] flex items-center justify-center disabled:opacity-50"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* 上传按钮（无需进入编辑模式，未锁定即可直接上传） */}
                  {!isLocked && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          if (是Capacitor环境()) {
                            void handleAppCamera(activeBranch.id);
                          } else {
                            detailFileInputRef.current?.click();
                          }
                        }}
                        disabled={loading}
                        className={`inline-flex items-center justify-center w-16 h-16 rounded border border-dashed border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors disabled:opacity-50 disabled:pointer-events-none`}
                      >
                        {loading ? (
                          <span className="text-[10px]">...</span>
                        ) : (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                        )}
                      </button>
                      <input
                        ref={detailFileInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          const files = e.target.files;
                          if (!files) return;
                          Array.from(files).forEach((f) => uploadPartImage(f, activeBranch.id));
                          e.target.value = "";
                        }}
                      />
                    </>
                  )}
                </div>

                {/* 客户意见（可编辑） */}
                {detailEditing && (
                  <div>
                    <p className="text-xs text-gray-500 mb-2">客户意见</p>
                    <div className="flex gap-2">
                      {(["agree", "pending", "reject"] as const).map((op) => (
                        <button
                          key={op}
                          type="button"
                          onClick={() => savePartOpinion(activeBranch.id, op)}
                          disabled={loading}
                          className={`flex-1 py-2 text-xs rounded-lg border font-medium disabled:opacity-50 ${
                            (activeBranch.customer_opinion || "pending") === op
                              ? op === "agree" ? "bg-green-600 text-white border-green-600" :
                                op === "reject" ? "bg-red-600 text-white border-red-600" :
                                "bg-gray-600 text-white border-gray-600"
                              : "bg-white text-gray-600 border-gray-200"
                          }`}
                        >
                          {op === "agree" ? "同意" : op === "reject" ? "拒绝" : "待确认"}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {isLocked && activeBranch.customer_opinion && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">客户意见</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      activeBranch.customer_opinion === 'agree' ? 'bg-green-50 text-green-600' :
                      activeBranch.customer_opinion === 'reject' ? 'bg-red-50 text-red-600' :
                      'bg-gray-100 text-gray-500'
                    }`}>
                      {activeBranch.customer_opinion === 'agree' ? '同意' : activeBranch.customer_opinion === 'reject' ? '拒绝' : '待确认'}
                    </span>
                  </div>
                )}

                {/* 备注（可编辑） */}
                <div>
                  <p className="text-xs text-gray-500 mb-2">备注</p>
                  {!isLocked ? (
                    <textarea
                      key={activeBranch.id + "-notes"}
                      defaultValue={activeBranch.notes || ""}
                      onBlur={(e) => {
                        const val = e.target.value;
                        if (val !== (activeBranch.notes || "")) {
                          savePartNotes(activeBranch.id, val);
                        }
                      }}
                      rows={2}
                      placeholder="添加备注..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  ) : (
                    <p className="text-sm text-gray-700">{activeBranch.notes || "无备注"}</p>
                  )}
                </div>

                {/* 操作按钮 */}
                {detailEditing && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setReplacePartTarget(activeBranch);
                        setSelectedPartForDetail(null);
                      }}
                      disabled={loading}
                      className="flex-1 min-w-[5rem] px-3 py-2 text-xs text-blue-600 border border-blue-300 rounded-lg hover:bg-blue-50 disabled:opacity-50"
                    >
                      替换配件
                    </button>
                    <button
                      type="button"
                      onClick={() => deletePart(activeBranch.id, activeBranch.name)}
                      disabled={loading}
                      className="flex-1 min-w-[5rem] px-3 py-2 text-xs text-red-600 border border-red-300 rounded-lg hover:bg-red-50 disabled:opacity-50"
                    >
                      {branchParts.length > 1 ? "删本分支" : "删除"}
                    </button>
                    {branchParts.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleDeleteGroup(activeBranch)}
                        disabled={loading}
                        className="flex-1 min-w-[5rem] px-3 py-2 text-xs text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
                      >
                        删整个配件
                      </button>
                    )}
                  </div>
                )}
              </div>
              {/* 底部关闭按钮 */}
              <div className="shrink-0 px-4 py-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setSelectedPartForDetail(null)}
                  className="w-full px-4 py-2.5 text-sm text-white bg-blue-600 rounded-lg"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        );
}

"use client";

import type { Dispatch, SetStateAction } from "react";
import Link from "next/link";
import { PartSearchDropdown } from "./PartSearchDropdown";
import { DocumentNameInput } from "./DocumentNameInput";
import { PriceValue } from "./PriceVisibilityContext";
import { ACTION_LABELS } from "@/lib/purchaseFlowLabels";
import type { PurchaseOrder, PurchaseOrderItem } from "@/types/domain";
import type { 行内配件 } from "./usePartLinking";

/* 待收货单张订单卡片（2026-09-16 从 PendingReceiptList 原样拆出，JSX 未改一字）：
   单头（单号/状态/运单/整单操作）+ 明细行表格（编码/单据名称/图片/行级操作）。
   4 个工具函数随卡片搬来并 export（主文件回引，口径仍只有一份） */
/* 该单是否需要运单（外阜供应商才需要；local 或空地区都不强制） */
export function orderNeedsWaybill(order: PurchaseOrder): boolean {
  const region = order.suppliers?.region;
  if (!region) return false;
  return region !== "local";
}

/* 行级可收货口径（2026-08-21）：本地供应商直接可收；外阜单需 单头已关联运单/已豁免，
   或该配件行自己已关联运单/已豁免（配件级处理：一单多件只到了其中一件的运单场景） */
export function 行可收货(order: PurchaseOrder, item: PurchaseOrderItem): boolean {
  if (!orderNeedsWaybill(order)) return true;
  return !!(order.waybill_id || order.waybill_exempt || item.waybill_id || item.waybill_exempt);
}

export function getReceiptStatus(order: PurchaseOrder): { label: string; color: string } {
  const items = order.purchase_order_items;
  if (items.length === 0) return { label: "未到货", color: "bg-gray-100 text-gray-600" };
  const allHandled = items.every((it) => !!it.handle_action);
  if (allHandled) return { label: "全部已处理", color: "bg-green-100 text-green-700" };
  const anyHandled = items.some((it) => !!it.handle_action);
  if (anyHandled) return { label: "部分已处理", color: "bg-orange-100 text-orange-700" };
  return { label: "未收货", color: "bg-gray-100 text-gray-600" };
}

function resolveImageUrl(path: string): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return path;
  return `${base}/storage/v1/object/public/work-order-media/${path}`;
}

interface ReceiptOrderCardProps {
  order: PurchaseOrder;
  submitting: string | null;
  /* 批量运单勾选（Set 与切换逻辑原样留在卡片内联，与拆分前一致） */
  selectedOrderIds: Set<string>;
  setSelectedOrderIds: Dispatch<SetStateAction<Set<string>>>;
  可管理运单: boolean;
  openWaybillModal: (orderId: string) => void;
  handleCancelOrder: (orderId: string, mode: "revoke" | "void") => void;
  handleRevokeItem: (order: PurchaseOrder, item: PurchaseOrderItem) => void;
  handleUnstage: (orderId: string, item: PurchaseOrderItem) => void;
  openReceiveModal: (order: PurchaseOrder, item: PurchaseOrderItem) => void;
  openGateModal: (order: PurchaseOrder, item: PurchaseOrderItem) => void;
  handleRevokeItemToPending: (order: PurchaseOrder, item: PurchaseOrderItem) => void;
  handleDiscardItem: (order: PurchaseOrder, item: PurchaseOrderItem) => void;
  openEditModal: (item: PurchaseOrderItem) => void;
  openCreateNewModal: (item: PurchaseOrderItem, query: string) => void;
  handleInlinePartSelect: (item: PurchaseOrderItem, part: 行内配件) => void;
  handleInlineClear: (item: PurchaseOrderItem) => void;
  patch明细: (orderId: string, itemId: string, patch: Partial<PurchaseOrderItem>) => void;
}

export function ReceiptOrderCard({
  order,
  submitting,
  selectedOrderIds,
  setSelectedOrderIds,
  可管理运单,
  openWaybillModal,
  handleCancelOrder,
  handleRevokeItem,
  handleUnstage,
  openReceiveModal,
  openGateModal,
  handleRevokeItemToPending,
  handleDiscardItem,
  openEditModal,
  openCreateNewModal,
  handleInlinePartSelect,
  handleInlineClear,
  patch明细,
}: ReceiptOrderCardProps) {
  const receiptStatus = getReceiptStatus(order);
  const needsWaybill = orderNeedsWaybill(order);
  const wb = order.logistics_waybills;
  return (
                <div className="px-6 py-4">
                  <div className="flex items-center gap-3 mb-3 flex-wrap">
                    {needsWaybill && (
                      <input
                        type="checkbox"
                        checked={selectedOrderIds.has(order.id)}
                        onChange={() => {
                          setSelectedOrderIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(order.id)) next.delete(order.id);
                            else next.add(order.id);
                            return next;
                          });
                        }}
                        className="rounded"
                      />
                    )}
                    <Link
                      href={`/procurement/${order.id}`}
                      className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                    >
                      {order.order_no || order.id.slice(0, 8)}
                    </Link>
                    <span className="text-xs text-gray-500">
                      {new Date(order.created_at).toLocaleDateString()}
                    </span>
                    <span className="text-xs text-gray-500">
                      {order.purchase_order_items.length} 项 · <PriceValue value={order.total_amount} />
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${receiptStatus.color}`}>
                      {receiptStatus.label}
                    </span>

                    {wb ? (
                      <>
                        <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-xs">
                          运单 {wb.tracking_no}
                        </span>
                        <span className="text-xs text-gray-500">
                          {wb.logistics_companies?.name || wb.logistics_company_name || "-"}
                        </span>
                        {可管理运单 && (
                          <button
                            type="button"
                            onClick={() => openWaybillModal(order.id)}
                            className="text-blue-600 hover:underline text-xs"
                          >
                            更换
                          </button>
                        )}
                      </>
                    ) : needsWaybill ? (
                      <>
                        <span className="px-2 py-0.5 rounded bg-yellow-50 text-yellow-700 text-xs">
                          未关联运单
                        </span>
                        {order.logistics_companies?.name && (
                          <span className="text-xs text-gray-500">
                            物流: {order.logistics_companies.name}
                          </span>
                        )}
                        {可管理运单 && (
                          <button
                            type="button"
                            onClick={() => openWaybillModal(order.id)}
                            className="px-2 py-0.5 text-xs rounded border border-gray-200 text-gray-600 bg-white hover:bg-gray-50"
                          >
                            选择已有运单
                          </button>
                        )}
                      </>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-gray-50 text-gray-500 text-xs">
                        本地供货 · 无需运单
                      </span>
                    )}

                    {/* 整单撤销/作废（2026-08-17）：仅未收货(submitted)的单可操作；
                        撤销=配件回待采购，作废=配件不回，单据都留档(cancelled)。
                        命名避开行级"撤销"收货按钮和待采购页批量"撤销"配件 */}
                    {order.status === "submitted" && (
                      <>
                        <button
                          type="button"
                          disabled={submitting === `cancel-${order.id}`}
                          onClick={() => handleCancelOrder(order.id, "revoke")}
                          className="text-xs text-amber-600 hover:text-amber-700 hover:underline disabled:opacity-50"
                        >
                          撤销整单
                        </button>
                        <button
                          type="button"
                          disabled={submitting === `cancel-${order.id}`}
                          onClick={() => handleCancelOrder(order.id, "void")}
                          className="text-xs text-red-400 hover:text-red-600 hover:underline disabled:opacity-50"
                        >
                          作废整单
                        </button>
                      </>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border border-gray-100 rounded-lg">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-2 py-2 text-left font-medium text-gray-500 w-10 whitespace-nowrap">序号</th>
                          <th className="px-2 py-2 text-left font-medium text-gray-500 w-24 whitespace-nowrap">零件编码</th>
                          <th className="px-2 py-2 text-left font-medium text-gray-500 min-w-[140px] whitespace-nowrap">商品名称</th>
                          <th className="px-2 py-2 text-left font-medium text-gray-500 w-24 whitespace-nowrap">单据名称</th>
                          <th className="px-2 py-2 text-right font-medium text-gray-500 w-14 whitespace-nowrap">订购数</th>
                          <th className="px-2 py-2 text-left font-medium text-gray-500 w-10 whitespace-nowrap">单位</th>
                          <th className="px-2 py-2 text-left font-medium text-gray-500 w-16 whitespace-nowrap">分类</th>
                          <th className="px-2 py-2 text-left font-medium text-gray-500 w-28 whitespace-nowrap">备注</th>
                          <th className="px-2 py-2 text-left font-medium text-gray-500 w-14 whitespace-nowrap">图片</th>
                          <th className="px-2 py-2 text-left font-medium text-gray-500 w-24 whitespace-nowrap">车牌</th>
                          <th className="px-2 py-2 text-center font-medium text-gray-500 w-24 whitespace-nowrap">处理结果</th>
                          {/* 操作列锁定最右（2026-09-07）：横向滚动时固定可见 */}
                          <th className="px-2 py-2 text-center font-medium text-gray-500 w-24 whitespace-nowrap sticky right-0 bg-gray-50 z-10 border-l border-gray-200">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {/* 分栏口径（2026-09-06）：待收区只显示「未收且未暂存」的行，
                            暂存的行自动移到右侧已暂存区，收一件走一件一目了然 */}
                        {order.purchase_order_items.filter((it) => !it.handle_action && !it.staged_at).map((item, idx) => {
                          const actionInfo = item.handle_action ? ACTION_LABELS[item.handle_action] : null;
                          return (
                            /* group 类供操作列 hover 时同步行背景色 */
                            <tr key={item.id} className="hover:bg-gray-50 group">
                              <td className="px-2 py-2 text-gray-500">{idx + 1}</td>
                              <td className="px-2 py-2">
                                <PartSearchDropdown
                                  value={item.part_number || ""}
                                  onChange={() => {}}
                                  onSelect={(part) => handleInlinePartSelect(item, part)}
                                  onCreateNew={(query) => openCreateNewModal(item, query)}
                                  onClear={() => handleInlineClear(item)}
                                  disabled={submitting === `inline-${item.id}`}
                                  placeholder="编码"
                                  inputClassName="w-20 border-gray-200 text-xs"
                                />
                              </td>
                              <td className="px-2 py-2 whitespace-nowrap">
                                <div className="text-gray-900 font-medium truncate" title={item.name}>{item.name}</div>
                                {item.brand || item.specification ? (
                                  <div className="text-xs text-gray-400 truncate">
                                    {item.brand || ""} {item.specification || ""}
                                  </div>
                                ) : null}
                              </td>
                              <td className="px-2 py-2 whitespace-nowrap">
                                <DocumentNameInput
                                  采购明细id={item.id}
                                  初始值={item.supplier_part_name || ""}
                                  保存后={(新值) =>
                                    /* 局部更新：单据名称前端已知，直接 patch 该明细 */
                                    patch明细(order.id, item.id, { supplier_part_name: 新值 || null })
                                  }
                                  样式类名="w-24 px-2 py-1 text-xs rounded border border-gray-200 bg-white placeholder:text-gray-400 hover:border-blue-400 focus:border-blue-500 focus:outline-none disabled:opacity-50"
                                />
                              </td>
                              <td className="px-2 py-2 text-right text-gray-700">{item.quantity}</td>
                              <td className="px-2 py-2 text-gray-700">{item.unit || "-"}</td>
                              <td className="px-2 py-2 text-gray-700 truncate max-w-[64px]" title={item.category || ""}>{item.category || "-"}</td>
                              <td
                                className="px-2 py-2 text-gray-700 truncate max-w-[112px]"
                                title={item.notes || ""}
                              >
                                {item.notes || "-"}
                              </td>
                              <td className="px-2 py-2">
                                {item.photos && item.photos.length > 0 ? (
                                  <div className="flex gap-1">
                                    {item.photos.slice(0, 2).map((p, i) => (
                                      <img
                                        key={i}
                                        src={resolveImageUrl(p)}
                                        alt=""
                                        loading="lazy"
                                        className="w-7 h-7 object-cover rounded border border-gray-100"
                                        onError={(e) => {
                                          (e.target as HTMLImageElement).style.display = "none";
                                        }}
                                      />
                                    ))}
                                    {item.photos.length > 2 && (
                                      <span className="text-xs text-gray-400 self-center">
                                        +{item.photos.length - 2}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-gray-300">-</span>
                                )}
                              </td>
                              <td className="px-2 py-2 text-gray-700 truncate max-w-[96px]" title={item.license_plate || ""}>{item.license_plate || "-"}</td>
                              <td className="px-2 py-2 text-center">
                                {actionInfo ? (
                                  <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${actionInfo.color}`}>
                                    {actionInfo.text}
                                  </span>
                                ) : item.staged_at ? (
                                  /* 已暂存（2026-09-04）：确认收货未提交入账的状态，黄色标记 */
                                  <span className="text-xs px-2 py-0.5 rounded whitespace-nowrap bg-yellow-100 text-yellow-700">
                                    已暂存{item.staged_action && ACTION_LABELS[item.staged_action] ? "·" + ACTION_LABELS[item.staged_action].text : ""}
                                  </span>
                                ) : (
                                  <span className="text-xs text-gray-400">待处理</span>
                                )}
                              </td>
                              {/* 操作列锁定最右（2026-09-07）：sticky+背景色遮挡滚动内容，hover 时同步行背景 */}
                              <td className="px-2 py-2 text-center sticky right-0 bg-white group-hover:bg-gray-50 border-l border-gray-200">
                                <div className="flex items-center gap-1">
                                  {actionInfo ? (
                                    <button
                                      type="button"
                                      onClick={() => handleRevokeItem(order, item)}
                                      disabled={submitting === `revoke-${item.id}`}
                                      className="px-2 py-1 text-xs rounded border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-50 whitespace-nowrap"
                                    >
                                      {submitting === `revoke-${item.id}` ? "撤销中..." : "撤销"}
                                    </button>
                                  ) : item.staged_at ? (
                                    /* 已暂存（2026-09-04）：可撤销重收 */
                                    <button
                                      type="button"
                                      onClick={() => handleUnstage(order.id, item)}
                                      disabled={submitting === `unstage-${item.id}`}
                                      title="撤销这次暂存的收货，重新收货"
                                      className="px-2 py-1 text-xs rounded border border-yellow-300 text-yellow-700 bg-yellow-50 hover:bg-yellow-100 disabled:opacity-50 whitespace-nowrap"
                                    >
                                      {submitting === `unstage-${item.id}` ? "撤销中..." : "撤销暂存"}
                                    </button>
                                  ) : (
                                    <>
                                      {/* 行级运单门禁（2026-08-21）：未关联也未豁免时按钮半透明但可点，
                                          点击弹出"运单处理"窗（关联运单/不关联运单豁免） */}
                                      {(() => {
                                        const 可收 = 行可收货(order, item);
                                        return (
                                          <button
                                            type="button"
                                            onClick={() => (可收 ? openReceiveModal(order, item) : openGateModal(order, item))}
                                            disabled={submitting === `item-${item.id}`}
                                            title={可收 ? undefined : "外阜供货商需先处理运单（点击关联或豁免）"}
                                            className={`px-3 py-1 text-xs rounded whitespace-nowrap disabled:opacity-50 ${
                                              可收
                                                ? "bg-blue-600 text-white hover:bg-blue-700"
                                                : "bg-blue-600/40 text-white hover:bg-blue-600/60"
                                            }`}
                                          >
                                            收货
                                          </button>
                                        );
                                      })()}
                                      {/* 配件级撤销/作废（2026-08-20 需求5）：撤销=退回待采购可重新组单；作废=彻底删除 */}
                                      <button
                                        type="button"
                                        onClick={() => handleRevokeItemToPending(order, item)}
                                        disabled={submitting === `item-${item.id}`}
                                        title="退回待采购列表，下次可重新组单采购"
                                        className="text-xs text-amber-600 hover:text-amber-700 hover:underline disabled:opacity-50 whitespace-nowrap"
                                      >
                                        撤销
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDiscardItem(order, item)}
                                        disabled={submitting === `item-${item.id}`}
                                        title="彻底删除该配件（采购记录和工单记录都会清除）"
                                        className="text-xs text-red-400 hover:text-red-600 hover:underline disabled:opacity-50 whitespace-nowrap"
                                      >
                                        作废
                                      </button>
                                    </>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => openEditModal(item)}
                                    disabled={submitting === `edit-${item.id}`}
                                    className="text-xs text-gray-500 hover:text-blue-600 whitespace-nowrap"
                                  >
                                    编辑
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
  );
}

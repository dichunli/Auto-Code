"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";
import WorkOrderActionButtons from "@/components/WorkOrderActionButtons";
import { logAction } from "@/lib/operationLog";
import type { Order } from "./page";

/* ═════════════════════════════════════════════════════════════════
 * 工单列表内容 — Client Component（纯展示 + 交互）
 *
 * 数据由父组件（page.tsx Server Component）通过 props 传入。
 * 本组件只负责渲染表格和处理交互（删除、打开详情等）。
 * ═════════════════════════════════════════════════════════════════ */

const STAGE_LABELS: Record<string, string> = {
  pending_diagnosis: "待诊断",
  pending_dispatch: "待派工",
  pending_construction: "待施工",
  in_progress: "施工中",
  paused: "已中断",
  completed: "已完工",
  pending_qc: "已质检",
  settled: "已结单",
};

const STAGE_COLORS: Record<string, string> = {
  pending_diagnosis: "bg-gray-100 text-gray-700",
  pending_dispatch: "bg-slate-100 text-slate-700",
  pending_construction: "bg-orange-100 text-orange-700",
  in_progress: "bg-blue-100 text-blue-700",
  paused: "bg-yellow-100 text-yellow-700",
  completed: "bg-green-100 text-green-700",
  pending_qc: "bg-purple-100 text-purple-700",
  settled: "bg-emerald-100 text-emerald-700",
};

interface WorkOrdersContentProps {
  orders: Order[];
  total: number;
  page: number;
  totalPages: number;
  status: string;
  type: string;
  queryError: string | null;
  baseParams: Record<string, string>;
}

export default function WorkOrdersContent({
  orders,
  total,
  page,
  totalPages,
  status,
  type,
  queryError,
  baseParams,
}: WorkOrdersContentProps) {
  const router = useRouter();
  const supabase = createClient();

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; orderNo: string } | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  function openOrderTab(orderId: string) {
    const tabsParam = baseParams.tabs || "";
    const tabs = tabsParam.split(",").filter(Boolean);
    const newTabs = tabs.includes(orderId) ? tabs : [...tabs, orderId];
    router.push(`/work-orders/${orderId}?tabs=${newTabs.join(",")}`);
  }

  function handleDelete(orderId: string, orderNo: string) {
    setDeleteTarget({ id: orderId, orderNo });
    setDeleteReason("");
    setDeleteModalOpen(true);
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    if (!deleteReason.trim()) {
      alert("请填写删除原因");
      return;
    }
    setDeleteLoading(true);
    const { error } = await supabase.from("work_orders").delete().eq("id", deleteTarget.id);
    if (error) {
      setDeleteLoading(false);
      alert("删除失败: " + error.message);
      return;
    }

    await logAction({
      actionType: "work_order_delete",
      targetTable: "work_orders",
      targetId: deleteTarget.id,
      targetName: deleteTarget.orderNo,
      description: `删除工单 ${deleteTarget.orderNo}，原因: ${deleteReason.trim()}`,
    });

    setDeleteLoading(false);
    setDeleteModalOpen(false);
    setDeleteTarget(null);
    setDeleteReason("");

    /* 刷新页面以更新列表 */
    window.location.reload();
  }

  function buildLink(updates: Record<string, string>): string {
    const sp = new URLSearchParams();
    Object.entries(baseParams).forEach(([k, v]) => {
      if (v) sp.set(k, v);
    });
    Object.entries(updates).forEach(([k, v]) => {
      if (v) sp.set(k, v);
      else sp.delete(k);
    });
    const qs = sp.toString();
    return qs ? `/work-orders?${qs}` : "/work-orders";
  }

  return (
    <div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">工单号</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">车牌号</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">VIN</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">车型</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">客户名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">电话</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">单位</th>
                {!type && <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>}
                <th className="px-6 py-3 text-left font-medium text-gray-500">金额</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">创建时间</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orders.map((order: Order) => (
                <tr key={order.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">
                    <button
                      type="button"
                      onClick={() => openOrderTab(order.id)}
                      className="text-blue-600 hover:text-blue-700 hover:underline text-left"
                    >
                      {order.order_no}
                    </button>
                  </td>
                  <td className="px-6 py-4 text-gray-900">{order.vehicles?.plate_number || "-"}</td>
                  <td className="px-6 py-4 text-gray-600 font-mono whitespace-nowrap">{order.vehicles?.vin || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{order.vehicles?.brand} {order.vehicles?.model}</td>
                  <td className="px-6 py-4 text-gray-900">{order.customers?.name || "-"}</td>
                  <td className="px-6 py-4 text-gray-500">{order.customers?.phone || "-"}</td>
                  <td className="px-6 py-4 text-gray-500">{order.customers?.company || "-"}</td>
                  {!type && (
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          STAGE_COLORS[order.boardStage] || "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {STAGE_LABELS[order.boardStage] || order.boardStage}
                      </span>
                    </td>
                  )}
                  <td className="px-6 py-4 text-gray-900">{formatCurrency(order.total_cost)}</td>
                  <td className="px-6 py-4 text-gray-500">{formatDate(order.created_at)}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => openOrderTab(order.id)}
                        className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                      >
                        查看详情
                      </button>
                      <WorkOrderActionButtons
                        workOrderId={order.id}
                        orderNo={order.order_no}
                        currentType={order.order_type}
                        onSuccess={() => window.location.reload()}
                      />
                      {type === "cancelled" && (
                        <button
                          type="button"
                          onClick={() => handleDelete(order.id, order.order_no)}
                          className="text-sm text-red-600 hover:text-red-700 font-medium"
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {queryError && (
                <tr>
                  <td colSpan={type ? 10 : 11} className="px-6 py-12 text-center text-red-500">
                    查询失败: {queryError}
                  </td>
                </tr>
              )}
              {!queryError && orders.length === 0 && (
                <tr>
                  <td colSpan={type ? 10 : 11} className="px-6 py-12 text-center text-gray-400">
                    {type ? `暂无数据` : "暂无工单数据"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 分页 —— 条数始终显示，翻页按钮仅在多于一页时显示 */}
      {total > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-gray-500">
            共 {total} 条，第 {page}/{totalPages} 页
          </div>
          {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <Link
              href={buildLink({ page: String(Math.max(1, page - 1)) })}
              className={`px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 ${
                page <= 1 ? "pointer-events-none opacity-50" : ""
              }`}
            >
              上一页
            </Link>
            <span className="text-sm text-gray-600 px-2">
              {page} / {totalPages}
            </span>
            <Link
              href={buildLink({ page: String(Math.min(totalPages, page + 1)) })}
              className={`px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 ${
                page >= totalPages ? "pointer-events-none opacity-50" : ""
              }`}
            >
              下一页
            </Link>
            <form
              method="GET"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const input = form.querySelector('input[name="page"]') as HTMLInputElement;
                const p = parseInt(input.value, 10);
                if (p >= 1 && p <= totalPages) {
                  router.push(buildLink({ page: String(p) }));
                }
              }}
              className="flex items-center gap-2 ml-4"
            >
              {Object.entries(baseParams).map(([k, v]) =>
                v && k !== "page" ? <input key={k} type="hidden" name={k} value={v} /> : null
              )}
              <span className="text-sm text-gray-500">跳转到</span>
              <input
                name="page"
                type="number"
                min={1}
                max={totalPages}
                defaultValue={page}
                className="w-16 px-2 py-1 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-center"
              />
              <button
                type="submit"
                className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                确定
              </button>
            </form>
          </div>
          )}
        </div>
      )}

      {/* 删除原因弹窗 */}
      {deleteModalOpen && deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-sm mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">删除工单</h3>
            <p className="text-sm text-gray-500 mb-4">工单号：{deleteTarget.orderNo}</p>
            <textarea
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="请输入删除原因..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => {
                  setDeleteModalOpen(false);
                  setDeleteTarget(null);
                  setDeleteReason("");
                }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                disabled={deleteLoading}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleteLoading ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

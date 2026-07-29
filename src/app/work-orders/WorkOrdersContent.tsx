"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";
import WorkOrderActionButtons from "@/components/WorkOrderActionButtons";
import { logAction } from "@/lib/operationLog";
import { 阶段文案, 阶段颜色, type 阶段key } from "@/lib/orderStage";
import { 读本地工单标签 } from "@/lib/orderTabs";
import StageOrderCard from "@/components/StageOrderCard";
import type { Order } from "./page";

/* ═════════════════════════════════════════════════════════════════
 * 工单列表内容 — Client Component（纯展示 + 交互）
 *
 * 数据由父组件（page.tsx Server Component）通过 props 传入。
 * 本组件只负责渲染表格和处理交互（删除、打开详情等）。
 * 状态徽章文案/颜色统一来自 src/lib/orderStage.ts（全站唯一口径）。
 * 阶段分栏视图用 StageOrderCard（卡片可直接操作：领单/派工/计时/质检指派）。
 * ═════════════════════════════════════════════════════════════════ */

interface Profile {
  id: string;
  full_name: string;
  group_id?: string | null;
  profile_roles?: { roles?: { name?: string } | null }[] | null;
  mechanic_levels?: { sort_order?: number }[] | null;
}

interface MechanicGroup {
  id: string;
  name: string;
  members: { mechanic_id: string; profiles?: { full_name: string } | null }[];
}

interface WorkOrdersContentProps {
  orders: Order[];
  total: number;
  page: number;
  totalPages: number;
  status: string;
  type: string;
  queryError: string | null;
  baseParams: Record<string, string>;
  /* 分栏卡片操作需要的人员数据（派工/质检指派） */
  profiles?: Profile[];
  mechanicGroups?: MechanicGroup[];
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
  profiles = [],
  mechanicGroups = [],
}: WorkOrdersContentProps) {
  const router = useRouter();
  const supabase = createClient();

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; orderNo: string } | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  function openOrderTab(orderId: string) {
    /* 追加到"当前生效的标签集合"：URL 有 tabs 用 URL 的；
     * URL 没有（从菜单进的列表页）用本地存储的——否则打开新工单会把旧标签挤没 */
    const urlTabs = (baseParams.tabs || "").split(",").filter(Boolean);
    const tabs = urlTabs.length > 0 ? urlTabs : 读本地工单标签();
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

  /* 分栏卡片视图：点击具体阶段标签（待派工/施工中等）时，
   * 按车辆分栏显示可操作工单卡片（StageOrderCard） */
  const 是分栏视图 = !!status && !["", "active", "history", "all"].includes(status) && !type;
  const 当前阶段 = status as 阶段key;

  if (是分栏视图) {
    return (
      <div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {orders.map((order) => (
            <StageOrderCard
              key={order.id}
              order={order}
              当前阶段={当前阶段}
              profiles={profiles}
              mechanicGroups={mechanicGroups}
              on打开工单={openOrderTab}
            />
          ))}
        </div>
        {orders.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 px-6 py-12 text-center text-gray-400">
            暂无「{阶段文案[当前阶段] || status}」状态的工单
          </div>
        )}
        {orders.length > 0 && (
          <div className="mt-4 text-sm text-gray-500">共 {orders.length} 辆</div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100/70 border-b border-gray-200">
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">工单号</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">车牌号</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">VIN</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">车型</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">客户名称</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">电话</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">单位</th>
                {!type && <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">状态</th>}
                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600">金额</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">创建时间</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">操作</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order: Order, 行号: number) => (
                <tr
                  key={order.id}
                  className={`border-b border-gray-100 last:border-0 transition-colors ${
                    行号 % 2 === 0 ? "bg-white" : "bg-slate-50/70"
                  } hover:bg-blue-50/70`}
                >
                  <td className="px-6 py-3.5 font-medium text-gray-900">
                    <button
                      type="button"
                      onClick={() => openOrderTab(order.id)}
                      className="text-blue-600 hover:text-blue-700 hover:underline text-left"
                    >
                      {order.order_no}
                    </button>
                  </td>
                  <td className="px-6 py-3.5 text-gray-900 font-medium">{order.vehicles?.plate_number || "-"}</td>
                  <td className="px-6 py-3.5 text-gray-500 font-mono text-xs whitespace-nowrap">{order.vehicles?.vin || "-"}</td>
                  <td className="px-6 py-3.5 text-gray-600">{order.vehicles?.brand} {order.vehicles?.model}</td>
                  <td className="px-6 py-3.5 text-gray-900">{order.customers?.name || "-"}</td>
                  <td className="px-6 py-3.5 text-gray-500">{order.customers?.phone || "-"}</td>
                  <td className="px-6 py-3.5 text-gray-500">{order.customers?.company || "-"}</td>
                  {!type && (
                    <td className="px-6 py-3.5">
                      {/* 多徽章：一个工单多个项目处于不同阶段时同时显示（如 施工中+待派工） */}
                      <div className="flex flex-wrap gap-1">
                        {order.boardStages.map((stage) => (
                          <span
                            key={stage}
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              阶段颜色[stage] || "bg-gray-100 text-gray-800"
                            }`}
                          >
                            {阶段文案[stage] || stage}
                          </span>
                        ))}
                      </div>
                    </td>
                  )}
                  <td className="px-6 py-3.5 text-right font-medium text-gray-900 tabular-nums">{formatCurrency(order.total_cost)}</td>
                  <td className="px-6 py-3.5 text-gray-400 text-xs whitespace-nowrap">{formatDate(order.created_at)}</td>
                  <td className="px-6 py-3.5">
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

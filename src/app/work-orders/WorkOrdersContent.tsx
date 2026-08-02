"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";
import WorkOrderActionButtons from "@/components/WorkOrderActionButtons";
import { PermissionGate } from "@/components/PermissionGate";
import { logAction } from "@/lib/operationLog";
import { 阶段文案, type 阶段key } from "@/lib/orderStage";
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
      /* 卡片视图同样内部滚动，保持顶部筛选区冻结 */
      <div className="min-h-0 flex-1 overflow-y-auto">
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
    /* flex 纵向 + min-h-0：表格卡片吃掉剩余高度并内部滚动，分页栏固定在底部始终可见 */
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex min-h-0 flex-1 flex-col">
        {/* overflow-auto：横向滚动（列冻结）+ 纵向滚动（表头冻结）都发生在这个容器里 */}
        <div className="min-h-0 flex-1 overflow-auto">
          {/* min-w-max：表格按内容撑开，超出容器时底部出现横向滚动条（参照1号车间） */}
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                {/* 表头纵向冻结（sticky top-0）+ 左右列横向冻结：
                 * 四角单元格 z-30 最高，普通表头 z-20（盖住横滚的 z-10 冻结数据格），
                 * 所有表头实色背景，否则滚动时内容透出来 */}
                <th className="sticky left-0 top-0 z-30 w-[150px] bg-slate-100 px-4 py-3 text-left text-xs font-semibold text-gray-600">工单号</th>
                <th className="sticky left-[150px] top-0 z-30 w-[110px] bg-slate-100 px-4 py-3 text-left text-xs font-semibold text-gray-600 border-r border-gray-200">车牌号</th>
                <th className="sticky top-0 z-20 bg-slate-100 px-6 py-3 text-left text-xs font-semibold text-gray-600">VIN</th>
                <th className="sticky top-0 z-20 bg-slate-100 px-6 py-3 text-left text-xs font-semibold text-gray-600">车型</th>
                <th className="sticky top-0 z-20 bg-slate-100 px-6 py-3 text-left text-xs font-semibold text-gray-600">客户名称</th>
                <th className="sticky top-0 z-20 bg-slate-100 px-6 py-3 text-left text-xs font-semibold text-gray-600">电话</th>
                <th className="sticky top-0 z-20 bg-slate-100 px-6 py-3 text-left text-xs font-semibold text-gray-600">单位</th>
                {!type && <th className="sticky top-0 z-20 bg-slate-100 px-6 py-3 text-left text-xs font-semibold text-gray-600">项目名称</th>}
                <th className="sticky top-0 z-20 bg-slate-100 px-6 py-3 text-right text-xs font-semibold text-gray-600">金额</th>
                <th className="sticky top-0 z-20 bg-slate-100 px-6 py-3 text-left text-xs font-semibold text-gray-600">创建时间</th>
                <th className="sticky right-[150px] top-0 z-30 w-[90px] bg-slate-100 px-4 py-3 text-left text-xs font-semibold text-gray-600 border-l border-gray-200">查看详情</th>
                <th className="sticky right-0 top-0 z-30 w-[150px] bg-slate-100 px-4 py-3 text-left text-xs font-semibold text-gray-600">工单操作</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order: Order, 行号: number) => (
                <tr
                  key={order.id}
                  className={`group border-b border-gray-100 last:border-0 transition-colors ${
                    行号 % 2 === 0 ? "bg-white" : "bg-slate-50/70"
                  } hover:bg-blue-50/70`}
                >
                  {/* 冻结单元格背景用实色（斑马纹同款），group-hover 跟随整行变色 */}
                  <td className={`sticky left-0 z-10 px-4 py-3.5 font-medium text-gray-900 whitespace-nowrap ${
                    行号 % 2 === 0 ? "bg-white" : "bg-slate-50"
                  } group-hover:bg-blue-50`}>
                    {/* 工单号缩短：小字单行显示，过长省略号 */}
                    <button
                      type="button"
                      onClick={() => openOrderTab(order.id)}
                      title={order.order_no}
                      className="inline-block max-w-full truncate align-bottom text-xs text-blue-600 hover:text-blue-700 hover:underline text-left"
                    >
                      {order.order_no}
                    </button>
                  </td>
                  <td className={`sticky left-[150px] z-10 px-4 py-3.5 text-gray-900 font-medium whitespace-nowrap border-r border-gray-200 ${
                    行号 % 2 === 0 ? "bg-white" : "bg-slate-50"
                  } group-hover:bg-blue-50`}>
                    {order.vehicles?.plate_number || "-"}
                  </td>
                  <td className="px-6 py-3.5 text-gray-500 font-mono text-xs whitespace-nowrap">{order.vehicles?.vin || "-"}</td>
                  <td className="px-6 py-3.5 text-gray-600 max-w-64 truncate" title={`${order.vehicles?.brand || ""} ${order.vehicles?.model || ""}`.trim()}>
                    {order.vehicles?.brand} {order.vehicles?.model}
                  </td>
                  <td className="px-6 py-3.5 text-gray-900 max-w-40 truncate" title={order.customers?.name || ""}>{order.customers?.name || "-"}</td>
                  <td className="px-6 py-3.5 text-gray-500 whitespace-nowrap">{order.customers?.phone || "-"}</td>
                  <td className="px-6 py-3.5 text-gray-500 max-w-40 truncate" title={order.customers?.company || ""}>{order.customers?.company || "-"}</td>
                  {!type && (
                    <td className="px-6 py-3.5 max-w-64">
                      {/* 项目名称：多个项目用 / 连接，单行省略号截断，悬停可见完整内容 */}
                      {order.项目名称.length > 0 ? (
                        <span
                          className="block truncate text-gray-700"
                          title={order.项目名称.join(" / ")}
                        >
                          {order.项目名称.join(" / ")}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                  )}
                  <td className="px-6 py-3.5 text-right font-medium text-gray-900 tabular-nums whitespace-nowrap">{formatCurrency(order.total_cost)}</td>
                  <td className="px-6 py-3.5 text-gray-400 text-xs whitespace-nowrap">{formatDate(order.created_at)}</td>
                  <td className={`sticky right-[150px] z-10 px-4 py-3.5 whitespace-nowrap border-l border-gray-200 ${
                    行号 % 2 === 0 ? "bg-white" : "bg-slate-50"
                  } group-hover:bg-blue-50`}>
                    <button
                      type="button"
                      onClick={() => openOrderTab(order.id)}
                      className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                    >
                      查看详情
                    </button>
                  </td>
                  <td className={`sticky right-0 z-10 px-4 py-3.5 ${
                    行号 % 2 === 0 ? "bg-white" : "bg-slate-50"
                  } group-hover:bg-blue-50`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <WorkOrderActionButtons
                        workOrderId={order.id}
                        orderNo={order.order_no}
                        currentType={order.order_type}
                        onSuccess={() => window.location.reload()}
                      />
                      {type === "cancelled" && (
                        /* 删除已作废工单仅管理员/老板（数据库 RLS 同样拦截其他角色） */
                        <PermissionGate permission="work_order:delete">
                          <button
                            type="button"
                            onClick={() => handleDelete(order.id, order.order_no)}
                            className="text-sm text-red-600 hover:text-red-700 font-medium"
                          >
                            删除
                          </button>
                        </PermissionGate>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {queryError && (
                <tr>
                  <td colSpan={type ? 11 : 12} className="px-6 py-12 text-center text-red-500">
                    查询失败: {queryError}
                  </td>
                </tr>
              )}
              {!queryError && orders.length === 0 && (
                <tr>
                  <td colSpan={type ? 11 : 12} className="px-6 py-12 text-center text-gray-400">
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

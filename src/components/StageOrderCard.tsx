"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import RequirementActions from "./RequirementActions";
import { CustomerOpinionToggle } from "./CustomerOpinionToggle";
import { AssignMechanicModal } from "./AssignMechanicModal";
import { AssignInspectorModal } from "./AssignInspectorModal";
import { 阶段文案, 阶段颜色, type 阶段key } from "@/lib/orderStage";
import { formatCurrency } from "@/lib/utils";
import type { Order } from "@/app/work-orders/page";

/* 阶段卡片（可操作版）：
 * 工单列表分栏视图的单个工单卡片。按"当前阶段"渲染项目行+操作区：
 * 待诊断-需求领单/指派；待确认-客户意见；待派工-意见+派工；待施工-开始施工；
 * 施工中/已中断-中断/完工/取消/恢复；待质检-指派质检；待结单-确认结单；
 * 待结算-显示工时/配件金额。
 * 操作成功后统一 router.refresh()：列表重取，工单自动挪到下一阶段列。 */

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

type StageItem = Order["stageItems"][number];

interface Props {
  order: Order;
  当前阶段: 阶段key;
  profiles: Profile[];
  mechanicGroups: MechanicGroup[];
  on打开工单: (orderId: string) => void;
}

export default function StageOrderCard({ order, 当前阶段, profiles, mechanicGroups, on打开工单 }: Props) {
  const supabase = createClient();
  const [操作中, set操作中] = useState<string | null>(null); // "itemId:action" 防连点
  const [派工项目, set派工项目] = useState<StageItem | null>(null);
  const [质检项目, set质检项目] = useState<StageItem | null>(null);
  /* 操作后【不自动刷新】（用户拍板）：连续对同一车多个项目操作时卡片不能跑掉。
   * 该项目的按钮置灰表示"已操作"；数据库变化由 WorkOrdersRefreshBar 的
   * Realtime 监听捕获，右下角弹"工单数据有更新"，用户点"立即刷新"才统一挪列 */
  const [已操作, set已操作] = useState<Set<string>>(new Set());

  const 阶段项目 = order.stageItems.filter((i) => i.stage === 当前阶段);

  function 技师名(item: StageItem): string {
    if (item.mechanics.length === 0) return "未分配";
    return item.mechanics
      .map((m) => profiles.find((p) => p.id === m.mechanic_id)?.full_name || "-")
      .join("、");
  }

  /* 计时操作（开始/中断/恢复/完工/取消）：走 add_construction_log RPC，
   * 服务端校验（已派工+本人或管理角色+客户已同意），失败弹中文错误 */
  async function 计时(itemId: string, action: "start" | "pause" | "resume" | "complete" | "cancel") {
    const key = `${itemId}:${action}`;
    if (操作中) return;
    set操作中(key);
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase.rpc("add_construction_log", {
      p_work_order_item_id: itemId,
      p_mechanic_id: userData.user?.id || null,
      p_action: action,
    });
    set操作中(null);
    const res = data as { success: boolean; error?: string } | null;
    if (error) {
      alert("操作失败: " + error.message);
      return;
    }
    if (!res?.success) {
      alert(res?.error || "操作失败");
      return;
    }
    /* 不自动刷新：按钮置灰标记已操作，等用户点右下角"立即刷新"统一挪列 */
    set已操作((prev) => new Set(prev).add(itemId));
  }

  /* 确认结单（快速通道）：串行两段流转 →待结单 →待结算 */
  async function 确认结单() {
    if (操作中) return;
    set操作中("close");
    const r1 = await supabase.rpc("transition_work_order", {
      p_order_id: order.id, p_next_status: "pending_close", p_notes: null,
    });
    const res1 = r1.data as { success: boolean; error?: string } | null;
    if (r1.error || !res1?.success) {
      set操作中(null);
      alert("操作失败: " + (r1.error?.message || res1?.error || "状态流转被拒绝"));
      return;
    }
    const r2 = await supabase.rpc("transition_work_order", {
      p_order_id: order.id, p_next_status: "pending_settlement", p_notes: null,
    });
    set操作中(null);
    const res2 = r2.data as { success: boolean; error?: string } | null;
    if (r2.error || !res2?.success) {
      alert("操作失败: " + (r2.error?.message || res2?.error || "状态流转被拒绝"));
      return;
    }
    set已操作((prev) => new Set(prev).add("close"));
  }

  /* 操作按钮通用样式 + 防连点 + 已操作置灰 + 阻止冒泡（整卡可点击进详情） */
  function 按钮(
    label: string,
    onClick: () => void,
    color: string,
    key: string,
    itemId?: string
  ) {
    const 已置灰 = itemId ? 已操作.has(itemId) : 已操作.has(key);
    return (
      <button
        key={key}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        disabled={操作中 !== null || 已置灰}
        className={`text-[11px] px-1.5 py-0.5 rounded border disabled:opacity-50 ${color}`}
      >
        {操作中 === key ? "…" : 已置灰 ? "✓ 已操作" : label}
      </button>
    );
  }

  /* 按阶段渲染项目行右侧操作区 */
  function 项目操作(item: StageItem) {
    switch (当前阶段) {
      case "pending_confirm":
      case "pending_dispatch":
        return (
          <span onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5 shrink-0">
            <CustomerOpinionToggle itemId={item.id} opinion={item.customer_opinion || "pending"} />
            {当前阶段 === "pending_dispatch" &&
              按钮("派工", () => set派工项目(item), "bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100", `${item.id}:assign`, item.id)}
          </span>
        );
      case "pending_construction":
        return (
          <span className="flex items-center gap-1 shrink-0">
            {按钮("开始施工", () => 计时(item.id, "start"), "bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100", `${item.id}:start`, item.id)}
          </span>
        );
      case "in_progress":
        return (
          <span className="flex items-center gap-1 shrink-0">
            {按钮("中断", () => 计时(item.id, "pause"), "bg-yellow-50 text-yellow-600 border-yellow-200 hover:bg-yellow-100", `${item.id}:pause`, item.id)}
            {按钮("完工", () => 计时(item.id, "complete"), "bg-green-50 text-green-600 border-green-200 hover:bg-green-100", `${item.id}:complete`, item.id)}
            {按钮("取消", () => 计时(item.id, "cancel"), "bg-red-50 text-red-600 border-red-200 hover:bg-red-100", `${item.id}:cancel`, item.id)}
          </span>
        );
      case "paused":
        return (
          <span className="flex items-center gap-1 shrink-0">
            {按钮("恢复施工", () => 计时(item.id, "resume"), "bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100", `${item.id}:resume`, item.id)}
            {按钮("完工", () => 计时(item.id, "complete"), "bg-green-50 text-green-600 border-green-200 hover:bg-green-100", `${item.id}:complete`, item.id)}
            {按钮("取消", () => 计时(item.id, "cancel"), "bg-red-50 text-red-600 border-red-200 hover:bg-red-100", `${item.id}:cancel`, item.id)}
          </span>
        );
      case "pending_qc":
        return (
          <span className="flex items-center gap-1 shrink-0">
            {按钮("指派质检", () => set质检项目(item), "bg-purple-50 text-purple-600 border-purple-200 hover:bg-purple-100", `${item.id}:qc`, item.id)}
          </span>
        );
      default:
        return null;
    }
  }

  return (
    <div
      onClick={() => on打开工单(order.id)}
      className="bg-white rounded-xl border border-gray-200 shadow-sm cursor-pointer hover:shadow-md hover:border-blue-300 transition-all"
    >
      {/* 卡片头：车牌 + 车型 + 状态徽章 */}
      <div className="flex items-start justify-between px-4 pt-3">
        <div className="min-w-0">
          <div className="text-base font-semibold text-gray-900">
            {order.vehicles?.plate_number || "-"}
          </div>
          <div className="text-xs text-gray-400 truncate">
            {order.vehicles?.brand} {order.vehicles?.model}
          </div>
        </div>
        <span
          className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
            阶段颜色[当前阶段] || "bg-gray-100 text-gray-800"
          }`}
        >
          {阶段文案[当前阶段] || 当前阶段}
        </span>
      </div>
      <div className="px-4 mt-0.5 text-xs text-gray-400 truncate">
        {order.order_no} · {order.customers?.name || "-"}
      </div>

      {/* 卡片体：按阶段渲染 */}
      <div className="px-4 py-3 mt-2 border-t border-gray-100 space-y-1.5 min-h-[2.5rem]">
        {当前阶段 === "pending_diagnosis" ? (
          order.未指派需求.length > 0 ? (
            <>
              <div className="text-xs text-orange-500 font-medium">待指派的需求：</div>
              {order.未指派需求.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-gray-700 truncate">· {r.description || "（无描述）"}</span>
                  <span onClick={(e) => e.stopPropagation()} className="shrink-0">
                    <RequirementActions requirement={{ id: r.id, assigned_to: null }} profiles={profiles} />
                  </span>
                </div>
              ))}
            </>
          ) : (
            <div className="text-xs text-gray-400 italic">
              {order.有未指派需求 ? "需求待指派诊断" : "待添加维修项目"}
            </div>
          )
        ) : 当前阶段 === "pending_close" ? (
          <>
            <div className="text-xs text-teal-600">已满足结单条件，可结单</div>
            <div>
              {按钮(操作中 === "close" ? "结单中…" : "确认结单", 确认结单, "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700", "close")}
            </div>
          </>
        ) : 当前阶段 === "pending_settlement" ? (
          <div className="text-xs text-gray-600 space-y-0.5">
            <div className="flex justify-between">
              <span>工时</span>
              <span className="font-medium">{formatCurrency(order.labor_cost)}</span>
            </div>
            <div className="flex justify-between">
              <span>配件</span>
              <span className="font-medium">{formatCurrency(order.parts_cost)}</span>
            </div>
            <div className="flex justify-between border-t border-gray-100 pt-0.5">
              <span>合计</span>
              <span className="font-bold text-gray-900">{formatCurrency(order.total_cost)}</span>
            </div>
            <div className="text-[10px] text-gray-400">点击卡片进入工单结算</div>
          </div>
        ) : 阶段项目.length > 0 ? (
          阶段项目.map((i) => (
            <div key={i.id} className="flex items-center justify-between gap-2">
              <span className="text-sm text-gray-700 truncate min-w-0">
                · {i.alias_name || i.name}
                {(当前阶段 === "pending_construction" || 当前阶段 === "in_progress" || 当前阶段 === "paused") && (
                  <span className="text-[10px] text-gray-400 ml-1">[{技师名(i)}]</span>
                )}
              </span>
              {项目操作(i)}
            </div>
          ))
        ) : (
          <div className="text-xs text-gray-400 italic">
            {当前阶段 === "settled" ? `共 ${order.stageItems.length} 个项目` : "该阶段暂无项目"}
          </div>
        )}
      </div>

      {/* 派工弹窗（复用详情页组件，含领单） */}
      {派工项目 && (
        <AssignMechanicModal
          open={!!派工项目}
          itemId={派工项目.id}
          profiles={profiles.map((p) => ({
            id: p.id,
            full_name: p.full_name,
            is_mechanic: (p.profile_roles || []).some((r) => r.roles?.name === "mechanic"),
            group_name: mechanicGroups.find((g) => g.id === p.group_id)?.name || null,
            level_sort: (p.mechanic_levels || [])[0]?.sort_order ?? -1,
          }))}
          mechanicGroups={mechanicGroups}
          existingMechanics={派工项目.mechanics.map((m) => ({
            mechanic_id: m.mechanic_id,
            share_pct: m.share_pct ?? 100,
            profiles: { full_name: profiles.find((p) => p.id === m.mechanic_id)?.full_name || "-" },
          }))}
          onClose={() => set派工项目(null)}
          onSaved={() => {
            const id = 派工项目.id;
            set派工项目(null);
            /* 不自动刷新：按钮置灰，等右下角"立即刷新"统一挪列 */
            set已操作((prev) => new Set(prev).add(id));
          }}
        />
      )}

      {/* 质检指派弹窗（复用详情页组件，含领单；未派工自动拦截） */}
      {质检项目 && (
        <AssignInspectorModal
          open={!!质检项目}
          itemId={质检项目.id}
          profiles={profiles.map((p) => ({ id: p.id, full_name: p.full_name }))}
          inspectorId={质检项目.inspector_id}
          onClose={() => set质检项目(null)}
          onSaved={() => {
            const id = 质检项目.id;
            set质检项目(null);
            set已操作((prev) => new Set(prev).add(id));
          }}
        />
      )}
    </div>
  );
}

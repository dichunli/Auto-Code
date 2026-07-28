"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/* 工单列表页：手动刷新按钮 + 数据更新提示条
 * - 常驻"刷新"按钮：手动重取列表和角标（router.refresh 服务端重新渲染）
 * - Realtime 监听工单相关表：任何变化（含他人操作）→ 右下角弹提示条，
 *   点"立即刷新"应用最新数据，点 × 忽略；不自动刷新，避免打断正在浏览/筛选的操作 */
const 监听表 = [
  "work_orders",               // 工单本身（状态、金额、车辆等）
  "work_order_items",          // 项目（状态、质检、增删）
  "work_order_item_mechanics", // 派工（影响 待派工/待施工 角标）
  "work_order_requirements",   // 需求指派（影响 待诊断 角标）
  "part_picking_records",      // 领料出库（影响快速通道 待结单 角标）
  "part_return_records",       // 退库（同上）
];

export default function WorkOrdersRefreshBar() {
  const router = useRouter();
  const supabase = createClient();
  const [有更新, set有更新] = useState(false);
  const [刷新中, set刷新中] = useState(false);

  useEffect(() => {
    const channel = supabase.channel("wo_list_watch");
    for (const table of 监听表) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => set有更新(true));
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  function 刷新() {
    set刷新中(true);
    set有更新(false);
    router.refresh();
    /* refresh 无完成回调，短暂延迟后恢复按钮防连点 */
    setTimeout(() => set刷新中(false), 1000);
  }

  return (
    <>
      {/* 常驻手动刷新按钮 */}
      <button
        type="button"
        onClick={刷新}
        disabled={刷新中}
        className="px-3 py-1.5 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap shrink-0"
        title="重新加载列表和角标"
      >
        {刷新中 ? "刷新中…" : "↻ 刷新"}
      </button>

      {/* 更新提示条：悬浮右下角，不遮挡内容、不推布局 */}
      {有更新 && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-2xl">
          <span>工单数据有更新</span>
          <button
            type="button"
            onClick={刷新}
            className="px-3 py-1 text-xs font-medium bg-blue-500 rounded-lg hover:bg-blue-400"
          >
            立即刷新
          </button>
          <button
            type="button"
            onClick={() => set有更新(false)}
            className="text-white/60 hover:text-white text-base leading-none"
            aria-label="忽略"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}

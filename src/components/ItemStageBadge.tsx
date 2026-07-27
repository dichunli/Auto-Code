"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getItemStageKey, 阶段文案, 阶段颜色, type 阶段key } from "@/lib/orderStage";

interface Props {
  itemId: string;
  itemType?: string | null;
  status?: string | null;
  requireQc?: boolean | null;
  qcStatus?: string | null;
  初始已派工: boolean;
}

interface 重查行 {
  status: string | null;
  require_qc: boolean | null;
  qc_status: string | null;
  mechanic_id: string | null;
  item_type: string | null;
  work_order_item_mechanics: { mechanic_id: string }[] | null;
}

/* 项目状态徽章（待派工/待施工/施工中/已中断/待质检/已完工）。
 * 初始用服务端数据渲染；监听 wo-item-update 事件（派工/计时/质检操作后广播），
 * 重查自身状态立即更新徽章，不整页刷新。非 labor 项目不显示。 */
export default function ItemStageBadge({
  itemId,
  itemType,
  status,
  requireQc,
  qcStatus,
  初始已派工,
}: Props) {
  const supabase = createClient();
  const [stage, setStage] = useState<阶段key | null>(() =>
    getItemStageKey({
      item_type: itemType,
      status,
      require_qc: requireQc,
      qc_status: qcStatus,
      已派工: 初始已派工,
    })
  );

  useEffect(() => {
    async function 重查() {
      const { data } = await supabase
        .from("work_order_items")
        .select("status, require_qc, qc_status, mechanic_id, item_type, work_order_item_mechanics(mechanic_id)")
        .eq("id", itemId)
        .single();
      const row = data as 重查行 | null;
      if (!row) return;
      setStage(
        getItemStageKey({
          item_type: row.item_type,
          status: row.status,
          require_qc: row.require_qc,
          qc_status: row.qc_status,
          已派工: (row.work_order_item_mechanics || []).length > 0 || !!row.mechanic_id,
        })
      );
    }
    function handle(e: Event) {
      const detail = (e as CustomEvent).detail as { itemId?: string };
      if (detail?.itemId === itemId) 重查();
    }
    window.addEventListener("wo-item-update", handle as EventListener);
    return () => window.removeEventListener("wo-item-update", handle as EventListener);
  }, [itemId, supabase]);

  if (!stage) return null;

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${阶段颜色[stage]}`}
    >
      {阶段文案[stage]}
    </span>
  );
}

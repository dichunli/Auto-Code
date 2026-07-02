"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { 是否自己刚改的配件, 是否自己刚结构改动的项目 } from "@/lib/localEditSignal";

interface Props {
  itemIds: string[];
}

export function WorkOrderRealtimeSync({ itemIds }: Props) {
  const supabase = createClient();
  const router = useRouter();
  useEffect(() => {
    if (itemIds.length === 0) return;

    const filter = `work_order_item_id=in.(${itemIds.join(",")})`;

    const channel = supabase
      .channel(`work_order_parts_${itemIds[0]}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "work_order_item_parts",
          filter,
        },
        (payload) => {
          // 区分自己/别人的改动，避免自己的操作触发整页刷新（已局部更新或自己已刷新）
          const newRow = payload.new as { id?: string; work_order_item_id?: string } | null;
          const oldRow = payload.old as { id?: string; work_order_item_id?: string } | null;
          const 变化的分支id = newRow?.id || oldRow?.id || "";
          const 所属项目id = newRow?.work_order_item_id || oldRow?.work_order_item_id || "";
          // 1) 自己刚改的那条配件（局部更新过，跳过）
          if (是否自己刚改的配件(变化的分支id)) return;
          // 2) 自己刚结构性改动的项目（加/删分支等，自己已 router.refresh，跳过避免双刷）
          if (是否自己刚结构改动的项目(所属项目id)) return;
          // 其余（别人改的、改别的项目）照常刷新同步
          router.refresh();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, router, itemIds]);

  return null;
}

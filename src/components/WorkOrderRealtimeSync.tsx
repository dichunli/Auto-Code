"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { 是否自己刚改的配件 } from "@/lib/localEditSignal";

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
          // 区分自己/别人的改动：自己刚改的那条配件已局部更新，跳过整页刷新；
          // 别人改的、或改的是别的配件，照常刷新同步（保住多人协作）
          const newRow = payload.new as { id?: string } | null;
          const oldRow = payload.old as { id?: string } | null;
          const 变化的分支id = newRow?.id || oldRow?.id || "";
          if (是否自己刚改的配件(变化的分支id)) return;
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

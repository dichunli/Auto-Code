"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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
        () => {
          router.refresh();
        }
      )
      .subscribe((status) => {
        console.log("[工单Realtime] 订阅状态:", status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, router, itemIds]);

  return null;
}

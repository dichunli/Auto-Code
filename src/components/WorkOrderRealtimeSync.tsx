"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { requestNotificationPermission, sendBrowserNotification } from "@/lib/notification";

interface Props {
  itemIds: string[];
}

export function WorkOrderRealtimeSync({ itemIds }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const lastNotifyTime = useRef<number>(0);

  useEffect(() => {
    if (itemIds.length === 0) return;

    requestNotificationPermission();

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
          /* 5 秒内只通知一次，避免刷屏 */
          if (Date.now() - lastNotifyTime.current > 5000) {
            lastNotifyTime.current = Date.now();
            sendBrowserNotification("工单配件更新", "工单配件状态有变动，请查看最新情况");
          }
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

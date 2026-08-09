"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, 确保有session, 获取访问令牌 } from "@/lib/supabase/client";
import { 是否自己刚改的配件, 是否自己刚结构改动的项目, 是否本机最近操作 } from "@/lib/localEditSignal";

interface Props {
  orderId: string;
  itemIds: string[];
  partIds: string[];
}

// 工单详情页实时同步（混合策略）：
//  · 改金额/数量/选中等（UPDATE，高频）→ 直接用推送新值秒级更新界面，不刷整页。
//    只改已存在分支的字段，带完整新值，不会拼出错数据。
//  · 加/删分支、其它表变化（低频/结构变化）→ 弹"点击刷新"提示条，用户点一下干净整页刷新，
//    避免结构变化时合计偏差或显示不一致。
export function WorkOrderRealtimeSync({ orderId, itemIds = [], partIds = [] }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const [有更新, set有更新] = useState(false);

  useEffect(() => {
    if (!orderId) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      // 先确保登录 session 注入实时连接，否则以匿名身份连接会被 RLS 挡掉推送
      await 确保有session();
      const token = 获取访问令牌();
      if (token) {
        try { supabase.realtime.setAuth(token); } catch { /* 忽略 */ }
      }
      if (cancelled) return;

      const onPartChange = (payload: { eventType?: string; new?: unknown; old?: unknown }) => {
        const newRow = payload.new as Record<string, unknown> | null;
        const oldRow = payload.old as Record<string, unknown> | null;
        const 变化的分支id = (newRow?.id as string) || (oldRow?.id as string) || "";
        const 所属项目id = (newRow?.work_order_item_id as string) || (oldRow?.work_order_item_id as string) || "";
        if (是否自己刚改的配件(变化的分支id)) return;
        if (是否自己刚结构改动的项目(所属项目id)) return;

        // 改字段（UPDATE）：秒级广播更新，不刷整页
        if (payload.eventType === "UPDATE" && newRow) {
          window.dispatchEvent(
            new CustomEvent("wo-part-update", {
              detail: {
                itemId: 所属项目id,
                partId: 变化的分支id,
                unit_price: typeof newRow.unit_price === "number" ? newRow.unit_price : newRow.unit_price == null ? 0 : Number(newRow.unit_price),
                unit_cost: newRow.unit_cost,
                cost_price: newRow.cost_price,
                quantity: typeof newRow.quantity === "number" ? newRow.quantity : newRow.quantity == null ? 0 : Number(newRow.quantity),
                is_selected: !!newRow.is_selected,
                part_number: newRow.part_number,
                brand: newRow.brand,
                specification: newRow.specification,
                supplier_name: newRow.supplier_name,
                document_name: newRow.document_name,
                customer_opinion: newRow.customer_opinion,
                is_purchased: newRow.is_purchased,
                is_arrived: newRow.is_arrived,
                fromRealtime: true,
              },
            })
          );
          return;
        }
        // 加/删分支（INSERT/DELETE，结构变化）→ 提示条（本机刚操作的连锁变更不弹）
        if (是否本机最近操作()) return;
        set有更新(true);
      };
      // 其它表（状态/付款/派工/领料等）变化 → 提示条。
      // 本机刚操作过则跳过：自己改配件会触发数据库重算工单合计等连锁更新，不该给自己弹提示。
      const onOtherChange = () => { if (是否本机最近操作()) return; set有更新(true); };

      channel = supabase.channel(`wo_sync_${orderId}`);
      channel.on("postgres_changes", { event: "*", schema: "public", table: "work_orders", filter: `id=eq.${orderId}` }, onOtherChange);
      channel.on("postgres_changes", { event: "*", schema: "public", table: "work_order_items", filter: `work_order_id=eq.${orderId}` }, onOtherChange);
      channel.on("postgres_changes", { event: "*", schema: "public", table: "work_order_requirements", filter: `work_order_id=eq.${orderId}` }, onOtherChange);
      channel.on("postgres_changes", { event: "*", schema: "public", table: "work_order_inspections", filter: `work_order_id=eq.${orderId}` }, onOtherChange);
      channel.on("postgres_changes", { event: "*", schema: "public", table: "payments", filter: `work_order_id=eq.${orderId}` }, onOtherChange);
      channel.on("postgres_changes", { event: "*", schema: "public", table: "quality_checks", filter: `work_order_id=eq.${orderId}` }, onOtherChange);
      channel.on("postgres_changes", { event: "*", schema: "public", table: "advance_payment_records", filter: `work_order_id=eq.${orderId}` }, onOtherChange);
      if (itemIds.length > 0) {
        const itemFilter = `work_order_item_id=in.(${itemIds.join(",")})`;
        channel.on("postgres_changes", { event: "*", schema: "public", table: "work_order_item_parts", filter: itemFilter }, onPartChange);
        channel.on("postgres_changes", { event: "*", schema: "public", table: "work_order_item_mechanics", filter: itemFilter }, onOtherChange);
      }
      if (partIds.length > 0) {
        const partFilter = `work_order_item_part_id=in.(${partIds.join(",")})`;
        channel.on("postgres_changes", { event: "*", schema: "public", table: "part_picking_records", filter: partFilter }, onOtherChange);
        channel.on("postgres_changes", { event: "*", schema: "public", table: "part_return_records", filter: partFilter }, onOtherChange);
        channel.on("postgres_changes", { event: "*", schema: "public", table: "supplier_return_records", filter: partFilter }, onOtherChange);
        /* 配件申领（手机端发起）→ 对端弹"点击刷新"提示条，库管及时看到申领角标 */
        channel.on("postgres_changes", { event: "*", schema: "public", table: "part_pick_requests", filter: partFilter }, onOtherChange);
      }
      channel.subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
     
  }, [supabase, router, orderId, itemIds.join(","), partIds.join(",")]);

  if (!有更新) return null;

  return (
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[200] px-1">
      <button
        type="button"
        onClick={() => { set有更新(false); router.refresh(); }}
        className="flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500 text-white text-sm font-medium shadow-lg hover:bg-amber-600 active:scale-95 transition"
      >
        <span className="inline-block w-2 h-2 rounded-full bg-white animate-pulse" />
        配件增删或其它改动，点击刷新
      </button>
    </div>
  );
}

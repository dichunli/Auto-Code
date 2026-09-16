"use client";

import { useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useConfirm } from "./ConfirmDialog";
import { 已入库退货 } from "@/app/procurement/actions";
import { toast } from "@/lib/globalToast";

/* ═══ 退库后连续退货（2026-09-16 用户拍板） ═══
 * 场景：带车牌的配件（工单件）领用后退库，容易忘记还要退给供应商。
 * 用法：退库动作成功后调用 提示并连续退货(明细, 来源描述)：
 *   1. 反查采购明细——只认「采购单已入库 + 带车牌」的行（工单配件才有退货链路）
 *   2. 有可退的才弹确认：选「退给供应商」→ 调已入库退货（扣库存+建待退货记录）
 *      选「仅退库」→ 什么都不做
 *   3. 退货走 create_inbound_return 正规流程，已入库页的"已退"标记自动覆盖
 * 调用方需渲染返回的 {连续退货弹窗}（useConfirm 的 Portal，能盖在退库弹窗上）。 */

/* 退料明细里连续退货需要的最小字段 */
export interface 退库明细行 {
  work_order_item_part_id: string;
  quantity: number;
  name: string | null;
  /* 退料类型（excess/wrong_pick/wrong_ship/damaged），用于映射退货原因 */
  return_type?: string | null;
  /* 批次二选一：batch_id 直给，或给 picking_record_id 由本 Hook 补查 */
  batch_id?: string | null;
  picking_record_id?: string | null;
}

interface 采购明细反查行 {
  id: string;
  work_order_item_part_id: string | null;
  license_plate: string | null;
}

export function useRetreatToSupplier() {
  const supabase = createClient();
  const { 请求确认, 确认弹窗 } = useConfirm();

  const 提示并连续退货 = useCallback(
    async (明细: 退库明细行[], 来源描述: string) => {
      if (明细.length === 0) return;
      const woipIds = [...new Set(明细.map((m) => m.work_order_item_part_id))];

      /* 1. 反查采购明细：采购单已入库 + 带车牌（license_plate 是采购时从工单快照的） */
      const { data: poi行, error: 反查错误 } = await supabase
        .from("purchase_order_items")
        .select("id, work_order_item_part_id, license_plate, purchase_orders!inner(status)")
        .in("work_order_item_part_id", woipIds)
        .eq("purchase_orders.status", "completed")
        .not("license_plate", "is", null);
      if (反查错误) {
        console.error("退库连续退货反查采购明细失败:", 反查错误);
        return;
      }
      if (!poi行 || poi行.length === 0) return;

      /* 一个工单配件行进过采购就只取第一条（is_purchased 机制保证一配件行只进一张活单） */
      const 映射 = new Map<string, 采购明细反查行>();
      for (const p of poi行 as unknown as 采购明细反查行[]) {
        if (p.work_order_item_part_id && !映射.has(p.work_order_item_part_id)) {
          映射.set(p.work_order_item_part_id, p);
        }
      }

      /* 2. 补查缺的批次（按领料记录） */
      const 缺批次记录ids = 明细
        .filter((m) => !m.batch_id && m.picking_record_id && 映射.has(m.work_order_item_part_id))
        .map((m) => m.picking_record_id as string);
      const 批次补查 = new Map<string, string>();
      if (缺批次记录ids.length > 0) {
        const { data: 领料行 } = await supabase
          .from("part_picking_records")
          .select("id, batch_id")
          .in("id", 缺批次记录ids);
        for (const r of (领料行 || []) as { id: string; batch_id: string | null }[]) {
          if (r.batch_id) 批次补查.set(r.id, r.batch_id);
        }
      }

      /* 3. 组装可退清单（有采购明细关联 + 有批次才能退——退货要扣批次剩余） */
      const 可退明细 = 明细
        .map((m) => ({
          ...m,
          poi: 映射.get(m.work_order_item_part_id),
          批次: m.batch_id || (m.picking_record_id ? 批次补查.get(m.picking_record_id) : undefined),
        }))
        .filter((m) => m.poi && m.批次);
      if (可退明细.length === 0) return;

      /* 4. 弹确认：选「退给供应商」才继续 */
      const 总件数 = 可退明细.reduce((s, m) => s + m.quantity, 0);
      const 清单文本 = 可退明细
        .map((m, i) => `${i + 1}. ${m.name || "-"} × ${m.quantity}（${m.poi!.license_plate}）`)
        .join("\n");
      const 确认 = await 请求确认({
        title: "退库完成，是否退给供应商？",
        message:
          `以下 ${可退明细.length} 种带车牌的配件（共 ${总件数} 件）来自已入库采购单：\n${清单文本}\n\n` +
          `选「退给供应商」将立即扣减库存并生成待退货记录（之后到「采购 → 待退货」页生成采退单冲减欠款）；\n选「仅退库」则货留在库存，以后可到「采购 → 已入库」页手动退货。`,
        confirmText: "退给供应商",
        cancelText: "仅退库",
        danger: false,
      });
      if (!确认) return;

      /* 5. 连续退货（一个事务，全部成功或全部回滚） */
      const res = await 已入库退货(
        可退明细.map((m) => ({
          purchase_order_item_id: m.poi!.id,
          batch_id: m.批次!,
          quantity: m.quantity,
          /* 退料类型映射退货原因：损坏→质量问题，其余→其他 */
          return_reason: m.return_type === "damaged" ? "quality" : "other",
          notes: `退库后连续退货（${来源描述}）`,
        }))
      );
      if (res.success) {
        toast(`已生成待退货记录（${可退明细.length} 种），请到「采购 → 待退货」页生成采退单`, "success");
      } else {
        toast("退货失败: " + (res.error || "未知错误") + "；可到「采购 → 已入库」页手动退货", "error");
      }
    },
    [supabase, 请求确认]
  );

  return { 提示并连续退货, 连续退货弹窗: 确认弹窗 };
}

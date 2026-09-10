"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { 确认领料出库, 作废领料单 } from "@/app/picking-orders/actions";

/* 待确认领料单操作（2026-09-11 出库管控）：仅 draft 单 + 库管角色显示。
   确认出库：补扣库存（库存不足整单回滚保持 draft）；作废：删单释放占位 */
export function PickingDraftActions({ 领料单id, 单号 }: { 领料单id: string; 单号: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [确认中, 设确认中] = useState(false);
  const [作废中, 设作废中] = useState(false);

  async function 处理确认() {
    if (!confirm(`确认出库 ${单号}？\n确认后立即扣库存，不可撤销。`)) return;
    设确认中(true);
    try {
      const r = await 确认领料出库(领料单id);
      if (!r.success) {
        showToast("确认出库失败: " + (r.error || "未知错误"), "error");
        return;
      }
      showToast(`领料单 ${r.picking_no || 单号} 已确认出库`, "success");
      router.refresh();
    } catch (err: unknown) {
      showToast("确认出库失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    } finally {
      设确认中(false);
    }
  }

  async function 处理作废() {
    if (!confirm(`作废待确认领料单 ${单号}？\n作废后单据删除，配件重新出现在待领料列表，可重新开单。`)) return;
    设作废中(true);
    try {
      const r = await 作废领料单(领料单id);
      if (!r.success) {
        showToast("作废失败: " + (r.error || "未知错误"), "error");
        return;
      }
      showToast(`领料单 ${r.picking_no || 单号} 已作废`, "success");
      router.push("/picking-orders");
      router.refresh();
    } catch (err: unknown) {
      showToast("作废失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    } finally {
      设作废中(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={处理确认}
        disabled={确认中 || 作废中}
        className="px-3 py-1.5 text-xs rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
      >
        {确认中 ? "确认中..." : "确认出库"}
      </button>
      <button
        type="button"
        onClick={处理作废}
        disabled={确认中 || 作废中}
        className="px-3 py-1.5 text-xs rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
      >
        {作废中 ? "作废中..." : "作废"}
      </button>
    </>
  );
}

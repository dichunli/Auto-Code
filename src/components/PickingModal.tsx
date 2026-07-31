"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { 创建领料单, type 领料明细输入 } from "@/app/picking-orders/actions";

interface Batch {
  id: string;
  batch_no: string;
  remaining: number;
  unit_cost: number;
  inbound_at: string;
}

/* 工单配件分支快照（生成领料单明细时冗余保存） */
interface 分支快照 {
  part_number: string | null;
  name: string | null;
  brand: string | null;
  specification: string | null;
  unit: string | null;
  part_id: string | null;
}

interface Props {
  open: boolean;
  partId: string | null;
  partName: string;
  workOrderItemPartId: string;
  quantityNeeded: number;
  onClose: () => void;
  onSuccess: () => void;
}

export function PickingModal({
  open,
  partId,
  partName,
  workOrderItemPartId,
  quantityNeeded,
  onClose,
  onSuccess,
}: Props) {
  const supabase = createClient();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [快照, 设快照] = useState<分支快照 | null>(null);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!open || !partId) return;
    setFetching(true);
    /* 并行查可用批次和配件分支快照 */
    Promise.all([
      supabase
        .from("part_batches")
        .select("id, batch_no, remaining, unit_cost, inbound_at")
        .eq("part_id", partId)
        .gt("remaining", 0)
        .order("inbound_at", { ascending: true }),
      supabase
        .from("work_order_item_parts")
        .select("part_number, name, brand, specification, unit, part_id")
        .eq("id", workOrderItemPartId)
        .single(),
    ]).then(([批次结果, 快照结果]) => {
      if (批次结果.error) console.error(批次结果.error);
      setBatches(批次结果.data || []);
      if (快照结果.data) 设快照(快照结果.data as 分支快照);
      setFetching(false);
    });
  }, [open, partId, workOrderItemPartId, supabase]);

  useEffect(() => {
    if (open) setSelected({});
  }, [open]);

  const totalSelected = Object.values(selected).reduce((a, b) => a + b, 0);

  function setBatchQty(batchId: string, qty: number) {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return;
    const valid = Math.max(0, Math.min(qty, batch.remaining));
    setSelected((prev) => {
      const next = { ...prev, [batchId]: valid };
      if (valid === 0) delete next[batchId];
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (totalSelected <= 0 || totalSelected > quantityNeeded) {
      alert(`领料数量必须在 1-${quantityNeeded} 之间`);
      return;
    }
    setLoading(true);

    try {
      /* 每个选中批次生成一条领料明细 */
      const 明细: 领料明细输入[] = Object.entries(selected)
        .filter(([, qty]) => qty > 0)
        .map(([batchId, qty]) => {
          const batch = batches.find((b) => b.id === batchId);
          return {
            work_order_item_part_id: workOrderItemPartId,
            part_id: partId,
            batch_id: batchId,
            quantity: qty,
            part_number: 快照?.part_number || null,
            name: 快照?.name || partName,
            brand: 快照?.brand || null,
            specification: 快照?.specification || null,
            unit: 快照?.unit || null,
            batch_no: batch?.batch_no || null,
            unit_cost: batch?.unit_cost ?? null,
          };
        });

      const 结果 = await 创建领料单(null, 明细, "", "");
      if (!结果.success) {
        alert("领料失败: " + (结果.error || "未知错误"));
        return;
      }

      alert(`领料成功，已生成领料单 ${结果.data?.no}`);
      onSuccess();
      onClose();
    } catch (err: unknown) {
      alert("领料失败: " + (err instanceof Error ? err.message : "未知错误"));
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <dialog open className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">领料出库</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="text-sm text-gray-600">
            配件: <span className="font-medium text-gray-900">{partName}</span>
            <span className="ml-3">需领: <span className="font-medium">{quantityNeeded}</span></span>
          </div>

          {fetching ? (
            <div className="text-sm text-gray-400">加载批次中...</div>
          ) : batches.length === 0 ? (
            <div className="text-sm text-red-500">当前没有可用库存批次</div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs text-gray-500">选择批次（按入库时间先后，先选先进先出）</div>
              {batches.map((batch) => (
                <div key={batch.id} className="flex items-center gap-3 p-3 rounded border border-gray-200 bg-gray-50">
                  <div className="flex-1 text-sm">
                    <div className="font-medium text-gray-800">批次 {batch.batch_no || "-"}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      库存: {batch.remaining} · 采购价: ¥{batch.unit_cost} · 入库: {batch.inbound_at?.slice(0, 10) || "-"}
                    </div>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={batch.remaining}
                    value={selected[batch.id] || 0}
                    onChange={(e) => setBatchQty(batch.id, parseInt(e.target.value) || 0)}
                    className="w-20 px-2 py-1 border border-gray-300 rounded text-sm text-right"
                  />
                </div>
              ))}
            </div>
          )}

          <div className="text-sm text-gray-600">
            已选数量: <span className="font-medium">{totalSelected}</span> / {quantityNeeded}
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading || totalSelected <= 0 || totalSelected > quantityNeeded || batches.length === 0}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "开单中..." : "确认领料"}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}

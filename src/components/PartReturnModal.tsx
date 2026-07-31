"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { 创建退料单, type 退料明细输入 } from "@/app/material-returns/actions";
import { 退料类型选项 as RETURN_TYPES } from "@/lib/returnTypes";

interface PickingRecord {
  id: string;
  quantity: number;
  picking_order_id: string | null;
  part_batches: { id: string; batch_no: string; unit_cost: number } | null;
}

/* 工单配件分支快照（生成退料单明细时冗余保存） */
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
  partName: string;
  workOrderItemPartId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function PartReturnModal({ open, partName, workOrderItemPartId, onClose, onSuccess }: Props) {
  const supabase = createClient();
  const [records, setRecords] = useState<PickingRecord[]>([]);
  const [已退Map, 设已退Map] = useState<Record<string, number>>({});
  const [快照, 设快照] = useState<分支快照 | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [returnType, setReturnType] = useState("excess");
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFetching(true);
    Promise.all([
      supabase
        .from("part_picking_records")
        .select("id, quantity, picking_order_id, part_batches(id, batch_no, unit_cost)")
        .eq("work_order_item_part_id", workOrderItemPartId)
        .order("picked_at", { ascending: true }),
      supabase
        .from("part_return_records")
        .select("picking_record_id, quantity")
        .eq("work_order_item_part_id", workOrderItemPartId),
      supabase
        .from("work_order_item_parts")
        .select("part_number, name, brand, specification, unit, part_id")
        .eq("id", workOrderItemPartId)
        .single(),
    ]).then(([领料结果, 退料结果, 快照结果]) => {
      if (领料结果.error) console.error(领料结果.error);
      setRecords((领料结果.data || []) as unknown as PickingRecord[]);
      /* 统计每条领料记录已退数量，避免超退 */
      const map: Record<string, number> = {};
      for (const r of 退料结果.data || []) {
        if (r.picking_record_id) {
          map[r.picking_record_id] = (map[r.picking_record_id] || 0) + r.quantity;
        }
      }
      设已退Map(map);
      if (快照结果.data) 设快照(快照结果.data as 分支快照);
      setSelectedId("");
      setFetching(false);
    });
  }, [open, workOrderItemPartId, supabase]);

  const selectedRecord = records.find((r) => r.id === selectedId);
  /* 可退数量 = 已领 - 已退 */
  const maxQty = selectedRecord ? selectedRecord.quantity - (已退Map[selectedRecord.id] || 0) : 0;

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !selectedRecord) {
      alert("请选择要退的领料记录");
      return;
    }
    if (quantity <= 0 || quantity > maxQty) {
      alert(`退库数量必须在 1-${maxQty} 之间`);
      return;
    }
    setLoading(true);

    try {
      const 明细: 退料明细输入[] = [
        {
          work_order_item_part_id: workOrderItemPartId,
          picking_record_id: selectedId,
          part_id: 快照?.part_id || null,
          batch_id: selectedRecord.part_batches?.id || null,
          quantity,
          return_type: returnType,
          part_number: 快照?.part_number || null,
          name: 快照?.name || partName,
          brand: 快照?.brand || null,
          specification: 快照?.specification || null,
          unit: 快照?.unit || null,
          batch_no: selectedRecord.part_batches?.batch_no || null,
          unit_cost: selectedRecord.part_batches?.unit_cost ?? null,
        },
      ];

      const 结果 = await 创建退料单(null, selectedRecord.picking_order_id, 明细, returnType, notes, "");
      if (!结果.success) {
        alert("退库失败: " + (结果.error || "未知错误"));
        return;
      }

      alert(`退库成功，已生成退料单 ${结果.data?.no}`);
      onSuccess();
      onClose();
    } catch (err: unknown) {
      alert("退库失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  }

  return (
    <dialog open className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">配件退库</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="text-sm text-gray-600">
            配件: <span className="font-medium text-gray-900">{partName}</span>
          </div>

          {fetching ? (
            <div className="text-sm text-gray-400">加载领料记录中...</div>
          ) : records.length === 0 ? (
            <div className="text-sm text-red-500">该配件尚未领料，无法退库</div>
          ) : (
            <div className="space-y-2">
              <label className="block text-xs text-gray-500">选择领料记录</label>
              <div className="space-y-1.5">
                {records.map((r) => {
                  const 可退 = r.quantity - (已退Map[r.id] || 0);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      disabled={可退 <= 0}
                      onClick={() => {
                        setSelectedId(r.id);
                        setQuantity(可退);
                      }}
                      className={`w-full text-left px-3 py-2 rounded border text-sm transition-colors ${
                        可退 <= 0
                          ? "bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed"
                          : selectedId === r.id
                            ? "bg-blue-50 border-blue-200 text-blue-700"
                            : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100"
                      }`}
                    >
                      批次 {r.part_batches?.batch_no || "-"} · 领了 {r.quantity} · 可退 {可退}
                      {r.part_batches?.unit_cost ? (
                        <span className="text-gray-400 ml-1">· ¥{r.part_batches.unit_cost}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-500 mb-2">退库原因</label>
            <div className="grid grid-cols-2 gap-2">
              {RETURN_TYPES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setReturnType(t.key)}
                  className={`px-3 py-2 rounded border text-sm text-center transition-colors ${
                    returnType === t.key
                      ? "bg-blue-50 border-blue-200 text-blue-700"
                      : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">退库数量</label>
            <input
              type="number"
              min={1}
              max={maxQty}
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
              disabled={!selectedId}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50"
            />
            {selectedId && <p className="text-[10px] text-gray-400 mt-0.5">最多可退 {maxQty}</p>}
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">备注</label>
            <textarea
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="补充说明..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
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
              disabled={loading || !selectedId || quantity <= 0 || quantity > maxQty}
              className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {loading ? "开单中..." : "确认退库"}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}

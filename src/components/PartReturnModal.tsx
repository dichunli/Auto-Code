"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

const RETURN_TYPES = [
  { key: "excess", label: "多领" },
  { key: "wrong_pick", label: "错领" },
  { key: "wrong_ship", label: "发错货" },
  { key: "damaged", label: "损坏" },
];

interface PickingRecord {
  id: string;
  quantity: number;
  part_batches: { batch_no: string; unit_cost: number } | null;
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
  const [selectedId, setSelectedId] = useState<string>("");
  const [returnType, setReturnType] = useState("excess");
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFetching(true);
    supabase
      .from("part_picking_records")
      .select("id, quantity, part_batches(batch_no, unit_cost)")
      .eq("work_order_item_part_id", workOrderItemPartId)
      .order("picked_at", { ascending: true })
      .then(({ data, error }) => {
        if (error) console.error(error);
        setRecords((data || []) as any);
        setSelectedId("");
        setFetching(false);
      });
  }, [open, workOrderItemPartId, supabase]);

  const selectedRecord = records.find((r) => r.id === selectedId);
  const maxQty = selectedRecord ? selectedRecord.quantity : 0;

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) {
      alert("请选择要退的领料记录");
      return;
    }
    if (quantity <= 0 || quantity > maxQty) {
      alert(`退库数量必须在 1-${maxQty} 之间`);
      return;
    }
    setLoading(true);

    try {
      const { error } = await supabase.from("part_return_records").insert({
        work_order_item_part_id: workOrderItemPartId,
        picking_record_id: selectedId,
        return_type: returnType,
        quantity,
        notes: notes || null,
      });
      if (error) throw error;

      onSuccess();
      onClose();
    } catch (err: any) {
      alert("退库失败: " + err.message);
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
                {records.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(r.id);
                      setQuantity(r.quantity);
                    }}
                    className={`w-full text-left px-3 py-2 rounded border text-sm transition-colors ${
                      selectedId === r.id
                        ? "bg-blue-50 border-blue-200 text-blue-700"
                        : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    批次 {r.part_batches?.batch_no || "-"} · 数量 {r.quantity}
                    {r.part_batches?.unit_cost && (
                      <span className="text-gray-400 ml-1">· ¥{r.part_batches.unit_cost}</span>
                    )}
                  </button>
                ))}
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
              {loading ? "保存中..." : "确认退库"}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}

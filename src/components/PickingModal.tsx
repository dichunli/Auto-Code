"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { 创建领料单, type 领料明细输入 } from "@/app/picking-orders/actions";
import PickingScanCheckModal, { type 待核配件 } from "@/components/PickingScanCheckModal";
import { toast } from "@/lib/globalToast";
import { 全局提示 } from "@/components/GlobalDialogs";

interface Batch {
  id: string;
  batch_no: string;
  remaining: number;
  unit_cost: number;
  inbound_at: string;
}

/* 取自仓位选项（2026-09-19 用户拍板：领料扣仓位数量，方便随时盘点） */
interface 仓位选项 {
  warehouse_id: string;
  warehouse_name: string;
  location: string;
  quantity: number;
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

/* 配件出库管控（三级 OR 判定后的最终值 + 扫码比对条码） */
interface 管控信息 {
  需扫码: boolean;
  需确认: boolean;
  barcode: string | null;
  档案编码: string | null;
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
  const [管控, 设管控] = useState<管控信息 | null>(null);
  const [扫码窗开, 设扫码窗开] = useState(false);
  /* 取自仓位（2026-09-19 用户拍板）：该配件有库存的仓位里选，唯一仓位自动带出，必选 */
  const [仓位选项们, 设仓位选项们] = useState<仓位选项[]>([]);
  const [取自仓位, 设取自仓位] = useState("");

  useEffect(() => {
    if (!open || !partId) return;
    setFetching(true);
    /* 并行查可用批次、配件分支快照、配件出库管控（名称+分类三级）、有库存的仓位 */
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
      supabase
        .from("parts")
        .select("barcode, part_number, require_scan_check, require_confirm, category_id, part_names(require_scan_check, require_confirm, category_id)")
        .eq("id", partId)
        .single(),
      supabase
        .from("part_stock_locations")
        .select("warehouse_id, location, quantity, warehouses(name)")
        .eq("part_id", partId)
        .gt("quantity", 0),
    ]).then(async ([批次结果, 快照结果, 管控结果, 仓位结果]) => {
      if (批次结果.error) console.error(批次结果.error);
      setBatches(批次结果.data || []);
      if (快照结果.data) 设快照(快照结果.data as 分支快照);
      /* 取自仓位选项（唯一仓位自动带出） */
      const 仓位们 = ((仓位结果.data || []) as unknown as { warehouse_id: string; location: string | null; quantity: number; warehouses: { name: string } | { name: string }[] | null }[]).map((w) => ({
        warehouse_id: w.warehouse_id,
        warehouse_name: Array.isArray(w.warehouses) ? w.warehouses[0]?.name || "" : w.warehouses?.name || "",
        location: w.location || "",
        quantity: w.quantity,
      }));
      设仓位选项们(仓位们);
      if (仓位们.length === 1) {
        设取自仓位(`${仓位们[0].warehouse_id}|${仓位们[0].location}`);
      }
      /* 三级 OR：配件/名称/分类任一级勾了即生效 */
      interface 管控查询行 {
        barcode: string | null;
        part_number: string | null;
        require_scan_check: boolean | null;
        require_confirm: boolean | null;
        category_id: string | null;
        part_names: { require_scan_check: boolean | null; require_confirm: boolean | null; category_id: string | null } | null;
      }
      const p = 管控结果.data as unknown as 管控查询行 | null;
      if (p) {
        let 分类管控 = { 需扫码: false, 需确认: false };
        const 分类id = p.part_names?.category_id || p.category_id;
        if (分类id) {
          const { data: c } = await supabase
            .from("part_categories")
            .select("require_scan_check, require_confirm")
            .eq("id", 分类id)
            .single();
          if (c) {
            分类管控 = { 需扫码: !!c.require_scan_check, 需确认: !!c.require_confirm };
          }
        }
        设管控({
          需扫码: !!p.require_scan_check || !!p.part_names?.require_scan_check || 分类管控.需扫码,
          需确认: !!p.require_confirm || !!p.part_names?.require_confirm || 分类管控.需确认,
          barcode: p.barcode,
          档案编码: p.part_number,
        });
      } else {
        设管控(null);
      }
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

  /* 提交：需扫码配件先弹扫码核对窗，扫完才开单 */
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (totalSelected <= 0 || totalSelected > quantityNeeded) {
      toast(`领料数量必须在 1-${quantityNeeded} 之间`, "warning");
      return;
    }
    /* 取自仓位必选（2026-09-19 用户拍板：领料同步扣仓位数量） */
    if (!取自仓位) {
      toast("还没选取自仓位", "warning");
      return;
    }
    if (管控?.需扫码) {
      设扫码窗开(true);
      return;
    }
    执行开单(undefined);
  }

  async function 执行开单(扫码记录: Record<string, string> | undefined) {
    setLoading(true);

    try {
      /* 每个选中批次生成一条领料明细（整单同一取自仓位） */
      const [wid, loc] = 取自仓位.split("|");
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
            warehouse_id: wid || null,
            location: loc || null,
          };
        });

      const 结果 = await 创建领料单(null, 明细, "", "", 扫码记录);
      if (!结果.success) {
        toast("领料失败: " + (结果.error || "未知错误"), "error");
        return;
      }

      if (管控?.需确认) {
        await 全局提示(`领料单 ${结果.data?.no} 已生成（待确认）。\n\n该配件需库管确认，库管在领料单详情页点「确认出库」后才真正扣库存。`);
      } else {
        toast(`领料成功，已生成领料单 ${结果.data?.no}`, "success");
      }
      onSuccess();
      onClose();
    } catch (err: unknown) {
      toast("领料失败: " + (err instanceof Error ? err.message : "未知错误"), "error");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  /* 扫码窗清单（单配件） */
  const 扫码清单: 待核配件[] =
    管控?.需扫码 && partId
      ? [{
          part_id: partId,
          名称: partName,
          part_number: 管控.档案编码,
          barcode: 管控.barcode,
          数量: totalSelected,
        }]
      : [];

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
            {管控?.需扫码 && (
              <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded border bg-indigo-50 text-indigo-700 border-indigo-200">
                需扫码
              </span>
            )}
            {管控?.需确认 && (
              <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded border bg-yellow-50 text-yellow-700 border-yellow-200">
                需确认
              </span>
            )}
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

          {/* 取自仓位（2026-09-19 用户拍板：领料同步扣仓位数量，必选） */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              取自仓位 <span className="text-red-500">*</span>
            </label>
            <select
              value={取自仓位}
              onChange={(e) => 设取自仓位(e.target.value)}
              className={`w-full px-3 py-2 text-sm rounded border bg-white focus:outline-none focus:border-blue-400 ${
                !取自仓位 ? "border-red-400 bg-red-50" : "border-gray-300"
              }`}
            >
              <option value="">请选择取自仓位</option>
              {仓位选项们.map((w) => (
                <option key={`${w.warehouse_id}|${w.location}`} value={`${w.warehouse_id}|${w.location}`}>
                  {w.warehouse_name}{w.location ? ` · ${w.location}` : ""}（存 {w.quantity}）
                </option>
              ))}
            </select>
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

      {/* 扫码核对窗：需扫码配件提交前强制核对 */}
      <PickingScanCheckModal
        open={扫码窗开}
        待核清单={扫码清单}
        on完成={(记录) => {
          设扫码窗开(false);
          执行开单(记录);
        }}
        onClose={() => 设扫码窗开(false)}
      />
    </dialog>
  );
}

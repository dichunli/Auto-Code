"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/utils";

interface PartLite {
  id: string;
  itemId: string;
  unit_price: number;
  quantity: number;
  is_selected: boolean;
}

interface ItemLite {
  id: string;
  total_price: number;
}

interface Props {
  items: ItemLite[];
  parts: PartLite[];
  advancePaymentTotal?: number;
}

// 工单详情页底部冻结的费用合计栏
export default function WorkOrderTotalFooter({ items, parts, advancePaymentTotal = 0 }: Props) {
  const [partsState, setPartsState] = useState<PartLite[]>(parts);

  useEffect(() => {
    setPartsState(parts);
  }, [JSON.stringify(parts)]);

  useEffect(() => {
    function handleUpdate(e: Event) {
      const detail = (e as CustomEvent).detail as {
        itemId: string;
        partId: string;
        unit_price?: number;
        quantity?: number;
        is_selected?: boolean;
        siblingResetIds?: string[];
      };
      setPartsState((prev) => {
        let next = prev.map((p) => {
          if (p.id !== detail.partId) return p;
          return {
            ...p,
            unit_price: detail.unit_price !== undefined ? detail.unit_price : p.unit_price,
            quantity: detail.quantity !== undefined ? detail.quantity : p.quantity,
            is_selected: detail.is_selected !== undefined ? detail.is_selected : p.is_selected,
          };
        });
        if (detail.is_selected === true && detail.siblingResetIds && detail.siblingResetIds.length > 0) {
          next = next.map((p) =>
            detail.siblingResetIds!.includes(p.id) ? { ...p, is_selected: false } : p
          );
        }
        return next;
      });
    }
    window.addEventListener("wo-part-update", handleUpdate as EventListener);
    return () => window.removeEventListener("wo-part-update", handleUpdate as EventListener);
  }, []);

  // 工时合计 = 所有项目的 total_price 之和
  const laborTotal = items.reduce((sum, it) => sum + (it.total_price || 0), 0);
  // 配件合计 = 所有被选中分支的 unit_price * quantity 之和
  const partsTotal = partsState.reduce(
    (sum, p) => sum + (p.is_selected ? p.unit_price * p.quantity : 0),
    0
  );
  // 应收合计 = 每个项目小计之和（项目工时费 + 该项目被选中配件费）
  const grandTotal = items.reduce((sum, it) => {
    const itemPartsTotal = partsState
      .filter((p) => p.itemId === it.id && p.is_selected)
      .reduce((s, p) => s + p.unit_price * p.quantity, 0);
    return sum + (it.total_price || 0) + itemPartsTotal;
  }, 0);

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-300 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] z-40">
      <div className="px-6 py-3 flex items-center justify-end gap-8 text-sm">
        <span className="text-gray-500">
          工时合计: <span className="font-medium text-gray-800">{formatCurrency(laborTotal)}</span>
        </span>
        <span className="text-gray-500">
          配件合计: <span className="font-medium text-gray-800">{formatCurrency(partsTotal)}</span>
        </span>
        {advancePaymentTotal > 0 && (
          <span className="text-gray-500">
            已收: <span className="font-medium text-green-600">{formatCurrency(advancePaymentTotal)}</span>
          </span>
        )}
        <span className="text-base font-semibold text-gray-900">
          应收合计: <span className="text-blue-600">{formatCurrency(grandTotal)}</span>
        </span>
        {advancePaymentTotal > 0 && (
          <span className="text-gray-500">
            待收: <span className="font-medium text-red-600">{formatCurrency(grandTotal - advancePaymentTotal)}</span>
          </span>
        )}
      </div>
    </div>
  );
}

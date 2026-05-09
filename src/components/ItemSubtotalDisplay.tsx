"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/utils";

interface PartLite {
  id: string;
  unit_price: number;
  quantity: number;
  is_selected: boolean;
}

interface Props {
  itemId: string;
  itemTotalPrice: number;
  parts: PartLite[];
}

// 监听同项目下分支的字段变更事件，实时刷新小计
export default function ItemSubtotalDisplay({ itemId, itemTotalPrice, parts }: Props) {
  const [partsState, setPartsState] = useState<PartLite[]>(parts);

  // props 变更（router.refresh 后）同步本地状态
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
      if (detail.itemId !== itemId) return;
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
        // 单选：当一个分支被选中时，重置同组其它分支
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
  }, [itemId]);

  const partSubtotal = partsState.reduce(
    (sum, p) => sum + (p.is_selected ? p.unit_price * p.quantity : 0),
    0
  );
  const subtotal = itemTotalPrice + partSubtotal;

  return (
    <div className="flex items-center justify-end gap-6">
      <span className="text-sm text-gray-500">
        项目金额: {formatCurrency(itemTotalPrice)}
      </span>
      <span className="font-medium text-gray-900 text-base">
        小计: {formatCurrency(subtotal)}
      </span>
    </div>
  );
}

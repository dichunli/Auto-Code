"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useState } from "react";

interface Props {
  itemId: string;
  isOutsourced: boolean;
  isCustomerPart: boolean;
  serviceItemId?: string | null;
}

export function ItemFlagsToggle({ itemId, isOutsourced, isCustomerPart, serviceItemId }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [updating, setUpdating] = useState(false);

  async function toggleField(field: string, value: boolean) {
    if (updating) return;
    setUpdating(true);

    const updateData: Record<string, any> = { [field]: value };

    // 自带配件开关时同步更新价格
    if (field === "is_customer_part" && serviceItemId) {
      const { data: si } = await supabase
        .from("service_items")
        .select("default_price, customer_parts_price")
        .eq("id", serviceItemId)
        .single();
      if (si) {
        if (value && si.customer_parts_price != null) {
          updateData.unit_price = si.customer_parts_price;
        } else if (!value && si.default_price != null) {
          updateData.unit_price = si.default_price;
        }
      }
    }

    const { error } = await supabase
      .from("work_order_items")
      .update(updateData)
      .eq("id", itemId);
    setUpdating(false);
    if (error) {
      alert("更新失败: " + error.message);
      return;
    }
    router.refresh();
  }

  return (
    <span className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => toggleField("is_outsourced", !isOutsourced)}
        disabled={updating}
        className={`text-[10px] px-1.5 py-0.5 rounded border cursor-pointer disabled:opacity-50 ${
          isOutsourced
            ? "bg-gray-100 text-gray-600 border-gray-200 font-medium"
            : "bg-white text-gray-400 border-gray-200"
        }`}
      >
        外包
      </button>
      <button
        type="button"
        onClick={() => toggleField("is_customer_part", !isCustomerPart)}
        disabled={updating}
        className={`text-[10px] px-1.5 py-0.5 rounded border cursor-pointer disabled:opacity-50 ${
          isCustomerPart
            ? "bg-yellow-50 text-yellow-700 border-yellow-200 font-medium"
            : "bg-white text-gray-400 border-gray-200"
        }`}
      >
        自带配件
      </button>
    </span>
  );
}

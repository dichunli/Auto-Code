"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useState } from "react";
import { OutsourceModal } from "./OutsourceModal";
import { 切换项目标记 } from "@/app/work-orders/actions";

interface ExistingOrder {
  id: string;
  order_no: string;
  supplier_id: string;
  total_amount: number;
  is_paid: boolean;
  payment_method?: string | null;
  notes?: string | null;
  suppliers?: { name: string } | null;
  outsource_order_items?: Array<{
    id: string;
    work_order_item_id: string;
    service_item_id: string;
    service_name: string;
    amount: number;
  }>;
}

interface ExistingItem {
  id: string;
  service_item_id: string;
  service_name: string;
  amount: number;
}

interface Props {
  itemId: string;
  isOutsourced: boolean;
  isCustomerPart: boolean;
  serviceItemId?: string | null;
  workOrderId?: string;
  itemName?: string;
  existingOrder?: ExistingOrder | null;
  existingItem?: ExistingItem | null;
  /* 只读（保养单未进编辑模式 / 工单已锁定）：仅展示标记状态，不可修改 */
  disabled?: boolean;
}

export function ItemFlagsToggle({
  itemId,
  isOutsourced,
  isCustomerPart,
  serviceItemId,
  workOrderId,
  itemName,
  existingOrder,
  existingItem,
  disabled = false,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [updating, setUpdating] = useState(false);
  const [outsourceModalOpen, setOutsourceModalOpen] = useState(false);

  async function toggleField(field: "is_customer_part", value: boolean) {
    if (updating) return;
    setUpdating(true);

    const updateData: { is_customer_part?: boolean; unit_price?: number | null } = { is_customer_part: value };

    // 自带配件开关时同步更新价格（价格读取仍走客户端只读查询）
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

    /* 写库走 Server Action */
    const result = await 切换项目标记({ itemId, updates: updateData });
    setUpdating(false);
    if (!result.success) {
      alert("更新失败: " + (result.error || "未知错误"));
      return;
    }
    router.refresh();
  }

  function handleOutsourceClick() {
    setOutsourceModalOpen(true);
  }

  return (
    <span className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={handleOutsourceClick}
        disabled={updating || disabled}
        className={`text-[10px] px-1.5 py-0.5 rounded border ${disabled ? "cursor-default" : "cursor-pointer"} disabled:opacity-50 ${
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
        disabled={updating || disabled}
        className={`text-[10px] px-1.5 py-0.5 rounded border ${disabled ? "cursor-default" : "cursor-pointer"} disabled:opacity-50 ${
          isCustomerPart
            ? "bg-yellow-50 text-yellow-700 border-yellow-200 font-medium"
            : "bg-white text-gray-400 border-gray-200"
        }`}
      >
        自带配件
      </button>
      {workOrderId && (
        <OutsourceModal
          open={outsourceModalOpen}
          workOrderId={workOrderId}
          workOrderItemId={itemId}
          currentItemName={itemName || ""}
          serviceItemId={serviceItemId}
          existingOrder={existingOrder}
          existingItem={existingItem}
          onClose={() => setOutsourceModalOpen(false)}
          onSuccess={() => {
            setOutsourceModalOpen(false);
            router.refresh();
          }}
        />
      )}
    </span>
  );
}

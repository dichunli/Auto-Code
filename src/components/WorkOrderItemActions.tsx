"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useState } from "react";
import { EditWorkOrderItemModal } from "./EditWorkOrderItemModal";

interface Props {
  itemId: string;
  itemName: string;
  aliasName?: string | null;
  quantity?: number;
  unitPrice?: number;
  serviceItemId?: string | null;
}

export function WorkOrderItemActions({ itemId, itemName, aliasName, quantity, unitPrice, serviceItemId }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [deleting, setDeleting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  async function handleDelete() {
    if (!confirm("确定删除此维修项目吗？")) return;
    setDeleting(true);
    const { error } = await supabase.from("work_order_items").delete().eq("id", itemId);
    setDeleting(false);
    if (error) {
      alert("删除失败: " + error.message);
      return;
    }
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          className="text-xs text-blue-600 hover:text-blue-700"
        >
          编辑
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
        >
          {deleting ? "删除中..." : "删除"}
        </button>
      </div>
      <EditWorkOrderItemModal
        open={editOpen}
        itemId={itemId}
        currentName={itemName}
        currentAlias={aliasName || null}
        currentQuantity={quantity || 1}
        currentUnitPrice={unitPrice || 0}
        currentServiceItemId={serviceItemId}
        onClose={() => setEditOpen(false)}
      />
    </>
  );
}

"use client";

import { createClient } from "@/lib/supabase/client";
import { useState } from "react";
import { EditWorkOrderItemModal } from "./EditWorkOrderItemModal";
import { useConfirm } from "./ConfirmDialog";

interface Props {
  itemId: string;
  itemName: string;
  aliasName?: string | null;
  quantity?: number;
  unitPrice?: number;
  requireQc?: boolean | null;
  /* 编辑弹窗回显用：关联的维修项目库 id（新项目行会传入） */
  serviceItemId?: string | null;
}

export function WorkOrderItemActions({ itemId, itemName, aliasName, quantity, unitPrice, requireQc }: Props) {
  const supabase = createClient();
  const [deleting, setDeleting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const { 请求确认, 确认弹窗 } = useConfirm();

  async function handleDelete() {
    if (!(await 请求确认("确定删除此维修项目吗？"))) return;
    setDeleting(true);
    const { error } = await supabase.from("work_order_items").delete().eq("id", itemId);
    setDeleting(false);
    if (error) {
      alert("删除失败: " + error.message);
      return;
    }
    /* 局部更新：广播删除事件，项目行（ItemRowWrapper）立即隐藏、
     * 页底合计（WorkOrderTotalFooter）同步移除该项目，不整页刷新 */
    window.dispatchEvent(
      new CustomEvent("wo-item-update", {
        detail: { itemId, deleted: true },
      })
    );
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
        currentRequireQc={requireQc}
        onClose={() => setEditOpen(false)}
      />
      {确认弹窗}
    </>
  );
}

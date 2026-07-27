"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { 标记本地结构编辑 } from "@/lib/localEditSignal";
import { useConfirm } from "./ConfirmDialog";

interface Props {
  partId: string;
  itemId: string;
  canDelete: boolean;
}

export default function WorkOrderItemPartBranchActions({ partId, itemId, canDelete }: Props) {
  const supabase = createClient();
  const [deleting, setDeleting] = useState(false);
  const [adding, setAdding] = useState(false);
  const { 请求确认, 确认弹窗 } = useConfirm();

  async function handleDelete() {
    if (!canDelete) {
      alert("至少需要保留一个配件分支");
      return;
    }
    if (!(await 请求确认("确定删除此配件分支吗？"))) return;
    setDeleting(true);
    const { error } = await supabase.from("work_order_item_parts").delete().eq("id", partId);
    setDeleting(false);
    if (error) {
      alert("删除失败: " + error.message);
      return;
    }
    标记本地结构编辑(itemId);
    /* 局部更新：广播删除事件（合计自动减）+ 重查该项目配件（分支立即消失），不整页刷新 */
    window.dispatchEvent(
      new CustomEvent("wo-part-update", {
        detail: { itemId, partId, deleted: true },
      })
    );
    window.dispatchEvent(
      new CustomEvent("wo-parts-reload", { detail: { itemId } })
    );
  }

  async function handleAdd() {
    setAdding(true);
    // 查询当前分支的 part_name_id、目录ID、数量，用于新分支（同目录、数量整组共用）
    const { data: current } = await supabase
      .from("work_order_item_parts")
      .select("part_name_id, branch_group_id, name, unit, quantity")
      .eq("id", partId)
      .single();

    const { error } = await supabase.from("work_order_item_parts").insert({
      work_order_item_id: itemId,
      part_name_id: current?.part_name_id || null,
      branch_group_id: current?.branch_group_id || null,
      name: current?.name || null,
      unit: current?.unit || "件",
      quantity: current?.quantity ?? null,
      customer_opinion: "pending",
    });

    setAdding(false);
    if (error) {
      alert("添加失败: " + error.message);
      return;
    }
    标记本地结构编辑(itemId);
    /* 局部更新：重查该项目配件（新分支立即出现），不整页刷新。
     * 新分支默认未选中，不计入合计，无需广播合计事件 */
    window.dispatchEvent(
      new CustomEvent("wo-parts-reload", { detail: { itemId } })
    );
  }

  return (
    <div className="flex items-center gap-1 ml-2">
      <button
        type="button"
        onClick={handleAdd}
        disabled={adding}
        className="text-[10px] text-blue-600 hover:text-blue-700 disabled:opacity-50 px-1"
        title="添加同配件新分支"
      >
        {adding ? "..." : "+"}
      </button>
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting || !canDelete}
        className={`text-[10px] px-1 disabled:opacity-50 ${
          canDelete ? "text-red-600 hover:text-red-700" : "text-gray-300 cursor-not-allowed"
        }`}
        title={canDelete ? "删除此分支" : "至少保留一个分支"}
      >
        {deleting ? "..." : "删除"}
      </button>
      {确认弹窗}
    </div>
  );
}

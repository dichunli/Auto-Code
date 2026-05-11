"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Props {
  partId: string;
  itemId: string;
  canDelete: boolean;
}

export default function WorkOrderItemPartBranchActions({ partId, itemId, canDelete }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [deleting, setDeleting] = useState(false);
  const [adding, setAdding] = useState(false);

  async function handleDelete() {
    if (!canDelete) {
      alert("至少需要保留一个配件分支");
      return;
    }
    if (!confirm("确定删除此配件分支吗？")) return;
    setDeleting(true);
    const { error } = await supabase.from("work_order_item_parts").delete().eq("id", partId);
    setDeleting(false);
    if (error) {
      alert("删除失败: " + error.message);
      return;
    }
    router.refresh();
  }

  async function handleAdd() {
    setAdding(true);
    // 查询当前分支的 part_name_id，用于新分支
    const { data: current } = await supabase
      .from("work_order_item_parts")
      .select("part_name_id, name, unit")
      .eq("id", partId)
      .single();

    const { error } = await supabase.from("work_order_item_parts").insert({
      work_order_item_id: itemId,
      part_name_id: current?.part_name_id || null,
      name: current?.name || null,
      unit: current?.unit || "件",
      quantity: 1,
      customer_opinion: "pending",
    });

    setAdding(false);
    if (error) {
      alert("添加失败: " + error.message);
      return;
    }
    router.refresh();
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
    </div>
  );
}

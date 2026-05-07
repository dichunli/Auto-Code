"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useState } from "react";

interface Props {
  itemId: string;
}

export function WorkOrderItemActions({ itemId }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [deleting, setDeleting] = useState(false);

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
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => alert("编辑功能开发中")}
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
  );
}

"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useConfirm } from "@/components/ConfirmDialog";

export function DeleteButton({ id }: { id: string }) {
  const [deleting, setDeleting] = useState(false);
  const { 请求确认, 确认弹窗 } = useConfirm();

  async function handleDelete() {
    if (!(await 请求确认("确定删除这条记录？"))) return;
    setDeleting(true);
    const supabase = createClient();
    const { error } = await supabase.from("other_transactions").delete().eq("id", id);
    setDeleting(false);
    if (error) {
      alert("删除失败：" + error.message);
      return;
    }
    window.location.reload();
  }

  return (
    <>
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        className="text-xs text-red-600 hover:underline disabled:opacity-50"
      >
        {deleting ? "删除中..." : "删除"}
      </button>
      {确认弹窗}
    </>
  );
}

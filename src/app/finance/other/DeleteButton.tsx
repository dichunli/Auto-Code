"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ConfirmDialog";
import { 删除其它收支 } from "./actions";
import { toast } from "@/lib/globalToast";

export function DeleteButton({ id }: { id: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const { 请求确认, 确认弹窗 } = useConfirm();

  async function handleDelete() {
    if (!(await 请求确认("确定删除这条记录？"))) return;
    setDeleting(true);
    const result = await 删除其它收支(id);
    setDeleting(false);
    if (!result.success) {
      toast(result.error || "删除失败", "error");
      return;
    }
    router.refresh();
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

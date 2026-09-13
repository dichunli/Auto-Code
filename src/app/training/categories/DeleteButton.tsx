"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ConfirmDialog";
import { 删除培训分类 } from "@/app/training/actions";
import { toast } from "@/lib/globalToast";

export default function DeleteButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const { 请求确认, 确认弹窗 } = useConfirm();

  async function handleDelete() {
    if (!(await 请求确认(`确定要删除分类「${name}」吗？`))) return;
    setDeleting(true);
    const result = await 删除培训分类(id);
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
        className="text-xs text-red-600 hover:text-red-800 hover:underline disabled:opacity-50"
      >
        {deleting ? "删除中..." : "删除"}
      </button>
      {确认弹窗}
    </>
  );
}

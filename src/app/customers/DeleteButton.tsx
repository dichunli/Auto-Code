"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ConfirmDialog";
import { 删除客户 } from "./actions";

interface Props {
  id: string;
}

export function DeleteButton({ id }: Props) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const { 请求确认, 确认弹窗 } = useConfirm();

  async function handleDelete() {
    if (!(await 请求确认("确定要删除该客户吗？删除前会检查关联数据。"))) return;
    setDeleting(true);
    const result = await 删除客户(id);
    setDeleting(false);
    if (!result.success) {
      alert(result.error || "删除失败");
      return;
    }
    router.refresh();
  }

  return (
    <>
      <button
        onClick={handleDelete}
        disabled={deleting}
        className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
      >
        {deleting ? "删除中..." : "删除"}
      </button>
      {确认弹窗}
    </>
  );
}

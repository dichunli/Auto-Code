"use client";

import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ConfirmDialog";
import { 删除配件名称 } from "./actions";

export function DeleteButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const { 请求确认, 确认弹窗 } = useConfirm();

  async function handleDelete() {
    if (!(await 请求确认(`确定要删除配件名称「${name}」吗？`))) return;
    const result = await 删除配件名称(id);
    if (!result.success) {
      alert("删除失败: " + (result.error || "未知错误"));
      return;
    }
    router.refresh();
  }

  return (
    <>
      <button
        onClick={handleDelete}
        className="text-sm text-red-600 hover:text-red-700 font-medium"
      >
        删除
      </button>
      {确认弹窗}
    </>
  );
}

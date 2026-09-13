"use client";

import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ConfirmDialog";
import { 删除维修项目名称 } from "./actions";
import { toast } from "@/lib/globalToast";

export function DeleteButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const { 请求确认, 确认弹窗 } = useConfirm();

  async function handleDelete() {
    if (!(await 请求确认(`确定要删除项目名称「${name}」吗？`))) return;
    const result = await 删除维修项目名称(id);
    if (!result.success) {
      toast("删除失败: " + (result.error || "未知错误"), "error");
      return;
    }
    router.refresh();
  }

  return (
    <>
      <button onClick={handleDelete} className="text-xs text-red-600 hover:text-red-700">
        删除
      </button>
      {确认弹窗}
    </>
  );
}

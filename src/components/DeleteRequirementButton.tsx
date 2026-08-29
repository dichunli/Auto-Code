"use client";

import { useRouter } from "next/navigation";
import { 删除需求 } from "@/app/work-orders/actions";
import { useConfirm } from "./ConfirmDialog";

interface Props {
  requirementId: string;
  className?: string;
}

export default function DeleteRequirementButton({ requirementId, className = "" }: Props) {
  const router = useRouter();
  const { 请求确认, 确认弹窗 } = useConfirm();

  async function handleDelete() {
    if (!(await 请求确认("确定要删除这条需求吗？关联的媒体文件也会被删除。"))) return;

    /* 写库走 Server Action：服务端先查是否挂有维修项目，有则拒绝删除 */
    const result = await 删除需求(requirementId);

    if (!result.success) {
      alert("删除失败: " + (result.error || "未知错误"));
    } else {
      router.refresh();
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleDelete}
        className={`text-xs text-red-500 hover:text-red-600 ${className}`}
      >
        删除
      </button>
      {确认弹窗}
    </>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useConfirm } from "./ConfirmDialog";

interface Props {
  requirementId: string;
  className?: string;
}

export default function DeleteRequirementButton({ requirementId, className = "" }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const { 请求确认, 确认弹窗 } = useConfirm();

  async function handleDelete() {
    if (!(await 请求确认("确定要删除这条需求吗？关联的媒体文件也会被删除。"))) return;

    const { error } = await supabase
      .from("work_order_requirements")
      .delete()
      .eq("id", requirementId);

    if (error) {
      alert("删除失败: " + error.message);
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

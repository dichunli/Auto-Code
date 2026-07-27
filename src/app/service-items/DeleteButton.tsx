"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useConfirm } from "@/components/ConfirmDialog";

export function DeleteButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const supabase = createClient();
  const { 请求确认, 确认弹窗 } = useConfirm();

  async function handleDelete() {
    if (!(await 请求确认(`确定要删除维修项目「${name}」吗？`))) return;
    const { error } = await supabase.from("service_items").delete().eq("id", id);
    if (error) {
      alert("删除失败: " + error.message);
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

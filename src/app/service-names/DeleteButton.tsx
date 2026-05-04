"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function DeleteButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const supabase = createClient();

  async function handleDelete() {
    if (!confirm(`确定要删除项目名称「${name}」吗？`)) return;
    const { error } = await supabase.from("service_names").delete().eq("id", id);
    if (error) {
      alert("删除失败: " + error.message);
      return;
    }
    router.refresh();
  }

  return (
    <button onClick={handleDelete} className="text-xs text-red-600 hover:text-red-700">
      删除
    </button>
  );
}

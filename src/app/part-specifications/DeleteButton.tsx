"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function DeleteButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const supabase = createClient();

  async function handleDelete() {
    if (!confirm(`确定要删除规格「${name}」吗？`)) return;

    const [{ count: linkCount }, { count: partCount }] = await Promise.all([
      supabase.from("part_name_specifications").select("id", { count: "exact", head: true }).eq("specification_id", id),
      supabase.from("parts").select("id", { count: "exact", head: true }).eq("specification_id", id),
    ]);

    if ((linkCount ?? 0) > 0 || (partCount ?? 0) > 0) {
      alert("该规格已被使用（存在关联配件名称或库存配件），不允许删除");
      return;
    }

    const { error } = await supabase.from("part_specifications").delete().eq("id", id);
    if (error) {
      alert("删除失败: " + error.message);
      return;
    }
    router.refresh();
  }

  return (
    <button
      onClick={handleDelete}
      className="text-sm text-red-600 hover:text-red-700 font-medium"
    >
      删除
    </button>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function DeleteButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const supabase = createClient();

  async function handleDelete() {
    if (!confirm(`确定要删除配件名称「${name}」吗？`)) return;

    const checks = await Promise.all([
      supabase.from("parts").select("id", { count: "exact", head: true }).eq("part_name_id", id),
      supabase.from("part_name_brands").select("id", { count: "exact", head: true }).eq("part_name_id", id),
      supabase.from("work_order_parts").select("id", { count: "exact", head: true }).eq("part_name_id", id),
      supabase.from("company_part_prices").select("id", { count: "exact", head: true }).eq("part_name_id", id),
      supabase.from("purchase_order_items").select("id", { count: "exact", head: true }).eq("part_name_id", id),
    ]);

    const used = checks.some((c) => (c.count ?? 0) > 0);
    if (used) {
      alert("该配件名称已被使用（存在库存、工单、采购等关联），不允许删除，但可以进行合并");
      return;
    }

    const { error } = await supabase.from("part_names").delete().eq("id", id);
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

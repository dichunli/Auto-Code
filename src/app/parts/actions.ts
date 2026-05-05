"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function deletePart(partId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const checks = await Promise.all([
    supabase.from("work_order_item_parts").select("id", { count: "exact", head: true }).eq("part_id", partId),
    supabase.from("purchase_order_items").select("id", { count: "exact", head: true }).eq("part_id", partId),
    supabase.from("inventory_logs").select("id", { count: "exact", head: true }).eq("part_id", partId),
    supabase.from("inventory_check_items").select("id", { count: "exact", head: true }).eq("part_id", partId),
    supabase.from("purchase_returns").select("id", { count: "exact", head: true }).eq("part_id", partId),
  ]);

  const hasBusinessData = checks.some((c) => (c.count || 0) > 0);
  if (hasBusinessData) {
    return { success: false, error: "该配件已有业务数据（工单、采购单、库存记录等），无法删除" };
  }

  const { error } = await supabase.from("parts").delete().eq("id", partId);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/inventory");
  return { success: true };
}

import { createClient } from "@/lib/supabase/server";
import SupplierReturnsContent from "./SupplierReturnsContent";

/* 首屏只取第 1 页（20 条）+ 总数，防止退货记录增长后全量拉取拖慢页面 */
export default async function SupplierReturnsPage() {
  const supabase = await createClient();
  const { data, count } = await supabase
    .from("supplier_return_records")
    .select("*, work_order_item_parts(name, part_number), profiles(full_name), purchase_return_orders(id, return_no)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(0, 19);
  return <SupplierReturnsContent initialRecords={(data || [])} initialCount={count || 0} />;
}

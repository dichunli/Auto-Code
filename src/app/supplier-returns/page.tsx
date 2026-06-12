import { createClient } from "@/lib/supabase/server";
import SupplierReturnsContent from "./SupplierReturnsContent";

export default async function SupplierReturnsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("supplier_return_records")
    .select("*, work_order_item_parts(name, part_number), profiles(full_name), purchase_return_orders(id, return_no)")
    .order("created_at", { ascending: false });
  return <SupplierReturnsContent initialRecords={(data || [])} />;
}

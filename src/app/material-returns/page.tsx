import { createClient } from "@/lib/supabase/server";
import MaterialReturnsContent from "./MaterialReturnsContent";

export interface 退料单 {
  id: string;
  return_no: string;
  status: string;
  total_quantity: number;
  return_type: string | null;
  reason: string | null;
  notes: string | null;
  created_at: string;
  work_orders: { id: string; order_no: string } | null;
  picking_orders: { id: string; picking_no: string } | null;
  profiles: { full_name: string | null } | null;
}

export default async function MaterialReturnsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("material_return_orders")
    .select(
      "id, return_no, status, total_quantity, return_type, reason, notes, created_at, work_orders(id, order_no), picking_orders(id, picking_no), profiles(full_name)"
    )
    .order("created_at", { ascending: false });

  return <MaterialReturnsContent initialRecords={(data as unknown as 退料单[]) || []} />;
}

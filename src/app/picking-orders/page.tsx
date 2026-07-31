import { createClient } from "@/lib/supabase/server";
import PickingOrdersContent from "./PickingOrdersContent";

export interface 领料单 {
  id: string;
  picking_no: string;
  status: string;
  total_quantity: number;
  receiver_name: string | null;
  notes: string | null;
  created_at: string;
  work_orders: { id: string; order_no: string } | null;
  profiles: { full_name: string | null } | null;
}

export default async function PickingOrdersPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("picking_orders")
    .select(
      "id, picking_no, status, total_quantity, receiver_name, notes, created_at, work_orders(id, order_no), profiles(full_name)"
    )
    .order("created_at", { ascending: false });

  return <PickingOrdersContent initialRecords={(data as unknown as 领料单[]) || []} />;
}

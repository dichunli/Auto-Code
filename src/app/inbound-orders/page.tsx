import { createClient } from "@/lib/supabase/server";
import InboundOrdersContent from "./InboundOrdersContent";

interface InboundOrder {
  id: string;
  inbound_no: string;
  supplier_name: string | null;
  total_quantity: number;
  total_amount: number | null;
  freight_amount: number | null;
  status: string;
  notes: string | null;
  created_at: string;
  purchase_orders: { order_no: string | null } | null;
}

export default async function InboundOrdersPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("inbound_orders")
    .select(
      "id, inbound_no, supplier_name, total_quantity, total_amount, freight_amount, status, notes, created_at, purchase_orders(order_no)"
    )
    .order("created_at", { ascending: false });

  return <InboundOrdersContent initialRecords={(data as unknown as InboundOrder[]) || []} />;
}

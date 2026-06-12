import { createClient } from "@/lib/supabase/server";
import ReturnOrdersContent from "./ReturnOrdersContent";

interface ReturnOrder {
  id: string;
  return_no: string;
  supplier_name: string | null;
  total_quantity: number;
  status: string;
  logistics_company: string | null;
  tracking_no: string | null;
  return_shipping_fee: number | null;
  shipping_fee_payer: string | null;
  notes: string | null;
  created_at: string;
}

export default async function ReturnOrdersPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_return_orders")
    .select(
      "id, return_no, supplier_name, total_quantity, status, logistics_company, tracking_no, return_shipping_fee, shipping_fee_payer, notes, created_at"
    )
    .order("created_at", { ascending: false });

  return <ReturnOrdersContent initialRecords={(data as ReturnOrder[]) || []} />;
}

import { createClient } from "@/lib/supabase/server";
import OutsourceOrdersContent from "./OutsourceOrdersContent";

interface OutsourceOrderItem {
  id: string;
  service_name: string;
  amount: number;
}

interface OutsourceOrder {
  id: string;
  order_no: string;
  work_order_id: string;
  supplier_id: string;
  total_amount: number;
  is_paid: boolean;
  payment_method: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  work_orders: { order_no: string } | null;
  suppliers: { name: string } | null;
  outsource_order_items: OutsourceOrderItem[] | null;
}

export default async function OutsourceOrdersPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("outsource_orders")
    .select(
      "*, work_orders(order_no), suppliers(name), outsource_order_items(id, service_name, amount)"
    )
    .order("created_at", { ascending: false });

  return <OutsourceOrdersContent initialOrders={(data as OutsourceOrder[]) || []} />;
}

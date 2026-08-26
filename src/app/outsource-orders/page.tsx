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

/* 首屏只取第 1 页（20 条）+ 总数，防止外包单增长后全量拉取拖慢页面 */
export default async function OutsourceOrdersPage() {
  const supabase = await createClient();
  const { data, count } = await supabase
    .from("outsource_orders")
    .select(
      "*, work_orders(order_no), suppliers(name), outsource_order_items(id, service_name, amount)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(0, 19);

  return <OutsourceOrdersContent initialOrders={(data as OutsourceOrder[]) || []} initialCount={count || 0} />;
}

import { createClient } from "@/lib/supabase/server";
import OrdersContent from "./OrdersContent";

/* 首屏只取第一页（20 条）+ 总数，防止采购订单增长后全量拉取拖慢页面 */
export default async function ProcurementOrdersPage() {
  const supabase = await createClient();
  const { data: orders, count } = await supabase
    .from("purchase_orders")
    .select("*, suppliers(name), purchase_order_items(count)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(0, 19);

  return <OrdersContent initialOrders={orders || []} initialCount={count || 0} />;
}

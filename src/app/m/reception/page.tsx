import { createClient } from "@/lib/supabase/server";
import MobileReceptionContent, { type Order } from "./MobileReceptionContent";

/* 手机端接车登记 — Server Component
 * 首屏在厂工单列表在服务端查询，避免 SPA 软导航时客户端 session 未就绪导致空白 */

export default async function MobileReceptionListPage() {
  const supabase = await createClient();

  let orders: Order[] = [];
  let error: string | null = null;

  try {
    const { data, error: queryError } = await supabase
      .from("work_orders")
      .select(
        "id, order_no, status, received_at, mileage_in, vehicles(plate_number, brand, model), customers(name, phone)"
      )
      .neq("order_type", "cancelled")
      /* 已结算/已交车过滤下推到 SQL——不再把全部历史工单拉回手机内存过滤 */
      .not("status", "in", '("settled","delivered")')
      .order("created_at", { ascending: false })
      /* 在厂工单上限 100 条（正常同时在厂远低于此），防历史积压单拖慢手机首页 */
      .limit(100);
    if (queryError) {
      error = "查询失败：" + queryError.message;
    } else {
      orders = (data || []) as unknown as Order[];
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    error = "加载失败：" + msg;
  }

  return <MobileReceptionContent initialOrders={orders} initialError={error} />;
}

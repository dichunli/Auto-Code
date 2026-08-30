import { createClient } from "@/lib/supabase/server";
import MobileReceptionContent, { type Order } from "./MobileReceptionContent";

/* 手机端接车登记 — Server Component
 * 首屏在厂工单列表在服务端查询，避免 SPA 软导航时客户端 session 未就绪导致空白 */

const SETTLED_STATUSES = ["settled", "delivered"];

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
      .order("created_at", { ascending: false });
    if (queryError) {
      error = "查询失败：" + queryError.message;
    } else {
      /* 内存过滤：排除已结算、已交车 */
      orders = ((data || []) as unknown as (Record<string, unknown> & Order)[]).filter(
        (o) => !SETTLED_STATUSES.includes(o.status as string)
      );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    error = "加载失败：" + msg;
  }

  return <MobileReceptionContent initialOrders={orders} initialError={error} />;
}

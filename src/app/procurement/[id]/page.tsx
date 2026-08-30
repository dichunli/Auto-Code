import { createClient } from "@/lib/supabase/server";
import PurchaseOrderDetailContent, {
  type PurchaseOrder,
  type PurchaseOrderItem,
} from "./PurchaseOrderDetailContent";

/* 采购订单详情 — Server Component
 * 首屏数据（订单 + 明细）在服务端查询，避免 SPA 软导航时客户端 session 未就绪导致空白；
 * 收货/撤销/作废后客户端仍自行刷新 */

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: orderData } = await supabase
    .from("purchase_orders")
    .select("*, suppliers(*)")
    .eq("id", id)
    .single();

  const { data: itemsData } = await supabase
    .from("purchase_order_items")
    .select("*, parts(id, quantity), work_order_item_parts(id, is_arrived)")
    .eq("order_id", id)
    .order("created_at", { ascending: true });

  return (
    <PurchaseOrderDetailContent
      orderId={id}
      initialOrder={(orderData as unknown as PurchaseOrder | null) ?? null}
      initialItems={(itemsData || []) as unknown as PurchaseOrderItem[]}
    />
  );
}

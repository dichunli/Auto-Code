import { createClient } from "@/lib/supabase/server";
import ProcurementReportContent, {
  type InboundOrder,
  type ReturnOrder,
  type InboundItem,
} from "./ProcurementReportContent";

/* 采购分析报表 — Server Component
 * 首屏数据（无日期筛选的全量查询）在服务端完成，避免 SPA 软导航时客户端 session 未就绪导致空白；
 * 选择日期范围点「查询」后客户端仍自行加载 */

export default async function ProcurementReportPage() {
  const supabase = await createClient();

  /* 与客户端 loadData 无日期筛选时完全一致的三路查询 */
  const [{ data: inboundData }, { data: returnData }, { data: itemData }] = await Promise.all([
    supabase
      .from("inbound_orders")
      .select("id, supplier_name, total_amount, total_quantity, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("purchase_return_orders")
      .select("id, supplier_name, total_quantity, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("inbound_order_items")
      .select("name, part_number, quantity, unit_cost, inbound_orders!inner(created_at)")
      .order("created_at", { ascending: false }),
  ]);

  return (
    <ProcurementReportContent
      initialInboundOrders={(inboundData || []) as unknown as InboundOrder[]}
      initialReturnOrders={(returnData || []) as unknown as ReturnOrder[]}
      initialInboundItems={(itemData || []) as unknown as InboundItem[]}
    />
  );
}

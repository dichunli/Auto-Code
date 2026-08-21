import { createClient } from "@/lib/supabase/server";
import { MobilePageHeader } from "@/components/mobile/MobilePageHeader";
import { MobileReceivingOrders, 待收订单, 待签收运单 } from "@/components/mobile/MobileReceivingOrders";

/* 2026-08-21 手机端待收货管理页（老流程采购单，首屏服务端查询） */

export default async function MobileReceivingOrdersPage() {
  const supabase = await createClient();

  const [{ data: orders }, { data: waybills }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select(`
        id, order_no, status, created_at, waybill_id,
        suppliers(name, region),
        logistics_waybills:waybill_id(id, tracking_no, logistics_company_name, logistics_companies(name)),
        purchase_order_items(
          id, name, brand, specification, quantity, unit, notes, photos,
          part_number, supplier_part_name, handle_action
        )
      `)
      .in("status", ["submitted", "approved", "partial_received"])
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("logistics_waybills")
      .select("id, tracking_no, supplier_name, logistics_company_name, logistics_companies(name)")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  return (
    <div className="flex flex-col min-h-full">
      <MobilePageHeader title="待收货管理" />
      <div className="flex-1 p-3">
        <MobileReceivingOrders
          订单列表={((orders || []) as unknown) as 待收订单[]}
          待签收运单={((waybills || []) as unknown) as 待签收运单[]}
        />
      </div>
    </div>
  );
}

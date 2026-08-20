import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { MobilePageHeader } from "@/components/mobile/MobilePageHeader";
import { ArrivalWorkbench, 到货单, 到货明细 } from "@/components/arrival/ArrivalWorkbench";

/* 2026-08-20 待收货改造二期：手机端到货验货工作台（首屏服务端查询） */

interface 明细行 {
  id: string;
  purchase_order_item_id: string | null;
  part_name_snapshot: string;
  expected_qty: number;
  received_qty: number | null;
  handling: string | null;
  warehouse_id: string | null;
  location: string | null;
  photos: string[] | null;
  purchase_order_items: { order_id: string } | null;
}

export default async function MobileArrivalWorkbenchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: 单 }, { data: 明细 }, { data: 仓库 }] = await Promise.all([
    supabase
      .from("arrival_receipts")
      .select("id, receipt_no, status, supplier_order_no, photos, suppliers(name), logistics_waybills(tracking_no)")
      .eq("id", id)
      .single(),
    supabase
      .from("arrival_receipt_items")
      .select("id, purchase_order_item_id, part_name_snapshot, expected_qty, received_qty, handling, warehouse_id, location, photos, purchase_order_items(order_id)")
      .eq("arrival_id", id)
      .order("created_at", { ascending: true }),
    supabase.from("warehouses").select("id, name").order("name"),
  ]);

  if (!单) notFound();

  const 明细列表: 到货明细[] = (((明细 || []) as unknown) as 明细行[]).map((行) => ({
    id: 行.id,
    purchase_order_item_id: 行.purchase_order_item_id,
    order_id: 行.purchase_order_items?.order_id || null,
    part_name_snapshot: 行.part_name_snapshot,
    expected_qty: 行.expected_qty,
    received_qty: 行.received_qty,
    handling: 行.handling,
    warehouse_id: 行.warehouse_id,
    location: 行.location,
    photos: 行.photos,
  }));

  return (
    <div className="flex flex-col min-h-full">
      <MobilePageHeader title="到货验货" />
      <div className="flex-1 p-3">
        <ArrivalWorkbench
          到货单={(单 as unknown) as 到货单}
          明细列表={明细列表}
          仓库列表={(仓库 || []) as { id: string; name: string }[]}
          待入库链接="/procurement?tab=pending_storage"
        />
      </div>
    </div>
  );
}

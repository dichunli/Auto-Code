import { createClient } from "@/lib/supabase/server";
import ArrivalsContent, { type 到货单 } from "./ArrivalsContent";

/* 2026-08-20 待收货改造二期：电脑端到货确认单列表（首屏服务端取第 1 页 + 总数） */
export default async function ArrivalListPage() {
  const supabase = await createClient();
  const { data, count } = await supabase
    .from("arrival_receipts")
    .select("id, receipt_no, status, created_at, suppliers(name), logistics_waybills(tracking_no), arrival_receipt_items(count)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(0, 19);

  return <ArrivalsContent initialList={((data || []) as unknown as 到货单[])} initialCount={count || 0} />;
}

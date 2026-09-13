import { createClient } from "@/lib/supabase/server";
import InboundOrdersContent from "./InboundOrdersContent";

interface InboundOrder {
  id: string;
  inbound_no: string;
  supplier_name: string | null;
  total_quantity: number;
  total_amount: number | null;
  freight_amount: number | null;
  status: string;
  notes: string | null;
  created_at: string;
  purchase_orders: { order_no: string | null } | null;
}

/* 列表页用的明细行（2026-09-13 商品搜索+发起退货）：
   只取筛选/退货需要的轻量字段，车牌联采购明细、条码联配件档案 */
export interface 列表明细行 {
  id: string;
  inbound_order_id: string;
  part_id: string | null;
  name: string | null;
  part_number: string | null;
  quantity: number;
  purchase_order_items: { license_plate: string | null } | null;
  parts: { barcode: string | null } | null;
}

export default async function InboundOrdersPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("inbound_orders")
    .select(
      "id, inbound_no, supplier_name, total_quantity, total_amount, freight_amount, status, notes, created_at, purchase_orders(order_no)"
    )
    .order("created_at", { ascending: false });

  /* 明细行全量取回前端做商品筛选（汽修厂量级几千行内，可接受）；
     postgrest 多对一联表返回对象，个别情况返回数组，前端统一兼容 */
  const { data: 明细 } = await supabase
    .from("inbound_order_items")
    .select("id, inbound_order_id, part_id, name, part_number, quantity, purchase_order_items(license_plate), parts(barcode)");

  type 原始行 = Omit<列表明细行, "purchase_order_items" | "parts"> & {
    purchase_order_items: 列表明细行["purchase_order_items"] | NonNullable<列表明细行["purchase_order_items"]>[] | null;
    parts: 列表明细行["parts"] | NonNullable<列表明细行["parts"]>[] | null;
  };
  const 明细行们: 列表明细行[] = ((明细 || []) as unknown as 原始行[]).map((行) => ({
    ...行,
    purchase_order_items: Array.isArray(行.purchase_order_items)
      ? 行.purchase_order_items[0] ?? null
      : 行.purchase_order_items ?? null,
    parts: Array.isArray(行.parts) ? 行.parts[0] ?? null : 行.parts ?? null,
  }));

  return (
    <InboundOrdersContent
      initialRecords={(data as unknown as InboundOrder[]) || []}
      initialItems={明细行们}
    />
  );
}

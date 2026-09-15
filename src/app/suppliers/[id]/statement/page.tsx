import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import StatementContent from "./StatementContent";

/* 供应商对账单（2026-09-15 批次2）
 * 服务端首屏：取该供应商截至期末的全部往来流水，期初/本期/期末在前端算
 * ?month=2026-09 指定对账月份，默认当月 */

interface 流水行 {
  id: string;
  transaction_type: string;
  amount: number;
  description: string | null;
  reference_type: string | null;
  reference_id: string | null;
  payment_method: string | null;
  created_at: string;
  profiles: { full_name: string } | null;
  /* 服务端补充的单据号 */
  docNo: string | null;
  docHref: string | null;
}

export default async function SupplierStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { id } = await params;
  const 参数 = await searchParams;
  /* 月份格式 YYYY-MM，非法就回退当月 */
  const 当月 = new Date().toISOString().slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(参数.month || "") ? 参数.month! : 当月;

  /* 期间：[月首, 次月首) —— 用年月字符串直接拼，避免时区坑（流水时间戳都是北京时间） */
  const [年, 月] = month.split("-").map(Number);
  const 起 = new Date(Date.UTC(年, 月 - 1, 1) - 8 * 3600 * 1000); /* 北京时间月首 = UTC 上月末 16:00 */
  const 止 = new Date(Date.UTC(年, 月, 1) - 8 * 3600 * 1000);

  const supabase = await createClient();

  const { data: supplier } = await supabase
    .from("suppliers")
    .select("id, name, contact, phone, settle_type, credit_days, payee_name, bank_name, bank_account, payment_note")
    .eq("id", id)
    .single();
  if (!supplier) notFound();

  /* 截至期末的全部流水（期初余额需要全部历史），按时间正序 */
  const { data: transactions } = await supabase
    .from("supplier_transactions")
    .select("*, profiles(full_name)")
    .eq("supplier_id", id)
    .lt("created_at", 止.toISOString())
    .order("created_at", { ascending: true });

  const 流水 = (transactions || []) as 流水行[];

  /* 补充单据号：入库单 / 采退单 / 付款单 */
  const 入库ids = 流水.filter((t) => t.reference_type === "inbound_order" && t.reference_id).map((t) => t.reference_id as string);
  const 采退ids = 流水.filter((t) => t.reference_type === "purchase_return_order" && t.reference_id).map((t) => t.reference_id as string);
  const 付款ids = 流水.filter((t) => t.reference_type === "supplier_payment" && t.reference_id).map((t) => t.reference_id as string);

  const [入库单们, 采退单们, 付款单们] = await Promise.all([
    入库ids.length > 0
      ? supabase.from("inbound_orders").select("id, inbound_no, supplier_order_no").in("id", 入库ids)
      : Promise.resolve({ data: [] as { id: string; inbound_no: string; supplier_order_no: string | null }[] }),
    采退ids.length > 0
      ? supabase.from("purchase_return_orders").select("id, return_no").in("id", 采退ids)
      : Promise.resolve({ data: [] as { id: string; return_no: string }[] }),
    付款ids.length > 0
      ? supabase.from("supplier_payments").select("id, payment_no").in("id", 付款ids)
      : Promise.resolve({ data: [] as { id: string; payment_no: string }[] }),
  ]);

  const 入库Map = new Map(((入库单们.data || []) as { id: string; inbound_no: string; supplier_order_no: string | null }[]).map((o) => [o.id, o]));
  const 采退Map = new Map(((采退单们.data || []) as { id: string; return_no: string }[]).map((o) => [o.id, o.return_no]));
  const 付款Map = new Map(((付款单们.data || []) as { id: string; payment_no: string }[]).map((o) => [o.id, o.payment_no]));

  const 行们: 流水行[] = 流水.map((t) => {
    let docNo: string | null = null;
    let docHref: string | null = null;
    if (t.reference_type === "inbound_order" && t.reference_id) {
      const o = 入库Map.get(t.reference_id);
      docNo = o ? o.inbound_no + (o.supplier_order_no ? `（销售单 ${o.supplier_order_no}）` : "") : null;
      docHref = `/inbound-orders/${t.reference_id}`;
    } else if (t.reference_type === "purchase_return_order" && t.reference_id) {
      docNo = 采退Map.get(t.reference_id) || null;
      docHref = `/return-orders/${t.reference_id}`;
    } else if (t.reference_type === "supplier_payment" && t.reference_id) {
      docNo = 付款Map.get(t.reference_id) || null;
      docHref = "/supplier-payments";
    }
    return { ...t, docNo, docHref };
  });

  return (
    <StatementContent
      supplier={supplier}
      rows={行们}
      month={month}
      期初起点={起.toISOString()}
      期末止点={止.toISOString()}
    />
  );
}

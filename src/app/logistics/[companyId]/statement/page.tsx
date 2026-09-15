import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import LogisticsStatementContent from "./StatementContent";

/* 物流公司对账单（2026-09-15 批次4）
 * 按"运单签收日"落在所选月份内取数：运费/代收/是否已结/结算单号
 * ?month=2026-09 指定月份，默认当月 */

interface 运单行 {
  id: string;
  tracking_no: string;
  package_count: number | null;
  freight_amount: number | null;
  cod_amount: number | null;
  supplier_name: string | null;
  received_at: string | null;
  freight_settled: boolean | null;
  /* 批次5：代收货款转付核对 */
  cod_transferred: boolean | null;
  /* 服务端补充：已结清的结算单号 */
  settlement_no: string | null;
}

export default async function LogisticsStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { companyId } = await params;
  const 参数 = await searchParams;
  const 当月 = new Date().toISOString().slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(参数.month || "") ? 参数.month! : 当月;

  const [年, 月] = month.split("-").map(Number);
  /* 北京时间月首/次月首（流水是 TIMESTAMPTZ，转 UTC 边界） */
  const 起 = new Date(Date.UTC(年, 月 - 1, 1) - 8 * 3600 * 1000);
  const 止 = new Date(Date.UTC(年, 月, 1) - 8 * 3600 * 1000);

  const supabase = await createClient();

  const { data: company } = await supabase
    .from("logistics_companies")
    .select("id, name, contact, phone")
    .eq("id", companyId)
    .single();
  if (!company) notFound();

  const { data: waybills } = await supabase
    .from("logistics_waybills")
    .select("id, tracking_no, package_count, freight_amount, cod_amount, supplier_name, received_at, freight_settled, cod_transferred")
    .eq("logistics_company_id", companyId)
    .gte("received_at", 起.toISOString())
    .lt("received_at", 止.toISOString())
    .order("received_at", { ascending: true });

  const 行们 = (waybills || []) as 运单行[];

  /* 补充结算单号：运单 → 结算明细 → 有效结算单 */
  const 运单ids = 行们.filter((w) => w.freight_settled).map((w) => w.id);
  if (运单ids.length > 0) {
    const { data: 明细 } = await supabase
      .from("logistics_settlement_items")
      .select("waybill_id, logistics_settlements(settlement_no, status)")
      .in("waybill_id", 运单ids);
    const 结算Map = new Map<string, string>();
    for (const i of (明细 || []) as unknown as { waybill_id: string; logistics_settlements: { settlement_no: string; status: string } | null }[]) {
      if (i.logistics_settlements?.status === "confirmed") {
        结算Map.set(i.waybill_id, i.logistics_settlements.settlement_no);
      }
    }
    for (const w of 行们) {
      w.settlement_no = 结算Map.get(w.id) || null;
    }
  }

  return <LogisticsStatementContent company={company} rows={行们} month={month} />;
}

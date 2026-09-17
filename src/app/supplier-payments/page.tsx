import { createClient } from "@/lib/supabase/server";
import SupplierPaymentsContent from "./SupplierPaymentsContent";

/* 供应商款项页（服务端首屏）
 * 2026-09-16 批次7 改造：打开即「供应商汇总」大表（应付正数/应收负数都显示，
 * 参考 1 号车间供应商款项页），付款单/收款单挪为页签。
 * searchParams 支持 ?supplier_id=X&new=1：供应商详情页"去付款"跳来时预选供应商并直接打开新建弹窗 */
export default async function SupplierPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ supplier_id?: string; new?: string }>;
}) {
  const 参数 = await searchParams;
  const supabase = await createClient();

  const [
    { data: payments },
    { data: supplierList },
    { data: methodList },
    { data: summary },
    { data: receipts },
    { data: creditTxns },
    { data: returnOrders },
    { data: returnRecords },
  ] = await Promise.all([
    supabase
      .from("supplier_payments")
      .select("*, suppliers(name), profiles!supplier_payments_created_by_fkey(full_name)")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("suppliers").select("id, name").order("name"),
    supabase.from("payment_methods").select("code, name").eq("is_active", true).order("sort_order"),
    /* 批次7：供应商汇总（余额+累计列，含累计优惠） */
    supabase.rpc("supplier_balances"),
    supabase
      .from("supplier_receipts")
      .select("*, suppliers(name), profiles!supplier_receipts_created_by_fkey(full_name)")
      .order("created_at", { ascending: false })
      .limit(500),
    /* 批次7 退货核对：credit 退货流水 + 两种来源单据（采退单/退货记录），前端逐笔对金额 */
    supabase
      .from("supplier_transactions")
      .select("id, supplier_id, amount, description, reference_id, reference_type, created_at, suppliers(name)")
      .eq("transaction_type", "credit")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("purchase_return_orders")
      .select("id, return_no, status, created_at")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("supplier_return_records")
      .select("id, quantity, unit_cost, return_order_id, part_name, status")
      .limit(2000),
  ]);

  return (
    <SupplierPaymentsContent
      initialPayments={payments || []}
      initialSuppliers={supplierList || []}
      paymentMethods={methodList || []}
      initialSummary={summary || []}
      initialReceipts={receipts || []}
      /* supplier_transactions→suppliers 嵌入被推导为数组，取第一项归一化 */
      initialCreditTxns={((creditTxns || []) as unknown as (Omit<CreditTxnShape, "suppliers"> & { suppliers: { name: string }[] | { name: string } | null })[]).map((t) => ({
        ...t,
        suppliers: Array.isArray(t.suppliers) ? t.suppliers[0] ?? null : t.suppliers,
      }))}
      returnOrders={returnOrders || []}
      returnRecords={returnRecords || []}
      预选供应商id={参数.supplier_id || ""}
      自动开单={参数.new === "1"}
    />
  );
}

/* CreditTxn 的形状（与 SupplierPaymentsContent 内接口一致，仅用于入参归一化） */
interface CreditTxnShape {
  id: string;
  supplier_id: string | null;
  amount: number;
  description: string | null;
  reference_id: string | null;
  reference_type: string | null;
  created_at: string;
  suppliers: { name: string } | null;
}

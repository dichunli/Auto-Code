import { createClient } from "@/lib/supabase/server";
import SupplierPaymentsContent from "./SupplierPaymentsContent";

/* 供应商付款单列表页（服务端首屏，2026-09-14 批次1）
 * searchParams 支持 ?supplier_id=X&new=1：供应商详情页"去付款"跳来时预选供应商并直接打开新建弹窗 */
export default async function SupplierPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ supplier_id?: string; new?: string }>;
}) {
  const 参数 = await searchParams;
  const supabase = await createClient();

  const [{ data: payments }, { data: supplierList }, { data: methodList }] = await Promise.all([
    supabase
      .from("supplier_payments")
      .select("*, suppliers(name), profiles!supplier_payments_created_by_fkey(full_name)")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("suppliers").select("id, name").order("name"),
    supabase.from("payment_methods").select("code, name").eq("is_active", true).order("sort_order"),
  ]);

  return (
    <SupplierPaymentsContent
      initialPayments={payments || []}
      initialSuppliers={supplierList || []}
      paymentMethods={methodList || []}
      预选供应商id={参数.supplier_id || ""}
      自动开单={参数.new === "1"}
    />
  );
}

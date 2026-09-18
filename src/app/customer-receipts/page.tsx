import { createClient } from "@/lib/supabase/server";
import CustomerReceiptsContent from "./CustomerReceiptsContent";

/* 客户收款单列表页（服务端首屏，2026-09-16 往来账销账闭环）
 * searchParams 支持 ?customer_id=X&new=1：应收账页"去收款"跳来时预选客户并直接打开新建弹窗 */
export default async function CustomerReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ customer_id?: string; new?: string }>;
}) {
  const 参数 = await searchParams;
  const supabase = await createClient();

  /* 四路并行：收款单列表 / 未结应收的客户id（收款弹窗的客户下拉只列有欠款的） / 资金账户 / 支付方式 */
  const [{ data: receipts }, { data: 欠款行 }, { data: accountList }, { data: methodList }] = await Promise.all([
    supabase
      .from("customer_receipts")
      .select("*, customers(name, phone), profiles!customer_receipts_created_by_fkey(full_name), finance_accounts(name)")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("accounts_receivable")
      .select("customer_id")
      .in("status", ["pending", "partial"]),
    supabase.from("finance_accounts").select("id, name").eq("is_active", true).order("name"),
    supabase.from("payment_methods").select("code, name").eq("is_active", true).order("sort_order"),
  ]);

  /* 有欠款的客户才去收得到款，下拉只列他们（客户总量可能上千，全列没法用） */
  const 欠款客户ids = [...new Set((欠款行 || []).map((r: { customer_id: string }) => r.customer_id))];
  let customerList: { id: string; name: string; phone: string | null }[] = [];
  if (欠款客户ids.length > 0) {
    const { data } = await supabase.from("customers").select("id, name, phone").in("id", 欠款客户ids).order("name");
    customerList = data || [];
  }

  return (
    <CustomerReceiptsContent
      initialReceipts={receipts || []}
      initialCustomers={customerList || []}
      accounts={accountList || []}
      paymentMethods={methodList || []}
      预选客户id={参数.customer_id || ""}
      自动开单={参数.new === "1"}
    />
  );
}

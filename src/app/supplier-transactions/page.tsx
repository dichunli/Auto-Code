import { createClient } from "@/lib/supabase/server";
import SupplierTransactionsContent from "./SupplierTransactionsContent";

export default async function SupplierTransactionsPage() {
  const supabase = await createClient();
  const [{ data: transactions }, { data: supplierList }] = await Promise.all([
    supabase
      .from("supplier_transactions")
      .select("*, suppliers(name), profiles(full_name)")
      .order("created_at", { ascending: false }),
    supabase.from("suppliers").select("id, name").order("name"),
  ]);
  return (
    <SupplierTransactionsContent
      initialTransactions={(transactions || [])}
      initialSuppliers={(supplierList || [])}
    />
  );
}

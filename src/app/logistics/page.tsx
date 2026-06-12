import { createClient } from "@/lib/supabase/server";
import LogisticsContent from "./LogisticsContent";

export default async function LogisticsPage() {
  const supabase = await createClient();
  const [{ data: waybills }, { data: companies }, { data: suppliers }] = await Promise.all([
    supabase.from("logistics_waybills").select("*, logistics_companies(name, scopes)").order("created_at", { ascending: false }),
    supabase.from("logistics_companies").select("*").order("sort_order", { ascending: true }).order("name"),
    supabase.from("suppliers").select("id, name").order("name"),
  ]);
  return <LogisticsContent initialWaybills={waybills || []} initialCompanies={companies || []} initialSuppliers={suppliers || []} />;
}

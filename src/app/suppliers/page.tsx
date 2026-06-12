import { createClient } from "@/lib/supabase/server";
import SuppliersContent from "./SuppliersContent";

export default async function SuppliersPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("suppliers")
    .select("*, parts(count)")
    .order("created_at", { ascending: false });
  return <SuppliersContent initialSuppliers={(data || [])} />;
}

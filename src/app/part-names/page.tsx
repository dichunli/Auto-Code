import { createClient } from "@/lib/supabase/server";
import PartNamesContent from "./PartNamesContent";

export default async function PartNamesPage() {
  const supabase = await createClient();
  const [{ data: partNames }, { data: categories }] = await Promise.all([
    supabase.from("part_names").select("*, part_categories(name), part_name_brands(part_brands(id, name)), part_name_specifications(part_specifications(id, name))").order("created_at", { ascending: false }),
    supabase.from("part_categories").select("id, name, auto_link_vehicle_model, is_consumable, sales_commission_type, sales_commission_value, diagnosis_commission_type, diagnosis_commission_value, repair_commission_type, repair_commission_value, qc_commission_type, qc_commission_value, picking_commission_type, picking_commission_value").order("name"),
  ]);
  return <PartNamesContent initialPartNames={partNames || []} initialCategories={categories || []} />;
}

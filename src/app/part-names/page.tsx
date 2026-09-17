import { createClient } from "@/lib/supabase/server";
import PartNamesContent from "./PartNamesContent";

/* 首屏只取第一页（原来全表拉取，名称库涨后整页渲染卡顿） */
const 每页数 = 20;

export default async function PartNamesPage() {
  const supabase = await createClient();
  const [{ data: partNames, count }, { data: categories }] = await Promise.all([
    supabase.from("part_names").select("*, part_categories(name), part_name_brands(part_brands(id, name)), part_name_specifications(part_specifications(id, name))", { count: "exact" }).order("created_at", { ascending: false }).range(0, 每页数 - 1),
    supabase.from("part_categories").select("id, name, auto_link_vehicle_model, is_consumable, sales_commission_type, sales_commission_value, diagnosis_commission_type, diagnosis_commission_value, repair_commission_type, repair_commission_value, qc_commission_type, qc_commission_value, picking_commission_type, picking_commission_value").order("name"),
  ]);
  return <PartNamesContent initialPartNames={partNames || []} initialCategories={categories || []} initialTotal={count || 0} 每页数={每页数} />;
}
